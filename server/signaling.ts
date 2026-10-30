/**
 * Ephemeral WebSocket signaling relay for WebRTC peer connection establishment.
 *
 * This server only relays SDP offers/answers and ICE candidates between two
 * peers in a room. No file data, filenames, or payloads ever pass through it.
 *
 * Usage:  npx tsx server/signaling.ts
 * Port:   Defaults to 8787, override with PORT env var.
 */

import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Room {
  peers: WebSocket[];
  /** Timer handle for the auto-expiry timeout. */
  expiryTimer: ReturnType<typeof setTimeout>;
}

interface IncomingMessage {
  type: string;
  room?: string;
  sdp?: string;
  candidate?: object;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env['PORT'] ?? '8787', 10);
const ROOM_EXPIRY_MS = 120_000; // 120 seconds of inactivity
const MAX_PEERS_PER_ROOM = 2;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const rooms = new Map<string, Room>();

/** Maps each WebSocket to the room code it belongs to. */
const peerRooms = new Map<WebSocket, string>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timestamp(): string {
  return new Date().toISOString();
}

function log(message: string): void {
  console.log(`[${timestamp()}] ${message}`);
}

function sendJSON(ws: WebSocket, data: object): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

/**
 * Returns the other peer in a room, if any.
 */
function getOtherPeer(room: Room, sender: WebSocket): WebSocket | undefined {
  return room.peers.find((p) => p !== sender);
}

/**
 * Resets the inactivity timer for a room.
 */
function resetRoomExpiry(code: string): void {
  const room = rooms.get(code);
  if (!room) return;

  clearTimeout(room.expiryTimer);
  room.expiryTimer = setTimeout(() => {
    log(`Room ${code} expired due to inactivity`);
    destroyRoom(code);
  }, ROOM_EXPIRY_MS);
}

/**
 * Destroys a room: notifies remaining peers and cleans up state.
 */
function destroyRoom(code: string): void {
  const room = rooms.get(code);
  if (!room) return;

  clearTimeout(room.expiryTimer);

  for (const peer of room.peers) {
    peerRooms.delete(peer);
    sendJSON(peer, { type: 'peer-left' });
  }

  rooms.delete(code);
  log(`Room ${code} destroyed`);
}

/**
 * Removes a single peer from its room. Destroys the room if empty.
 */
function removePeer(ws: WebSocket): void {
  const code = peerRooms.get(ws);
  if (!code) return;

  peerRooms.delete(ws);
  const room = rooms.get(code);
  if (!room) return;

  room.peers = room.peers.filter((p) => p !== ws);

  // Notify remaining peer.
  for (const peer of room.peers) {
    sendJSON(peer, { type: 'peer-left' });
  }

  if (room.peers.length === 0) {
    destroyRoom(code);
  } else {
    resetRoomExpiry(code);
  }
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

function handleMessage(ws: WebSocket, raw: string): void {
  let msg: IncomingMessage;
  try {
    msg = JSON.parse(raw) as IncomingMessage;
  } catch {
    sendJSON(ws, { type: 'error', message: 'Invalid JSON' });
    return;
  }

  switch (msg.type) {
    // --- Room lifecycle ---------------------------------------------------

    case 'create': {
      const code = msg.room;
      if (!code || typeof code !== 'string') {
        sendJSON(ws, { type: 'error', message: 'Missing room code' });
        return;
      }
      if (rooms.has(code)) {
        sendJSON(ws, { type: 'error', message: 'Room already exists' });
        return;
      }

      const expiryTimer = setTimeout(() => {
        log(`Room ${code} expired due to inactivity`);
        destroyRoom(code);
      }, ROOM_EXPIRY_MS);

      rooms.set(code, { peers: [ws], expiryTimer });
      peerRooms.set(ws, code);

      log(`Room ${code} created`);
      sendJSON(ws, { type: 'room-created', room: code });
      break;
    }

    case 'join': {
      const code = msg.room;
      if (!code || typeof code !== 'string') {
        sendJSON(ws, { type: 'error', message: 'Missing room code' });
        return;
      }
      const room = rooms.get(code);
      if (!room) {
        sendJSON(ws, { type: 'error', message: 'Room not found' });
        return;
      }
      if (room.peers.length >= MAX_PEERS_PER_ROOM) {
        sendJSON(ws, { type: 'error', message: 'Room is full' });
        return;
      }

      room.peers.push(ws);
      peerRooms.set(ws, code);
      resetRoomExpiry(code);

      log(`Peer joined room ${code}`);

      // Notify both peers.
      for (const peer of room.peers) {
        sendJSON(peer, { type: 'peer-joined' });
      }
      break;
    }

    // --- Signaling relay --------------------------------------------------

    case 'offer': {
      const code = peerRooms.get(ws);
      if (!code) {
        sendJSON(ws, { type: 'error', message: 'Not in a room' });
        return;
      }
      const room = rooms.get(code);
      if (!room) return;
      resetRoomExpiry(code);

      const other = getOtherPeer(room, ws);
      if (other) {
        sendJSON(other, { type: 'offer', sdp: msg.sdp });
      }
      break;
    }

    case 'answer': {
      const code = peerRooms.get(ws);
      if (!code) {
        sendJSON(ws, { type: 'error', message: 'Not in a room' });
        return;
      }
      const room = rooms.get(code);
      if (!room) return;
      resetRoomExpiry(code);

      const other = getOtherPeer(room, ws);
      if (other) {
        sendJSON(other, { type: 'answer', sdp: msg.sdp });
      }
      break;
    }

    case 'ice-candidate': {
      const code = peerRooms.get(ws);
      if (!code) {
        sendJSON(ws, { type: 'error', message: 'Not in a room' });
        return;
      }
      const room = rooms.get(code);
      if (!room) return;
      resetRoomExpiry(code);

      const other = getOtherPeer(room, ws);
      if (other) {
        sendJSON(other, { type: 'ice-candidate', candidate: msg.candidate });
      }
      break;
    }

    default:
      sendJSON(ws, { type: 'error', message: `Unknown message type: ${msg.type}` });
  }
}

// ---------------------------------------------------------------------------
// Server (HTTP Health Check + WebSocket Relay)
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/' || req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'healthy',
        service: 'pinnpointt-signaling',
        version: '0.0.42-beta',
        activeRooms: rooms.size,
        uptimeSeconds: Math.floor(process.uptime()),
      })
    );
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket) => {
  ws.on('message', (data: Buffer) => {
    handleMessage(ws, data.toString('utf-8'));
  });

  ws.on('close', () => {
    removePeer(ws);
  });

  ws.on('error', () => {
    removePeer(ws);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  log(`Signaling server listening on ws://localhost:${PORT} (HTTP health checks enabled on port ${PORT})`);
});
