const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

const rooms = new Map();

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

io.on("connection", (socket) => {
  socket.on("room:create", (callback) => {
    leaveRoom(socket);

    const code = makeCode();
    rooms.set(code, { players: new Map() });

    const room = rooms.get(code);
    room.players.set(socket.id, {
      x: 0, y: 0, z: 0, yaw: 0, team: 0
    });

    socket.join(code);
    socket.data.room = code;

    if (typeof callback === "function") {
      callback({ ok: true, code });
    }
  });

  socket.on("room:join", (code, callback) => {
    leaveRoom(socket);

    code = String(code || "").trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      if (typeof callback === "function")
        callback({ ok: false, error: "Oda bulunamadı." });
      return;
    }

    if (room.players.size >= 2) {
      if (typeof callback === "function")
        callback({ ok: false, error: "Oda dolu." });
      return;
    }

    const player = {
      x: 2, y: 0, z: 0, yaw: 0, team: 1
    };

    room.players.set(socket.id, player);
    socket.join(code);
    socket.data.room = code;

    const others = [...room.players.entries()]
      .filter(([id]) => id !== socket.id)
      .map(([id, state]) => ({ id, state }));

    if (typeof callback === "function") {
      callback({ ok: true, code, players: others });
    }

    socket.to(code).emit("player:joined", {
      id: socket.id,
      state: player
    });
  });

  socket.on("player:update", (data) => {
    const code = socket.data.room;
    if (!code || !rooms.has(code)) return;

    const room = rooms.get(code);
    if (!room.players.has(socket.id)) return;

    const clean = {
      x: Number(data?.x) || 0,
      y: Number(data?.y) || 0,
      z: Number(data?.z) || 0,
      yaw: Number(data?.yaw) || 0,
      team: room.players.get(socket.id).team
    };

    room.players.set(socket.id, clean);
    socket.to(code).emit("player:update", {
      id: socket.id,
      state: clean
    });
  });

  socket.on("disconnect", () => {
    leaveRoom(socket);
  });

  socket.on("room:leave", () => {
    leaveRoom(socket);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("STRIKE ZONE sunucusu " + PORT + " portunda çalışıyor.");
});
