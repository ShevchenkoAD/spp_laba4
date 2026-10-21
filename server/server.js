import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { Room } from './room.js';
import { Storage } from './storage.js';

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.resolve('public');
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript'
};

const server = http.createServer((req, res) => {
  if (req.url === '/api/records') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(Storage.load()));
  }

  let filePath = path.join(PUBLIC_DIR, req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404: Не найдено');
    } else {
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' });
      res.end(content);
    }
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map();

wss.on('connection', (ws) => {
  let boundPlayerId = null;
  let boundRoomCode = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'CREATE_ROOM') {
        const code = Math.random().toString(36).substring(2, 6).toUpperCase();
        const rounds = Math.max(1, Math.min(20, parseInt(data.rounds, 10) || 5));
        const room = new Room(code, false, rounds);
        rooms.set(code, room);

        const playerId = crypto.randomUUID();
        const token = crypto.randomUUID();
        room.addPlayer(playerId, data.name || 'Хост', data.color, token, ws);

        boundPlayerId = playerId;
        boundRoomCode = code;

        ws.send(JSON.stringify({ type: 'ROOM_JOINED', code, playerId, token, isDebug: false }));
      }

      if (data.type === 'JOIN_DEBUG_ROOM') {
        let room = rooms.get('DEBUG');
        if (!room) {
          room = new Room('DEBUG', true);
          rooms.set('DEBUG', room);
        }

        const playerId = crypto.randomUUID();
        const token = crypto.randomUUID();
        const player = room.addPlayer(playerId, data.name || 'Тестер', data.color, token, ws);

        if (!player) return ws.send(JSON.stringify({ type: 'ERROR', message: 'Дебаг комната переполнена' }));

        boundPlayerId = playerId;
        boundRoomCode = 'DEBUG';

        ws.send(JSON.stringify({ type: 'ROOM_JOINED', code: 'DEBUG', playerId, token, isDebug: true }));
      }

      if (data.type === 'GIVE_ITEM') {
        const room = rooms.get(boundRoomCode);
        if (room) {
          room.giveItem(boundPlayerId, data.itemType);
        }
      }

      if (data.type === 'JOIN_ROOM') {
        const room = rooms.get(data.code);
        if (!room) return ws.send(JSON.stringify({ type: 'ERROR', message: 'Комната не найдена' }));

        const playerId = crypto.randomUUID();
        const token = crypto.randomUUID();
        const player = room.addPlayer(playerId, data.name || 'Гонщик', data.color, token, ws);

        if (!player) return ws.send(JSON.stringify({ type: 'ERROR', message: 'Комната заполнена (макс. 4)' }));

        boundPlayerId = playerId;
        boundRoomCode = data.code;

        ws.send(JSON.stringify({ type: 'ROOM_JOINED', code: data.code, playerId, token, isDebug: room.isDebug }));
      }

      if (data.type === 'RECONNECT') {
        const room = rooms.get(data.code);
        if (room) {
          const restored = room.reconnectPlayer(data.token, ws);
          if (restored) {
            boundPlayerId = restored.id;
            boundRoomCode = data.code;
            return ws.send(JSON.stringify({ type: 'RECONNECT_SUCCESS', code: data.code, playerId: restored.id, isDebug: room.isDebug }));
          }
        }
        ws.send(JSON.stringify({ type: 'RECONNECT_FAILED' }));
      }

      if (data.type === 'LEAVE_ROOM') {
        const room = rooms.get(boundRoomCode);
        if (room && boundPlayerId) {
          room.removePlayer(boundPlayerId);
        }
        boundPlayerId = null;
        boundRoomCode = null;
      }

      if (data.type === 'START_GAME') {
        const room = rooms.get(boundRoomCode);
        if (room && room.state === 'LOBBY') {
          room.state = 'RACING';
        }
      }

      if (data.type === 'VOTE_READY') {
        const room = rooms.get(boundRoomCode);
        if (room) {
          room.voteReady(boundPlayerId);
        }
      }

      if (data.type === 'INPUT') {
        const room = rooms.get(boundRoomCode);
        if (room) {
          const p = room.players.get(boundPlayerId);
          if (p) p.inputs = data.inputs;
        }
      }

      if (data.type === 'PLACE_TRAP') {
        const room = rooms.get(boundRoomCode);
        if (room) {
          room.placeTrap(boundPlayerId, data.x, data.y, data.angle, data.trapType);
        }
      }

      if (data.type === 'USE_BOMB') {
        const room = rooms.get(boundRoomCode);
        if (room) {
          room.useBomb(boundPlayerId, data.x, data.y);
        }
      }

    } catch (err) {
      console.error('Ошибка сокета:', err);
    }
  });

  ws.onclose = () => {
    if (boundRoomCode && boundPlayerId) {
      const room = rooms.get(boundRoomCode);
      if (room) {
        const p = room.players.get(boundPlayerId);
        if (p) p.disconnected = true;
      }
    }
  };
});

server.listen(PORT, () => {
  console.log(`[Сервер запущен] Откройте в браузере: http://localhost:${PORT}`);
});