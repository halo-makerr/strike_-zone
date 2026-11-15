// STRIKE ZONE — çok oyunculu sunucu
// Render'da: Build "npm install", Start "node server.js"

const express = require('express'), http = require('http'), { Server } = require('socket.io');
const app = express();

app.get('/', (q, r) => r.send('STRIKE ZONE sunucusu çalışıyor'));

const srv = http.createServer(app);
const io = new Server(srv, {
  cors: { origin: '*' },
  pingInterval: 10000,
  pingTimeout: 20000
});

const ADMIN_KEY = process.env.ADMIN_KEY || '';
const rooms = new Map();
const MODES = ['match', 'gg', 'def'];
const TARGET = { match: 30, gg: 14, def: 0 };

const mkCode = () => {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do {
    c = Array.from({ length: 5 }, () => a[Math.random() * a.length | 0]).join('');
  } while (rooms.has(c));
  return c;
};

const cap = r => Math.min(5, r.fmt * 2);

const norm = o => {
  o = o && typeof o === 'object' ? o : {};
  const mode = MODES.includes(o.mode) ? o.mode : 'match';
  return {
    mode,
    fmt: mode === 'gg' ? 1 : Math.min(3, Math.max(1, o.fmt | 0 || 2)),
    map: Math.min(4, Math.max(0, o.map | 0)),
    night: !!o.night,
    diff: Math.min(2, Math.max(0, o.diff == null ? 1 : o.diff | 0)),
    fillBots: o.fillBots !== false
  };
};

const pub = r => ({
  code: r.code,
  host: r.host,
  fmt: r.fmt,
  mode: r.mode,
  map: r.map,
  night: r.night,
  fillBots: r.fillBots,
  state: r.state,
  cap: cap(r),
  pub: r.pub,
  players: [...r.players.values()].map(p => ({
    id: p.id,
    name: p.name,
    team: p.team,
    slot: p.slot,
    ch: p.ch,
    cos: p.cos,
    sk: p.sk,
    adm: p.adm,
    k: (r.stats[p.id] || [0, 0])[0],
    d: (r.stats[p.id] || [0, 0])[1]
  }))
});

function balance(r) {
  let i = 0;
  for (const p of r.players.values()) {
    p.team = i % 2;
    p.slot = i >> 1;
    i++;
  }
}

const push = r => io.to(r.code).emit('room:state', pub(r));

function create(o) {
  const r = Object.assign({
    code: mkCode(),
    host: null,
    state: 'lobby',
    players: new Map(),
    score: [0, 0],
    stats: {},
    pub: false,
    timer: null
  }, norm(o));
  rooms.set(r.code, r);
  return r;
}

function join(s, r, prof) {
  if (r.state !== 'lobby') return 'Maç devam ediyor.';
  if (r.players.size >= cap(r)) return 'Oda dolu.';

  leave(s);

  let ch = Math.max(0, Math.min(5, (prof && prof.ch) | 0));
  if (ch === 5 && !s.data.admin) ch = 0;

  r.players.set(s.id, {
    id: s.id,
    name: String((prof && prof.name) || 'OYUNCU').slice(0, 12).toUpperCase(),
    ch,
    cos: Array.isArray(prof && prof.cos)
      ? prof.cos.filter(i => i >= 0 && i < 5).slice(0, 5)
      : [],
    sk: Number.isInteger(prof && prof.sk) && prof.sk >= 0 && prof.sk < 5
      ? prof.sk
      : -1,
    adm: !!s.data.admin
  });

  if (!r.host) r.host = s.id;

  s.join(r.code);
  s.data.room = r.code;

  balance(r);
  push(r);

  return null;
}

function leave(s) {
  const r = rooms.get(s.data.room);
  if (!r) return;

  s.leave(r.code);
  s.data.room = null;
  r.players.delete(s.id);

  io.to(r.code).emit('player:left', s.id);

  if (!r.players.size) {
    clearTimeout(r.timer);
    rooms.delete(r.code);
    return;
  }

  if (r.host === s.id) r.host = r.players.keys().next().value;

  balance(r);

  if (r.state === 'play' && r.players.size < 2 &&
      r.mode !== 'def' && !r.fillBots) {
    endMatch(r, [...r.players.values()][0].team);
  }

  push(r);
}

function startMatch(r) {
  if (r.state !== 'lobby' || !r.players.size) return;
  if (!r.fillBots && r.players.size < 2) return;

  clearTimeout(r.timer);
  r.state = 'play';
  r.score = [0, 0];
  r.stats = {};

  const real = [0, 0];

  for (const p of r.players.values()) real[p.team]++;

  const bots = r.fillBots
    ? [
        Math.max(0, r.fmt - real[0]),
        Math.max(0, r.fmt - real[1])
      ]
    : [0, 0];

  io.to(r.code).emit('match:start', {
    mode: r.mode,
    map: r.map,
    night: r.night,
    diff: r.diff,
    fmt: r.fmt,
    bots,
    target: TARGET[r.mode],
    host: r.host,
    players: pub(r).players
  });

  push(r);
}

function endMatch(r, winner) {
  if (r.state !== 'play') return;

  r.state = 'lobby';

  io.to(r.code).emit('match:end', {
    winner,
    score: r.score,
    stats: r.stats
  });

  push(r);
}

