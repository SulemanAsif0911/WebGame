'use strict';

const devFlag = process.argv.includes('--dev');
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = devFlag ? 'development' : 'production';
}

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { WebSocketServer, WebSocket } = require('ws');

function arg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('-')) {
    return process.argv[idx + 1];
  }
  const prefix = flag + '=';
  const found = process.argv.find((a) => a.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  return fallback;
}

const hostname = arg('-H', arg('--hostname', process.env.HOST || '0.0.0.0'));
const port = parseInt(arg('-p', arg('--port', process.env.PORT || '3000')), 10);
const dev = process.env.NODE_ENV !== 'production';

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const TICK_MS = 50;
const MAX_PLAYERS = 16;
const MAX_HEALTH = 100;
const BODY_DAMAGE = 40;
const HEAD_DAMAGE = 100;
const MAX_SPEED = 14;
const PLAYER_RADIUS = 0.72;
const PLAYER_HEIGHT = 2.05;
const HEAD_START = 1.38;
const SHOT_COOLDOWN_MS = 55;
const RESPAWN_MS = 3200;
const ARENA_RADIUS = 46;

const SPAWNS = [
  [18.5, 4, 16.0],
  [-16.2, 4, 14.8],
  [14.0, 4, -18.4],
  [-18.8, 4, -12.6],
  [4.2, 4, 22.0],
  [-6.4, 4, -21.5],
  [22.5, 4, 2.4],
  [-21.0, 4, 4.8],
  [8.6, 4, -8.2],
  [-10.4, 4, 8.8],
];

let nextId = 1;
const players = new Map();
const sockets = new Map();

function now() {
  return Date.now();
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function pickSpawn(exceptId) {
  let best = SPAWNS[0];
  let bestScore = -Infinity;
  for (const s of SPAWNS) {
    let minD = Infinity;
    for (const p of players.values()) {
      if (p.id === exceptId || !p.alive) continue;
      const dx = p.x - s[0];
      const dz = p.z - s[2];
      minD = Math.min(minD, Math.hypot(dx, dz));
    }
    const score = minD === Infinity ? 1000 + Math.random() : minD + Math.random() * 2;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return { x: best[0], y: best[1], z: best[2] };
}

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    x: p.x,
    y: p.y,
    z: p.z,
    yaw: p.yaw,
    pitch: p.pitch,
    health: p.health,
    kills: p.kills,
    deaths: p.deaths,
    alive: p.alive,
    crouch: p.crouch,
    sprint: p.sprint,
    reload: p.reload,
    shoot: p.shoot,
  };
}

function makePlayer(id, name) {
  const spawn = pickSpawn(id);
  return {
    id,
    name,
    x: spawn.x,
    y: spawn.y,
    z: spawn.z,
    yaw: Math.random() * Math.PI * 2,
    pitch: 0,
    health: MAX_HEALTH,
    kills: 0,
    deaths: 0,
    alive: true,
    crouch: false,
    sprint: false,
    reload: false,
    shoot: 0,
    lastShot: 0,
    lastInput: now(),
    diedAt: 0,
  };
}

function rayHitsAabb(ox, oy, oz, dx, dy, dz, px, py, pz, crouch) {
  const h = crouch ? PLAYER_HEIGHT * 0.72 : PLAYER_HEIGHT;
  const r = crouch ? PLAYER_RADIUS * 1.1 : PLAYER_RADIUS;
  const minX = px - r;
  const maxX = px + r;
  const minY = py - 0.05;
  const maxY = py + h;
  const minZ = pz - r;
  const maxZ = pz + r;
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len;
  dy /= len;
  dz /= len;
  let tmin = 0.02;
  let tmax = 110;
  const slabs = [
    [minX, maxX, ox, dx],
    [minY, maxY, oy, dy],
    [minZ, maxZ, oz, dz],
  ];
  for (const [mn, mx, o, d] of slabs) {
    if (Math.abs(d) < 1e-8) {
      if (o < mn || o > mx) return null;
      continue;
    }
    let t1 = (mn - o) / d;
    let t2 = (mx - o) / d;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmax < tmin) return null;
  }
  const hitY = oy + dy * tmin - py;
  return { t: tmin, head: hitY >= (crouch ? HEAD_START * 0.72 : HEAD_START), hitY };
}

