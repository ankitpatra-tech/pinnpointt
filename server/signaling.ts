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
import path from 'path';
import fs from 'fs';
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
const ROOM_EXPIRY_MS = 600_000; // 10 minutes of waiting inactivity (prevents premature timeouts)
const HEARTBEAT_INTERVAL_MS = 25_000; // 25 seconds ping-pong to keep cloud reverse proxies (Render, Cloudflare) alive
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
 * Note: Abandonment timeout ONLY applies when a single peer is waiting.
 * Once 2 peers are paired, the timer is cleared and the session stays active indefinitely.
 */
function resetRoomExpiry(code: string): void {
  const room = rooms.get(code);
  if (!room) return;

  clearTimeout(room.expiryTimer);

  if (room.peers.length === 1) {
    room.expiryTimer = setTimeout(() => {
      log(`Room ${code} expired while waiting for a peer`);
      destroyRoom(code);
    }, ROOM_EXPIRY_MS);
  }
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
        const existing = rooms.get(code)!;
        existing.peers = existing.peers.filter((p) => p.readyState === WebSocket.OPEN);
        if (existing.peers.length === 0 || existing.peers.includes(ws)) {
          // Re-claiming an empty or own room (e.g. after network reconnect)
          clearTimeout(existing.expiryTimer);
          rooms.delete(code);
        } else {
          sendJSON(ws, { type: 'error', message: 'Room already exists' });
          return;
        }
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

      // Filter out stale/closed sockets before checking occupancy
      room.peers = room.peers.filter((p) => p.readyState === WebSocket.OPEN);

      if (room.peers.length >= MAX_PEERS_PER_ROOM && !room.peers.includes(ws)) {
        sendJSON(ws, { type: 'error', message: 'Room is full' });
        return;
      }

      if (!room.peers.includes(ws)) {
        room.peers.push(ws);
      }
      peerRooms.set(ws, code);
      resetRoomExpiry(code);

      log(`Peer joined room ${code} (total peers: ${room.peers.length})`);

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

    case 'ping': {
      sendJSON(ws, { type: 'pong' });
      break;
    }

    default:
      sendJSON(ws, { type: 'error', message: `Unknown message type: ${msg.type}` });
  }
}

// ---------------------------------------------------------------------------
// Server (Static Files + HTTP Health Check + WebSocket Relay)
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

const distDir = path.resolve(process.cwd(), 'dist');

function serveStaticFile(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (!fs.existsSync(distDir)) {
    return false;
  }

  const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  let pathname = decodeURIComponent(parsedUrl.pathname);

  // If someone opens deep-link /?room=123456, redirect to /app?room=123456
  if (pathname === '/' && parsedUrl.searchParams.has('room')) {
    res.writeHead(302, { Location: `/app${parsedUrl.search}` });
    res.end();
    return true;
  }

  // Home Page -> Showcase Website (about.html)
  if (pathname === '/' || pathname === '/about' || pathname === '/about.html') {
    pathname = '/about.html';
  }
  // Web App -> File Transfer App (index.html)
  else if (pathname === '/app' || pathname === '/webapp' || pathname === '/index.html') {
    pathname = '/index.html';
  }

  const filePath = path.join(distDir, pathname);

  // Security: prevent directory traversal
  if (!filePath.startsWith(distDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return true;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
    });
    fs.createReadStream(filePath).pipe(res);
    return true;
  }

  // SPA fallback for pathnames without extension
  if (!path.extname(pathname)) {
    const fallbackFile = pathname.startsWith('/app') || pathname.startsWith('/webapp')
      ? path.join(distDir, 'index.html')
      : path.join(distDir, 'about.html');
    if (fs.existsSync(fallbackFile)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      fs.createReadStream(fallbackFile).pipe(res);
      return true;
    }
  }

  return false;
}

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'healthy',
        service: 'pinnpointt',
        version: '0.0.60-beta',
        activeRooms: rooms.size,
        uptimeSeconds: Math.floor(process.uptime()),
      })
    );
    return;
  }

  if (serveStaticFile(req, res)) {
    return;
  }

  // Fallback if dist/ has not been built
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'healthy',
        service: 'pinnpointt-signaling',
        version: '0.0.60-beta',
        activeRooms: rooms.size,
        uptimeSeconds: Math.floor(process.uptime()),
      })
    );
    return;
  }

  res.writeHead(404);
  res.end();
});

interface AliveWebSocket extends WebSocket {
  isAlive?: boolean;
}

const wss = new WebSocketServer({ server });

wss.on('connection', (ws: AliveWebSocket) => {
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (data: Buffer) => {
    ws.isAlive = true;
    handleMessage(ws, data.toString('utf-8'));
  });

  ws.on('close', () => {
    removePeer(ws);
  });

  ws.on('error', () => {
    removePeer(ws);
  });
});

// Periodic ping-pong heartbeat to keep connections active through cloud proxies (Render, Cloudflare, AWS)
const heartbeatTimer = setInterval(() => {
  wss.clients.forEach((client) => {
    const ws = client as AliveWebSocket;
    if (ws.isAlive === false) {
      log('Terminating unresponsive socket');
      return ws.terminate();
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      // Ignored if socket closed during iteration
    }
  });
}, HEARTBEAT_INTERVAL_MS);

wss.on('close', () => {
  clearInterval(heartbeatTimer);
});

server.listen(PORT, '0.0.0.0', () => {
  log(`Signaling server listening on ws://localhost:${PORT} (HTTP health checks enabled on port ${PORT})`);

  // -------------------------------------------------------------------------
  // Render Free-Tier Auto Keep-Alive (Prevents 15-Minute Inactivity Sleep)
  // -------------------------------------------------------------------------
  const externalUrl = process.env['RENDER_EXTERNAL_URL'] || process.env['KEEP_ALIVE_URL'];
  if (externalUrl) {
    const pingIntervalMs = 12 * 60 * 1000; // 12 minutes (safely inside Render's 15-min idle window)
    const cleanUrl = externalUrl.replace(/\/+$/, '');
    log(`[Keep-Alive] Armed automatic keep-alive for ${cleanUrl}/health every 12 minutes`);

    setInterval(async () => {
      try {
        const res = await fetch(`${cleanUrl}/health`);
        log(`[Keep-Alive] Heartbeat ping dispatched to ${cleanUrl}/health — Status: ${res.status}`);
      } catch (err) {
        log(`[Keep-Alive] Heartbeat ping notice: ${(err as Error).message}`);
      }
    }, pingIntervalMs);
  }
});