const bump = (r, team, killer, victim) => {
  if (r.state !== 'play') return;

  if (team === 0 || team === 1) r.score[team]++;

  if (killer && r.players.has(killer))
    (r.stats[killer] = r.stats[killer] || [0, 0])[0]++;

  if (victim && r.players.has(victim))
    (r.stats[victim] = r.stats[victim] || [0, 0])[1]++;

  io.to(r.code).emit('score', {
    s: r.score,
    p: r.stats
  });

  const t = TARGET[r.mode];

  if (t && (r.score[0] >= t || r.score[1] >= t))
    endMatch(r, r.score[0] >= t ? 0 : 1);
};

const BAD = /(a+m+k+|a+m+c+[ıi]k|orospu|pi[cç]|sik(?:tir|eyim|im)|yarrak|ibne|göt|s[ei]ktir)/gi;

io.on('connection', s => {
  s.data = { room: null, admin: false };

  s.on('admin:auth', (k, cb) => {
    s.data.admin = !!ADMIN_KEY && k === ADMIN_KEY;
    if (typeof cb === 'function') cb({ ok: s.data.admin });
  });

  s.on('room:create', (o, cb) => {
    if (typeof o === 'function') {
      cb = o;
      o = {};
    }

    const r = create(o);
    const e = join(s, r, o);

    if (e) {
      rooms.delete(r.code);
      return cb && cb({ ok: false, error: e });
    }

    cb && cb({
      ok: true,
      code: r.code,
      room: pub(r)
    });
  });

  s.on('room:join', (code, prof, cb) => {
    if (typeof prof === 'function') {
      cb = prof;
      prof = {};
    }

    const r = rooms.get(String(code || '').trim().toUpperCase());

    if (!r)
      return cb && cb({
        ok: false,
        error: 'Oda bulunamadı. Kodu kontrol et.'
      });

    const e = join(s, r, prof);

    if (e)
      return cb && cb({ ok: false, error: e });

    cb && cb({
      ok: true,
      code: r.code,
      room: pub(r)
    });
  });

  s.on('quick:find', (o, cb) => {
    const n = norm(o);

    let r = [...rooms.values()].find(x =>
      x.pub &&
      x.state === 'lobby' &&
      x.mode === n.mode &&
      x.fmt === n.fmt &&
      x.players.size < cap(x)
    );

    if (!r) {
      r = create(Object.assign({}, o, { fillBots: true }));
      r.pub = true;
      r.timer = setTimeout(() => startMatch(r), 8000);
      r.autoAt = Date.now() + 8000;
    }

    const e = join(s, r, o);

    if (e) return cb && cb({ ok: false, error: e });

    if (r.players.size >= cap(r)) {
      clearTimeout(r.timer);
      r.timer = setTimeout(() => startMatch(r), 1500);
      r.autoAt = Date.now() + 1500;
    }

    cb && cb({
      ok: true,
      code: r.code,
      room: pub(r),
      autoIn: Math.max(0, (r.autoAt || 0) - Date.now())
    });
  });

  s.on('room:start', () => {
    const r = rooms.get(s.data.room);
    if (r && r.host === s.id) startMatch(r);
  });

  s.on('room:leave', () => leave(s));

  s.on('player:update', st => {
    const r = rooms.get(s.data.room);

    if (!r || r.state !== 'play' || !st) return;

    const p = r.players.get(s.id);
    if (!p) return;

    s.to(r.code).volatile.emit('player:update', {
      id: s.id,
      state: {
        x: +st.x || 0,
        y: +st.y || 0,
        z: +st.z || 0,
        yaw: +st.yaw || 0,
        hp: +st.hp || 0,
        alive: !!st.alive,
        crouch: !!st.crouch,
        team: p.team,
        name: p.name,
        ch: p.ch,
        cos: p.cos,
        sk: p.sk,
        w: String(st.w || '').slice(0, 12)
      }
    });
  });

  s.on('game:sync', st => {
    const r = rooms.get(s.data.room);

    if (!r || r.state !== 'play' || !st) return;

    if (st.event === 'hit')
      s.to(r.code).emit('game:sync', {
        id: s.id,
        state: {
          event: 'hit',
          target: st.target,
          damage: Math.min(200, +st.damage || 0),
          team: st.team,
          from: s.id,
          hd: !!st.hd
        }
      });

    else if (st.event === 'death')
      bump(r, st.team, st.by, s.id);

    else if (st.event === 'kill')
      bump(r, (r.players.get(s.id) || {}).team, s.id, null);
  });

  s.on('chat', t => {
    const r = rooms.get(s.data.room);

    if (!r || typeof t !== 'string') return;

    const now = Date.now();

    if (now - (s.data.lc || 0) < 800) return;

    s.data.lc = now;

    const p = r.players.get(s.id);
    if (!p) return;

    const c = t.replace(/[\u0000-\u001f<>]/g, '')
      .trim()
      .slice(0, 100)
      .replace(BAD, m => '*'.repeat(m.length));

    if (c) io.to(r.code).emit('chat', {
      n: p.name,
      t: c,
      team: p.team
    });
  });

  s.on('match:finish', o => {
    const r = rooms.get(s.data.room);

    if (r && r.host === s.id && r.mode === 'def' &&
        o && (o.winner === 0 || o.winner === 1)) {
      endMatch(r, o.winner);
    }
  });

  s.on('disconnect', () => leave(s));
});

srv.listen(process.env.PORT || 3000, () =>
  console.log('STRIKE ZONE sunucusu hazır')
);