function applyDamage(attacker, victim, head) {
  if (!attacker.alive || !victim.alive || attacker.id === victim.id) return false;
  const dmg = head ? HEAD_DAMAGE : BODY_DAMAGE;
  victim.health = Math.max(0, victim.health - dmg);
  const dx = victim.x - attacker.x;
  const dz = victim.z - attacker.z;
  const len = Math.hypot(dx, dz) || 1;
  const vSock = sockets.get(victim.id);
  if (vSock) {
    send(vSock, {
      t: 'hurt',
      by: attacker.id,
      dmg,
      health: victim.health,
      head,
      dirx: dx / len,
      dirz: dz / len,
    });
  }
  const aSock = sockets.get(attacker.id);
  if (aSock) {
    send(aSock, {
      t: 'confirm',
      target: victim.id,
      dmg,
      health: victim.health,
      head,
      kill: victim.health <= 0,
    });
  }
  broadcast({
    t: 'hitfx',
    x: victim.x,
    y: victim.y + (head ? 1.6 : 1.1),
    z: victim.z,
    head,
    id: victim.id,
    health: victim.health,
  });
  if (victim.health <= 0) {
    victim.alive = false;
    victim.deaths += 1;
    attacker.kills += 1;
    victim.diedAt = now();
    broadcast({
      t: 'kill',
      id: victim.id,
      by: attacker.id,
      name: victim.name,
      killer: attacker.name,
      head,
      kills: attacker.kills,
      deaths: victim.deaths,
    });
    setTimeout(() => respawn(victim.id), RESPAWN_MS);
  }
  return true;
}

