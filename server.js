
// STRIKE ZONE — çok oyunculu sunucu (Render'da: Build "npm install", Start "node server.js")
// İsteğe bağlı ortam değişkeni: ADMIN_KEY  (yönetici karakterinin şifresi)
const express = require('express'), http = require('http'), { Server } = require('socket.io');
const app = express();
app.get('/', (q, r) => r.send('STRIKE ZONE sunucusu çalışıyor'));
const srv = http.createServer(app);
const io = new Server(srv, { cors: { origin: '*' }, pingInterval: 10000, pingTimeout: 20000 });
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const rooms = new Map();
const MODES = ['match', 'gg', 'def'];
const TARGET = { match: 30, gg: 14, def: 0 };
const mkCode = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c; do { c = Array.from({ length: 5 }, () => a[Math.random() * a.length | 0]).join(''); } while (rooms.has(c)); return c; };
const cap = r => Math.min(5, r.fmt * 2);
const norm = o => { o = o && typeof o === 'object' ? o : {}; const mode = MODES.includes(o.mode) ? o.mode : 'match'; return { mode, fmt: mode === 'gg' ? 1 : Math.min(3, Math.max(1, o.fmt | 0 || 2)), map: Math.min(2, Math.max(0, o.map | 0)), night: !!o.night, diff: Math.min(2, Math.max(0, o.diff == null ? 1 : o.diff | 0)), fillBots: o.fillBots !== false }; };
const pub = r => ({ code: r.code, host: r.host, fmt: r.fmt, mode: r.mode, map: r.map, night: r.night, fillBots: r.fillBots, state: r.state, cap: cap(r), pub: r.pub, players: [...r.players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, slot: p.slot, ch: p.ch, adm: p.adm, k: (r.stats[p.id] || [0, 0])[0], d: (r.stats[p.id] || [0, 0])[1] })) });
function balance(r) { let i = 0; for (const p of r.players.values()) { p.team = i % 2; p.slot = i >> 1; i++; } }
const push = r => io.to(r.code).emit('room:state', pub(r));
function create(o) { const r = Object.assign({ code: mkCode(), host: null, state: 'lobby', players: new Map(), score: [0, 0], stats: {}, pub: false, timer: null }, norm(o)); rooms.set(r.code, r); return r; }
function join(s, r, prof) {
  if (r.state !== 'lobby') return 'Maç devam ediyor.';
  if (r.players.size >= cap(r)) return 'Oda dolu.';
  leave(s);
  let ch = Math.max(0, Math.min(5, (prof && prof.ch) | 0)); if (ch === 5 && !s.data.admin) ch = 0;
  r.players.set(s.id, { id: s.id, name: String((prof && prof.name) || 'OYUNCU').slice(0, 12).toUpperCase(), ch, adm: !!s.data.admin });
  if (!r.host) r.host = s.id;
  s.join(r.code); s.data.room = r.code; balance(r); push(r); return null;
}
function leave(s) {
  const r = rooms.get(s.data.room); if (!r) return;
  s.leave(r.code); s.data.room = null; r.players.delete(s.id);
  io.to(r.code).emit('player:left', s.id);
  if (!r.players.size) { clearTimeout(r.timer); rooms.delete(r.code); return; }
  if (r.host === s.id) r.host = r.players.keys().next().value;
  balance(r);
  if (r.state === 'play' && r.players.size < 2 && r.mode !== 'def' && !r.fillBots) endMatch(r, [...r.players.values()][0].team);
