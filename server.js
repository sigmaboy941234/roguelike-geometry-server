// server.js - copy & paste this file
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

  //
  // HOST: create a new room and ACK the creator with authoritative state
  //
  socket.on('hostRoom', ({ playerName }, ack) => {
    const roomId = Math.random().toString(36).slice(2, 8).toUpperCase();

    rooms[roomId] = {
      roomId,
      hostId: socket.id,
      players: {
        [socket.id]: { id: socket.id, name: playerName, x: 0, y: 0, hp: 100, isHost: true }
      },
      skillTree: { damage: 1, fireRate: 1, speed: 1 },
      wave: 1,
      seed: Math.floor(Math.random() * 1e9)
    };

    socket.join(roomId);
    console.log(`${playerName} hosted room ${roomId} (${socket.id})`);

    // ACK the host with authoritative roomState (client expects this)
    if (typeof ack === 'function') {
      ack({
        success: true,
        roomId,
        playerId: socket.id,
        isHost: true,
        roomState: rooms[roomId],
        players: rooms[roomId].players
      });
    }

    // optional compatibility event
    socket.emit('youAreHost', { roomId, playerId: socket.id });
  });

  //
  // JOIN: add player to room, ACK with authoritative state, then notify others
  //
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

    // 1) Add new player to authoritative state (include id explicitly)
    room.players[socket.id] = {
      id: socket.id,
      name: playerName,
      x: 0,
      y: 0,
      hp: 100,
      isHost: false
    };

    // join the socket to the room
    socket.join(roomId);

    // 2) ACK the joining client with the authoritative room state
    //    (This prevents race conditions where separate 'existingPlayers' later overwrites)
    if (typeof ack === 'function') {
      ack({
        success: true,
        roomId,
        playerId: socket.id,
        roomState: room,
        players: room.players
      });
    }

    // 3) Broadcast the new player to everyone else in the room so they spawn the newcomer
    socket.to(roomId).emit('playerJoined', {
      id: socket.id,
      state: room.players[socket.id]
    });

    console.log(`${playerName} (${socket.id}) joined room ${roomId}`);
  });

  //
  // PLAYER INPUT: authoritative update + broadcast to others
  //
  socket.on('playerInput', ({ roomId, x, y, ...rest }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (!room.players[socket.id]) return;

    // debug: log occasionally so you can watch server reception in Render logs
    // (reduce log spam by only printing a portion)
    if (Math.random() < 0.02) {
      console.log('playerInput from', socket.id, 'room', roomId, '->', { x, y });
    }

    // update authoritative state
    room.players[socket.id].x = x;
    room.players[socket.id].y = y;
    if (typeof rest.hp === 'number') room.players[socket.id].hp = rest.hp;

    // broadcast to others in room
    socket.to(roomId).emit('playerUpdate', {
      id: socket.id,
      x,
      y,
      ...(('hp' in rest) ? { hp: rest.hp } : {})
    });
  });

  //
  // SHOOT: broadcast shot info (keeps working as before)
  //
  socket.on('playerShoot', (payload) => {
    const { roomId, ...shotData } = payload || {};
    if (!roomId) return;
    io.to(roomId).emit('playerShoot', {
      id: socket.id,
      ...shotData
    });
  });

  //
  // Host-only actions
  //
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

  //
  // DISCONNECT: remove player and notify others
  //
  socket.on('disconnect', () => {
    Object.keys(rooms).forEach((rid) => {
      const room = rooms[rid];
      if (!room) return;
      if (room.players && room.players[socket.id]) {
        const name = room.players[socket.id].name;
        delete room.players[socket.id];
        io.to(rid).emit('playerLeft', { id: socket.id });
        console.log(`Player ${name || socket.id} left room ${rid}`);
        // if room empty, remove it
        if (Object.keys(room.players).length === 0) {
          delete rooms[rid];
          console.log(`Room ${rid} removed (empty)`);
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
