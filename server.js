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
const cliSky = process.argv.includes('--night')
  ? 'night'
  : String(arg('--sky', 'day')).toLowerCase() === 'night'
    ? 'night'
    : 'day';

const arena = {
  sky: cliSky,
  mode: 'ffa',
  hostId: null,
};

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const TICK_MS = 66;
const MAX_PLAYERS = 16;
const MAX_HP = 150;
const BODY_DMG = 32;
const HEAD_DMG = 80;
const RESPAWN_MS = 2800;
const SHOT_WINDOW_MS = 1000;
const SHOT_LIMIT = 28;

const SPAWNS = [
  [16, 14],
  [-15, 13],
  [13, -16],
  [-17, -12],
  [2, 20],
  [-4, -19],
  [20, 3],
  [-19, 5],
  [9, -7],
  [-11, 8],
  [18, -8],
  [-8, 18],
  [6, -18],
  [-18, -6],
];

let nextId = 1;
const players = new Map();

function now() {
  return Date.now();
}

function finite(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function sanitizeName(raw) {
  return String(raw || '')
    .replace(/[^\w\s\-_.]/g, '')
    .trim()
    .slice(0, 16);
}

function uniqueName(base) {
  const taken = new Set([...players.values()].map((p) => p.name.toLowerCase()));
  const root = base || 'OPERATOR';
  if (!taken.has(root.toLowerCase())) return root;
  for (let i = 2; i < 99; i++) {
    const cand = `${root}-${i}`;
    if (!taken.has(cand.toLowerCase())) return cand;
  }
  return `${root}-${Date.now() % 1000}`;
}

function pickSpawn(exceptId) {
  const order = SPAWNS.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }
  let best = order[0];
  let bestScore = -1;
  for (const s of order) {
    let minD = 999;
    for (const q of players.values()) {
      if (!q.alive || q.id === exceptId) continue;
      minD = Math.min(minD, Math.hypot(q.x - s[0], q.z - s[1]));
    }
    const score = minD + Math.random() * 18;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return [best[0] + (Math.random() * 5 - 2.5), best[1] + (Math.random() * 5 - 2.5)];
}

function meta(p) {
  return {
    id: p.id,
    name: p.name,
    x: p.x,
    y: p.y,
    z: p.z,
    yaw: p.yaw,
    pitch: p.pitch,
    hp: Math.round(p.hp),
    alive: p.alive,
    kills: p.kills,
    deaths: p.deaths,
  };
}

function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function broadcast(obj, exceptId) {
  const s = JSON.stringify(obj);
  for (const p of players.values()) {
    if (p.id === exceptId) continue;
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(s);
  }
}

function broadcastAll(obj) {
  const s = JSON.stringify(obj);
  for (const p of players.values()) {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(s);
  }
}

function rateOK(p) {
  const t = now();
  p.shots = p.shots.filter((x) => t - x < SHOT_WINDOW_MS);
  if (p.shots.length >= SHOT_LIMIT) return false;
  p.shots.push(t);
  return true;
}

function applyDamage(victim, dmg, from, head) {
  if (!victim.alive || dmg <= 0) return;
  victim.hp = Math.max(0, victim.hp - dmg);
  if (victim.hp > 0) {
    broadcastAll({
      t: 'hp',
      id: victim.id,
      hp: Math.round(victim.hp),
      from: from.id,
      head: !!head,
    });
    return;
  }
  victim.hp = 0;
  victim.alive = false;
  victim.deaths += 1;
  if (from.id !== victim.id) from.kills += 1;
  broadcastAll({
    t: 'kill',
    killer: { id: from.id, name: from.name, kills: from.kills },
    victim: { id: victim.id, name: victim.name, deaths: victim.deaths },
    head: !!head,
  });
  if (victim.respawnTimer) clearTimeout(victim.respawnTimer);
  victim.respawnTimer = setTimeout(() => {
    if (!players.has(victim.id)) return;
    const spawn = pickSpawn(victim.id);
    victim.x = spawn[0];
    victim.y = 0;
    victim.z = spawn[1];
    victim.hp = MAX_HP;
    victim.alive = true;
    broadcastAll({ t: 'respawn', id: victim.id, x: spawn[0], z: spawn[1], hp: MAX_HP });
  }, RESPAWN_MS);
}

function completeJoin(ws, msg) {
  if (players.size >= MAX_PLAYERS) {
    send(ws, { t: 'full' });
    ws.close();
    return null;
  }
  const id = nextId++;
  const name = uniqueName(sanitizeName(msg.name) || `OP-${id}`);
  const spawn = pickSpawn();
  const p = {
    id,
    ws,
    name,
    x: spawn[0],
    y: 2,
    z: spawn[1],
    yaw: 0,
    pitch: 0,
    hp: MAX_HP,
    alive: true,
    kills: 0,
    deaths: 0,
    lastState: 0,
    shots: [],
    respawnTimer: null,
  };
  const first = players.size === 0;
  if (first) {
    arena.hostId = id;
    if (msg.sky === 'night' || msg.sky === 'day') arena.sky = msg.sky;
  }
  players.set(id, p);
  send(ws, {
    t: 'welcome',
    id,
    name,
    spawn,
    host: first,
    sky: arena.sky,
    arena: arenaPublic(),
    you: meta(p),
    players: [...players.values()].filter((q) => q.id !== id).map(meta),
  });
  broadcast({ t: 'join', player: meta(p) }, id);
  console.log(`[iron-district] ${name} deployed · ${players.size} online · ${arena.sky} FFA`);
  return p;
}

function attachGame(wss) {
  wss.on('connection', (ws) => {
    let player = null;
    const joinTimeout = setTimeout(() => {
      if (!player) {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
    }, 12000);

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg.t !== 'string') return;

      if (!player) {
        if (msg.t === 'join' || msg.t === 'hello') {
          player = completeJoin(ws, msg);
          clearTimeout(joinTimeout);
        }
        return;
      }

      const p = player;

      if (msg.t === 'state' || msg.t === 'input') {
        const t = now();
        if (t - p.lastState < 20) return;
        p.lastState = t;
        if (!p.alive) return;
        if (finite(msg.x)) p.x = msg.x;
        if (finite(msg.y)) p.y = msg.y;
        if (finite(msg.z)) p.z = msg.z;
        if (finite(msg.yaw)) p.yaw = msg.yaw;
        if (finite(msg.pitch)) p.pitch = msg.pitch;
        return;
      }

      if (msg.t === 'shoot') {
        if (!p.alive || !rateOK(p)) return;
        broadcast(
          {
            t: 'shoot',
            id: p.id,
            o: [msg.ox, msg.oy, msg.oz],
            d: [msg.dx, msg.dy, msg.dz],
          },
          p.id
        );
        return;
      }

      if (msg.t === 'hit') {
        if (!p.alive) return;
        const target = players.get(Number(msg.target));
        if (!target || !target.alive || target.id === p.id) return;
        const dist = Math.hypot(target.x - p.x, target.z - p.z);
        if (dist > 160) return;
        const head = msg.head === true;
        const cap = head ? HEAD_DMG : BODY_DMG;
        const dmg = Math.min(finite(msg.dmg) ? msg.dmg : cap, cap);
        applyDamage(target, dmg, p, head);
        return;
      }

      if (msg.t === 'ping') {
        send(ws, { t: 'pong', n: msg.n, at: now() });
        return;
      }

      if ((msg.t === 'arena' || msg.t === 'sky') && p.id === arena.hostId) {
        if (msg.sky === 'day' || msg.sky === 'night') {
          arena.sky = msg.sky;
          for (const q of players.values()) {
            send(q.ws, { t: 'arena', ...arenaPublic(), host: q.id === arena.hostId });
          }
          console.log(`[iron-district] host set sky ${arena.sky}`);
        }
      }
    });

    ws.on('close', () => {
      clearTimeout(joinTimeout);
      if (!player) return;
      if (player.respawnTimer) clearTimeout(player.respawnTimer);
      players.delete(player.id);
      if (arena.hostId === player.id) {
        arena.hostId = players.size ? [...players.values()][0].id : null;
      }
      broadcastAll({ t: 'leave', id: player.id, name: player.name });
      if (arena.hostId) {
        for (const q of players.values()) {
          send(q.ws, { t: 'arena', ...arenaPublic(), host: q.id === arena.hostId });
        }
      }
      console.log(`[iron-district] ${player.name} left · ${players.size} online`);
    });
    ws.on('error', () => {});
  });

  setInterval(() => {
    if (!players.size) return;
    const r2 = (n) => Math.round(n * 100) / 100;
    const payload = [...players.values()].map((p) => [
      p.id,
      r2(p.x),
      r2(p.y),
      r2(p.z),
      r2(p.yaw),
      r2(p.pitch),
      Math.round(p.hp),
      p.alive ? 1 : 0,
      p.kills,
      p.deaths,
    ]);
    broadcastAll({ t: 'snap', p: payload });
  }, TICK_MS);
}

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsed = parse(req.url, true);
    if (parsed.pathname === '/arena') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(arenaPublic()));
      return;
    }
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
    console.log(`[iron-district] every Deploy joins THIS FFA — no bots`);
    console.log(`[iron-district] sky ${arena.sky} (host / first Deploy can change · --sky night)`);
  });
});
