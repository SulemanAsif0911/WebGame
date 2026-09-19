'use strict';

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
const BODY_DAMAGE = 34;
const HEAD_DAMAGE = 100;
const MAX_SPEED = 14;
const PLAYER_RADIUS = 0.42;
const PLAYER_HEIGHT = 1.78;
const HEAD_START = 1.48;
const SHOT_COOLDOWN_MS = 85;
const RESPAWN_MS = 3200;

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

function rayHitsCapsule(ox, oy, oz, dx, dy, dz, px, py, pz, crouch) {
  const height = crouch ? PLAYER_HEIGHT * 0.72 : PLAYER_HEIGHT;
  const radius = crouch ? PLAYER_RADIUS * 1.05 : PLAYER_RADIUS;
  const y0 = py + radius;
  const y1 = py + height - 0.08;
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len;
  dy /= len;
  dz /= len;
  const maxDist = 110;

  const abx = 0;
  const aby = y1 - y0;
  const abz = 0;
  const aox = ox - px;
  const aoy = oy - y0;
  const aoz = oz - pz;

  const dDotAB = dy * aby;
  const aoDotAB = aoy * aby;
  const abDotAB = aby * aby || 1e-6;
  const dDotD = 1;
  const aoDotD = aox * dx + aoy * dy + aoz * dz;

  let t = 0;
  let s = 0;
  const denom = dDotD * abDotAB - dDotAB * dDotAB;
  if (Math.abs(denom) < 1e-8) {
    s = clamp(aoDotAB / abDotAB, 0, 1);
    t = aoDotD;
  } else {
    t = (abDotAB * aoDotD - dDotAB * aoDotAB) / denom;
    s = (dDotAB * aoDotD - dDotD * aoDotAB) / denom;
    s = clamp(s, 0, 1);
  }
  t = clamp(t, 0.05, maxDist);

  const cx = px;
  const cy = y0 + s * aby;
  const cz = pz;
  const qx = ox + dx * t;
  const qy = oy + dy * t;
  const qz = oz + dz * t;
  const dist = Math.hypot(qx - cx, qy - cy, qz - cz);
  if (dist > radius + 0.05) return null;

  const hitY = cy - py;
  const head = hitY >= (crouch ? HEAD_START * 0.72 : HEAD_START);
  return { t, head, hitY };
}

function handleShoot(attacker, origin, dir) {
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

  const fromEye = Math.hypot(ox - attacker.x, oz - attacker.z);
  if (fromEye > 3.5) return;

  let best = null;
  for (const p of players.values()) {
    if (p.id === attacker.id || !p.alive) continue;
    const hit = rayHitsCapsule(ox, oy, oz, dx, dy, dz, p.x, p.y, p.z, p.crouch);
    if (!hit) continue;
    if (!best || hit.t < best.t) best = { player: p, ...hit };
  }

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
    null
  );

  if (!best) return;

  const dmg = best.head ? HEAD_DAMAGE : BODY_DAMAGE;
  const victim = best.player;
  victim.health = Math.max(0, victim.health - dmg);

  send(sockets.get(victim.id), {
    t: 'hurt',
    by: attacker.id,
    dmg,
    health: victim.health,
    head: best.head,
    dirx: dx,
    dirz: dz,
  });

  send(sockets.get(attacker.id), {
    t: 'confirm',
    target: victim.id,
    dmg,
    health: victim.health,
    head: best.head,
    kill: victim.health <= 0,
  });

  broadcast({
    t: 'hitfx',
    x: victim.x,
    y: victim.y + (best.head ? 1.6 : 1.1),
    z: victim.z,
    head: best.head,
    id: victim.id,
  });

  if (victim.health <= 0) {
    victim.alive = false;
    victim.deaths += 1;
    attacker.kills += 1;
    victim.diedAt = tnow;
    broadcast({
      t: 'kill',
      id: victim.id,
      by: attacker.id,
      name: victim.name,
      killer: attacker.name,
      head: best.head,
      kills: attacker.kills,
      deaths: victim.deaths,
    });
    setTimeout(() => respawn(victim.id), RESPAWN_MS);
  }
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

    const id = nextId++;
    const spawn = pickSpawn(id);
    const player = {
      id,
      name: 'Operator-' + id,
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
      yaw: 0,
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
        handleShoot(p, { x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
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
    if (!players.size) return;
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
