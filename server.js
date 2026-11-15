// STRIKE ZONE - Çevrim içi oyun sunucusu
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const rooms = new Map();
const MAX_PLAYERS = 6;

app.get("/", (req, res) => {
  res.send("STRIKE ZONE sunucusu çalışıyor!");
});

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;

  do {
    code = Array.from(
      { length: 5 },
      () => chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  } while (rooms.has(code));

  return code;
}

function leaveRoom(socket) {
  const code = socket.data.room;

  if (!code || !rooms.has(code)) return;

  const room = rooms.get(code);
  room.players.delete(socket.id);

  socket.leave(code);
  socket.to(code).emit("player:left", socket.id);

  if (room.players.size === 0) {
    rooms.delete(code);
  } else {
    io.to(code).emit("room:count", room.players.size);
  }

  socket.data.room = null;
}

function getBalancedTeam(room) {
  let a = 0;
  let b = 0;

  for (const player of room.players.values()) {
    if (player.team === 0) a++;
    else b++;
  }

  return a <= b ? 0 : 1;
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

io.on("connection", socket => {

  // Oda oluşturma
  socket.on("room:create", callback => {
    leaveRoom(socket);

    const code = makeCode();

    const room = {
      players: new Map(),
      match: {
        running: false,
        mode: null,
        score: [0, 0],
        round: 1,
        phase: "waiting"
      }
    };

    rooms.set(code, room);

    const player = {
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      team: 0,
      hp: 100,
      alive: true
    };

    room.players.set(socket.id, player);
    socket.join(code);
    socket.data.room = code;

    if (typeof callback === "function") {
      callback({
        ok: true,
        code,
        team: 0,
        players: [],
        match: room.match
      });
    }

    io.to(code).emit("room:count", room.players.size);
  });

  // Odaya katılma
  socket.on("room:join", (rawCode, callback) => {
    leaveRoom(socket);

    const code = String(rawCode || "")
      .trim()
      .toUpperCase();

    const room = rooms.get(code);

    if (!room) {
      if (typeof callback === "function") {
        callback({
          ok: false,
          error: "Oda bulunamadı."
        });
      }
      return;
    }

    if (room.players.size >= MAX_PLAYERS) {
      if (typeof callback === "function") {
        callback({
          ok: false,
          error: "Oda dolu. En fazla 6 oyuncu katılabilir."
        });
      }
      return;
    }

    const team = getBalancedTeam(room);

    const player = {
      x: 2,
      y: 0,
      z: 0,
      yaw: 0,
      team,
      hp: 100,
      alive: true
    };

    room.players.set(socket.id, player);
    socket.join(code);
    socket.data.room = code;

    const others = [...room.players.entries()]
      .filter(([id]) => id !== socket.id)
      .map(([id, state]) => ({ id, state }));

    if (typeof callback === "function") {
      callback({
        ok: true,
        code,
        team,
        players: others,
        match: room.match
      });
    }

    socket.to(code).emit("player:joined", {
      id: socket.id,
      state: player
    });

    io.to(code).emit("room:count", room.players.size);
  });

  // Oyuncu hareketleri ve bilgileri
  socket.on("player:update", data => {
    const code = socket.data.room;

    if (!code || !rooms.has(code)) return;

    const room = rooms.get(code);
    const old = room.players.get(socket.id);

    if (!old) return;

    const clean = {
      x: num(data?.x),
      y: num(data?.y),
      z: num(data?.z),
      yaw: num(data?.yaw),

      team: old.team,

      hp: Math.max(
        0,
        Math.min(100, num(data?.hp, old.hp))
      ),

      alive:
        data?.alive === undefined
          ? old.alive
          : !!data.alive,

      accessory: String(
        data?.accessory || old.accessory || ""
      ).slice(0, 80),

      skin: String(
        data?.skin || old.skin || ""
      ).slice(0, 80),

      weapon: String(
        data?.weapon || old.weapon || "usp"
      ).slice(0, 24),

      character: Math.max(
        0,
        Math.min(
          5,
          Math.floor(num(data?.character, old.character || 0))
        )
      )
    };

    room.players.set(socket.id, clean);

    socket.to(code).emit("player:update", {
      id: socket.id,
      state: clean
    });
  });

  // Maçı başlatma
  socket.on("match:start", data => {
    const code = socket.data.room;

    if (!code || !rooms.has(code)) return;

    const room = rooms.get(code);

    if (!room.players.has(socket.id)) return;

    room.match = {
      running: true,
      mode: String(data?.mode || "match"),
      score: [0, 0],
      round: 1,
      phase: "playing"
    };

    io.to(code).emit("match:start", {
      match: room.match,
      startedBy: socket.id
    });
  });

  // Maç içi ortak bilgiler
  socket.on("game:sync", data => {
    const code = socket.data.room;

    if (
      !code ||
      !rooms.has(code) ||
      !rooms.get(code).players.has(socket.id)
    ) return;

    if (!data || typeof data !== "object") return;

    const allowed = [
      "event",
      "target",
      "damage",
      "team",
      "hp",
      "alive",
      "score",
      "round",
      "phase",
      "winner",
      "mode",
      "remaining"
    ];

    const state = {};

    for (const key of allowed) {
      if (data[key] !== undefined) {
        state[key] = data[key];
      }
    }

    socket.to(code).emit("game:sync", {
      id: socket.id,
      state
    });
  });

  // Maçı bitirme
  socket.on("match:stop", () => {
    const code = socket.data.room;

    if (!code || !rooms.has(code)) return;

    const room = rooms.get(code);

    if (!room.players.has(socket.id)) return;

    room.match.running = false;
    room.match.phase = "finished";

    io.to(code).emit("match:stop", {
      stoppedBy: socket.id
    });
  });

  // Yerdeki silahı alma bildirimi
  socket.on("weapon:pickup", rawId => {
    const code = socket.data.room;

    if (
      !code ||
      !rooms.has(code) ||
      !rooms.get(code).players.has(socket.id)
    ) return;

    const id = String(rawId || "").slice(0, 120);

    if (!id.startsWith("player-")) return;

    socket.to(code).emit("weapon:pickup", { id });
  });

  // Oda içi sohbet
  socket.on("chat:send", raw => {
    const code = socket.data.room;

    if (
      !code ||
      !rooms.has(code) ||
      !rooms.get(code).players.has(socket.id)
    ) return;

    const message = String(raw || "")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .trim()
      .slice(0, 160);

    if (!message) return;

    socket.to(code).emit("chat:message", {
      name: "OYUNCU",
      text: message,
      at: Date.now()
    });
  });

  // Odadan ayrılma
  socket.on("room:leave", () => {
    leaveRoom(socket);
  });

  // Bağlantı kesilmesi
  socket.on("disconnect", () => {
    leaveRoom(socket);
  });

});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(
    "STRIKE ZONE sunucusu " + PORT + " portunda çalışıyor."
  );
});