function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(msg, exceptId) {
  const data = JSON.stringify(msg);
  for (const [id, ws] of sockets) {
    if (id === exceptId) continue;
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

function handleShoot(attacker, origin, dir, targetId, headHint) {
  if (!attacker.alive) return;
  const tnow = now();
  if (tnow - attacker.lastShot < SHOT_COOLDOWN_MS) return;
  attacker.lastShot = tnow;
  attacker.shoot = tnow;

  const ox = origin.x;
  const oy = origin.y;
  const oz = origin.z;
  const dx = dir.x;
  const dy = dir.y;
  const dz = dir.z;

  broadcast(
    {
      t: 'shot',
      id: attacker.id,
      ox,
      oy,
      oz,
      dx,
      dy,
      dz,
    },
    attacker.id
  );

  let best = null;
  for (const p of players.values()) {
    if (p.id === attacker.id || !p.alive) continue;
    const hit = rayHitsAabb(ox, oy, oz, dx, dy, dz, p.x, p.y, p.z, p.crouch);
    if (!hit) continue;
    if (!best || hit.t < best.t) best = { player: p, ...hit };
  }

  if (targetId) {
    const victim = players.get(Number(targetId));
    if (victim && victim.alive && victim.id !== attacker.id) {
      const dist = Math.hypot(victim.x - ox, victim.z - oz);
      if (dist < 130) {
        const hintedHead = !!headHint || (best && best.player.id === victim.id && best.head);
        applyDamage(attacker, victim, hintedHead);
        return;
      }
    }
  }

  if (best) applyDamage(attacker, best.player, best.head);
}

function respawn(id) {
  const p = players.get(id);
  if (!p) return;
  const s = pickSpawn(id);
  p.x = s.x;
  p.y = s.y;
  p.z = s.z;
  p.health = MAX_HEALTH;
  p.alive = true;
  p.diedAt = 0;
  broadcast({ t: 'spawn', id: p.id, x: p.x, y: p.y, z: p.z, health: p.health });
}

function removePlayer(id) {
  if (!players.has(id)) return;
  const p = players.get(id);
  players.delete(id);
  sockets.delete(id);
  broadcast({ t: 'leave', id, name: p.name });
}

function attachGame(wss) {
  wss.on('connection', (ws) => {
    if (players.size >= MAX_PLAYERS) {
      send(ws, { t: 'full' });
      ws.close();
      return;
    }

    const humans = [...players.values()].filter((p) => !p.bot).length;
    if (humans >= MAX_PLAYERS) {
      send(ws, { t: 'full' });
      ws.close();
      return;
    }

    const id = nextId++;
    const player = makePlayer(id, 'Operator-' + id, false);
    players.set(id, player);
    sockets.set(id, ws);

    send(ws, {
      t: 'welcome',
      id,
      you: publicPlayer(player),
      players: [...players.values()].map(publicPlayer),
    });
    broadcast({ t: 'join', player: publicPlayer(player) }, id);

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const p = players.get(id);
      if (!p) return;

      if (msg.t === 'hello') {
        const name = String(msg.name || '')
          .replace(/[^\w\s\-_.]/g, '')
          .trim()
          .slice(0, 16);
        p.name = name || p.name;
        broadcast({ t: 'rename', id, name: p.name });
        return;
      }

      if (msg.t === 'input') {
        const tnow = now();
        const dt = Math.min(0.25, (tnow - p.lastInput) / 1000);
        p.lastInput = tnow;
        if (!p.alive) return;

        const nx = Number(msg.x);
        const ny = Number(msg.y);
        const nz = Number(msg.z);
        if (![nx, ny, nz].every(Number.isFinite)) return;

        const dist = Math.hypot(nx - p.x, nz - p.z);
        const maxStep = MAX_SPEED * Math.max(dt, 0.05) + 1.4;
        if (dist > maxStep * 6) {
          send(ws, { t: 'correct', x: p.x, y: p.y, z: p.z });
          return;
        }
        p.x = nx;
        p.y = clamp(ny, -8, 40);
        p.z = nz;
        p.yaw = Number(msg.yaw) || 0;
        p.pitch = clamp(Number(msg.pitch) || 0, -1.4, 1.4);
        p.crouch = !!msg.crouch;
        p.sprint = !!msg.sprint;
        p.reload = !!msg.reload;
        return;
      }

      if (msg.t === 'shoot') {
        const ox = Number(msg.ox);
        const oy = Number(msg.oy);
        const oz = Number(msg.oz);
        const dx = Number(msg.dx);
        const dy = Number(msg.dy);
        const dz = Number(msg.dz);
        if (![ox, oy, oz, dx, dy, dz].every(Number.isFinite)) return;
        handleShoot(
          p,
          { x: ox, y: oy, z: oz },
          { x: dx, y: dy, z: dz },
          msg.target,
          msg.head
        );
        return;
      }

      if (msg.t === 'ping') {
        send(ws, { t: 'pong', n: msg.n, at: now() });
      }
    });

    ws.on('close', () => removePlayer(id));
    ws.on('error', () => removePlayer(id));
  });

  setInterval(() => {
    if (!sockets.size) return;
    const payload = JSON.stringify({
      t: 'state',
      players: [...players.values()].map(publicPlayer),
    });
    for (const ws of sockets.values()) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }, TICK_MS);
}

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsed = parse(req.url, true);
    handle(req, res, parsed);
  });

  const wss = new WebSocketServer({ noServer: true });
  attachGame(wss);

  server.on('upgrade', (request, socket, head) => {
    const { pathname } = parse(request.url);
    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  server.listen(port, hostname, () => {
    const shown = hostname === '0.0.0.0' ? 'localhost' : hostname;
    console.log(`[iron-district] ${dev ? 'dev' : 'prod'} http://${shown}:${port}`);
    console.log(`[iron-district] LAN bind ${hostname}:${port}  ·  websocket /ws`);
  });
});
