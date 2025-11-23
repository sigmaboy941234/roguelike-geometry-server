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

  // Host creates room — NOW SUPPORTS ACK
  socket.on('hostRoom', ({ playerName }, ack) => {
    const roomId = Math.random().toString(36).slice(2, 8).toUpperCase();

    rooms[roomId] = {
      hostId: socket.id,
      players: {
        [socket.id]: { name: playerName, x: 0, y: 0, hp: 100, isHost: true }
      },
      skillTree: { damage: 1, fireRate: 1, speed: 1 },
      wave: 1,
      seed: Math.random() * 1e9
    };

    socket.join(roomId);

    console.log(`${playerName} hosted room ${roomId}`);

    // 🔥 REQUIRED — THIS IS WHAT YOUR FRONTEND WAITS FOR
    if (typeof ack === "function") {
      ack({
        roomId,
        isHost: true,
        playerId: socket.id,
        players: rooms[roomId].players,
        roomState: rooms[roomId]
      });
    }

    // you can keep this event if you still use it elsewhere
    socket.emit('youAreHost', { roomId });
  });

  // Join room — ADD ACK HERE TOO
  socket.on('joinRoom', ({ roomId, playerName }, ack) => {
    const room = rooms[roomId];

    if (room && Object.keys(room.players).length < 4) {
      socket.join(roomId);

      room.players[socket.id] = {
        name: playerName,
        x: 0,
        y: 0,
        hp: 100,
        isHost: false
      };

      io.to(roomId).emit('playerJoined', {
        id: socket.id,
        state: room.players[socket.id]
      });

      if (typeof ack === "function") {
        ack({
          success: true,
          roomState: room,
          playerId: socket.id
        });
      }

    } else {
      if (typeof ack === "function") {
        ack({
          success: false,
          error: "Room full or invalid"
        });
      }
      socket.emit('joinFailed', 'Room full or invalid');
    }
  });

  // Player movement
  socket.on('playerInput', ({ roomId, x, y }) => {
    const room = rooms[roomId];
    if (room?.players[socket.id]) {
      room.players[socket.id].x = x;
      room.players[socket.id].y = y;
      socket.to(roomId).emit('playerUpdate', { id: socket.id, x, y });
    }
  });

socket.on('playerShoot', (payload) => {
  const { roomId, ...shotData } = payload;
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

  socket.on('disconnect', () => {
    Object.keys(rooms).forEach((roomId) => {
      if (rooms[roomId].players[socket.id]) {
        delete rooms[roomId].players[socket.id];
        io.to(roomId).emit('playerLeft', { id: socket.id });
        if (Object.keys(rooms[roomId].players).length === 0) {
          delete rooms[roomId];
        }
      }
    });
  });
});

// Health check
app.get('/', (req, res) => res.send('Bullet Hell Co-op Server Running'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server live on port ${PORT}`);
});
