const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const rooms = {};

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  // Host creates room (with ACK)
  socket.on('hostRoom', ({ playerName }, ack) => {
    const roomId = Math.random().toString(36).slice(2, 8).toUpperCase();

    rooms[roomId] = {
      roomId,
      hostId: socket.id,
      players: {
        // store player objects with id included
        [socket.id]: { id: socket.id, name: playerName, x: 0, y: 0, hp: 100, isHost: true }
      },
      skillTree: { damage: 1, fireRate: 1, speed: 1 },
      wave: 1,
      seed: Math.floor(Math.random() * 1e9)
    };

    socket.join(roomId);

    console.log(`${playerName} hosted room ${roomId}`);

    // ACK the host (client waits for this)
    if (typeof ack === 'function') {
      ack({
        roomId,
        isHost: true,
        playerId: socket.id,
        players: rooms[roomId].players,
        roomState: rooms[roomId]
      });
    }

    // (optional) emit youAreHost for backward compatibility
    socket.emit('youAreHost', { roomId, playerId: socket.id });
  });

  // Join room (single handler) — sends existing players and notifies others
  socket.on('joinRoom', ({ roomId, playerName }, ack) => {
    const room = rooms[roomId];
    if (!room) {
      if (typeof ack === 'function') ack({ success: false, error: 'Invalid room' });
      socket.emit('joinFailed', 'Room full or invalid');
      return;
    }
    if (Object.keys(room.players).length >= 4) {
      if (typeof ack === 'function') ack({ success: false, error: 'Room full' });
      socket.emit('joinFailed', 'Room full or invalid');
      return;
    }

    // Join socket to room
    socket.join(roomId);

    // 1) Add new player to room state
    room.players[socket.id] = {
      id: socket.id,
      name: playerName,
      x: 0,
      y: 0,
      hp: 100,
      isHost: false
    };

    // 2) Send existing players (excluding the newcomer) to the new client
    const existingPlayers = Object.entries(room.players)
      .filter(([id]) => id !== socket.id)
      .map(([id, state]) => ({ id, state }));
    if (existingPlayers.length > 0) {
      socket.emit('existingPlayers', existingPlayers);
    }

    // 3) Broadcast this new player to everyone else in the room
    socket.to(roomId).emit('playerJoined', {
      id: socket.id,
      state: room.players[socket.id]
    });

    // 4) Ack the join with the authoritative room state
    if (typeof ack === 'function') {
      ack({
        success: true,
        roomId,
        roomState: room,
        playerId: socket.id,
        players: room.players
      });
    }

    console.log(`${playerName} joined ${roomId} (${socket.id})`);
  });

  // Player movement & inputs -> broadcast to room as playerUpdate
  socket.on('playerInput', ({ roomId, x, y, ...rest }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (!room.players[socket.id]) return;

    // update authoritative state
    room.players[socket.id].x = x;
    room.players[socket.id].y = y;
    // optionally update other fields if included
    if (typeof rest.hp === 'number') room.players[socket.id].hp = rest.hp;

    // broadcast to others
    socket.to(roomId).emit('playerUpdate', {
      id: socket.id,
      x,
      y,
      ...('hp' in rest ? { hp: rest.hp } : {})
    });
  });

  // Player shooting (already working)
  socket.on('playerShoot', (payload) => {
    const { roomId, ...shotData } = payload || {};
    if (!roomId) return;
    io.to(roomId).emit('playerShoot', {
      id: socket.id,
      ...shotData
    });
  });

  // Host-only actions
  socket.on('waveCleared', ({ roomId }) => {
    const room = rooms[roomId];
    if (socket.id === room?.hostId) {
      room.wave++;
      io.to(roomId).emit('nextWave', { wave: room.wave, seed: room.seed });
    }
  });

  socket.on('skillTreeChoice', ({ roomId, type, value }) => {
    const room = rooms[roomId];
    if (socket.id === room?.hostId) {
      room.skillTree[type] = value;
      io.to(roomId).emit('skillTreeUpdate', room.skillTree);
    }
  });

  socket.on('startGame', ({ roomId }) => {
    if (rooms[roomId]?.hostId === socket.id) {
      io.to(roomId).emit('gameStarting');
    }
  });

  // Disconnect: remove player and notify others
  socket.on('disconnect', () => {
    Object.keys(rooms).forEach((rid) => {
      const room = rooms[rid];
      if (!room) return;
      if (room.players && room.players[socket.id]) {
        delete room.players[socket.id];
        io.to(rid).emit('playerLeft', { id: socket.id });
        // if room empty, remove it
        if (Object.keys(room.players).length === 0) {
          delete rooms[rid];
        }
      }
    });
    console.log('Player disconnected:', socket.id);
  });
});

// Health check
app.get('/', (req, res) => res.send('Bullet Hell Co-op Server Running'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server live on port ${PORT}`);
});
