
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
    code = Array.from({ length: 5 }, () =>
      chars[Math.floor(Math.random() * chars.length)]
    ).join("");
  } while (rooms.has(code));

  return code;
}

function getRoom(socket) {
  const code = socket.data.room;
  if (!code) return null;
  return rooms.get(code) || null;
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
  }

  socket.data.room = null;
}

function getBalancedTeam(room) {
  let team0 = 0;
  let team1 = 0;

  for (const player of room.players.values()) {
    if (player.team === 0) team0++;
    else team1++;
  }

  return team0 <= team1 ? 0 : 1;
}

function cleanNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

io.on("connection", (socket) => {

  socket.on("room:create", (callback) => {
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
  });

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

  socket.on("player:update", (data) => {
    const room = getRoom(socket);
    if (!room || !room.players.has(socket.id)) return;

    const oldPlayer = room.players.get(socket.id);

    const clean = {
      x: cleanNumber(data?.x),
      y: cleanNumber(data?.y),
      z: cleanNumber(data?.z),
      yaw: cleanNumber(data?.yaw),
      team: oldPlayer.team,
      hp: oldPlayer.hp,
      alive: oldPlayer.alive
    };

    room.players.set(socket.id, clean);

    socket.to(socket.data.room).emit("player:update", {
      id: socket.id,
      state: clean
    });
  });

  socket.on("match:start", (data) => {
    const room = getRoom(socket);
    if (!room || !room.players.has(socket.id)) return;

    room.match.running = true;
    room.match.mode = String(data?.mode || "normal");
    room.match.phase = "playing";
    room.match.score = [0, 0];
    room.match.round = 1;

    io.to(socket.data.room).emit("match:start", {
      match: room.match,
      startedBy: socket.id
    });
  });

  socket.on("game:sync", (data) => {
    const room = getRoom(socket);
    if (!room || !room.players.has(socket.id)) return;
    if (!data || typeof data !== "object") return;

    const allowed = [
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

    socket.to(socket.data.room).emit("game:sync", {
      id: socket.id,
      state
    });
  });

  socket.on("match:stop", () => {
    const room = getRoom(socket);
    if (!room || !room.players.has(socket.id)) return;

    room.match.running = false;
    room.match.phase = "finished";

    io.to(socket.data.room).emit("match:stop", {
      stoppedBy: socket.id
    });
  });

  socket.on("room:leave", () => {
    leaveRoom(socket);
  });

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
