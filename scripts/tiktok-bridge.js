/**
 * TikTok Live WebSocket Bridge for AILIVE Studio
 * Directly connects to TikTok Live Webcast using tiktok-live-connector
 * and broadcasts comments & gifts to AILIVE (PC, Web, or Android HP)
 * 
 * Usage:
 *   node scripts/tiktok-bridge.js [tiktok_username] [port]
 * Example:
 *   node scripts/tiktok-bridge.js akun_streamer 21213
 */

import { WebcastPushConnection } from 'tiktok-live-connector';
import { WebSocketServer } from 'ws';
import http from 'http';

const username = process.argv[2] || process.env.TIKTOK_USERNAME;
const port = parseInt(process.argv[3] || process.env.PORT || '21213', 10);

if (!username) {
  console.log('\n❌ Mohon masukkan username TikTok yang sedang LIVE!');
  console.log('👉 Cara pakai: node scripts/tiktok-bridge.js <username_tiktok> [port]');
  console.log('   Contoh: node scripts/tiktok-bridge.js maya_streamer 21213\n');
  process.exit(1);
}

const cleanUsername = username.replace(/^@/, '').trim();

// Create HTTP server for health check & WebSockets
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    target: cleanUsername,
    port: port,
    clients: wss ? wss.clients.size : 0
  }));
});

const wss = new WebSocketServer({ server });

console.log(`\n======================================================`);
console.log(`🎭 AILIVE - TikTok Live Stream Bridge`);
console.log(`📡 WebSocket Server aktif di ws://0.0.0.0:${port}`);
console.log(`🎯 Menghubungkan ke live @${cleanUsername}...`);
console.log(`======================================================\n`);

// Helper to broadcast to all connected AILIVE clients (Desktop / Mobile)
function broadcast(eventName, data) {
  const payload = JSON.stringify({
    event: eventName,
    data: data
  });

  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(payload);
    }
  });
}

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`🟢 [AILIVE Client Terhubung]: dari ${clientIp}`);

  // Send welcome ping
  ws.send(JSON.stringify({
    event: 'system',
    data: {
      message: `Terhubung ke TikTok Bridge untuk @${cleanUsername}`,
      target: cleanUsername
    }
  }));

  ws.on('close', () => {
    console.log(`🔴 [AILIVE Client Terputus]: ${clientIp}`);
  });
});

// Setup TikTok Live Connector
let tiktokConn = new WebcastPushConnection(cleanUsername, {
  processInitialData: false,
  enableExtendedGiftInfo: true,
  enableWebsocketUpgrade: true,
  requestPollingIntervalMs: 1000
});

function connectTikTok() {
  console.log(`⏳ Sedang menyambung ke ruang TikTok Live @${cleanUsername}...`);

  tiktokConn.connect().then(state => {
    console.log(`✅ [BERHASIL TERHUBUNG KE TIKTOK LIVE!]`);
    console.log(`   Room ID : ${state.roomId}`);
    console.log(`   Host    : @${cleanUsername}`);
    console.log(`   Komentar dan Gift penonton akan langsung diteruskan ke avatar AILIVE!\n`);

    broadcast('status', {
      connected: true,
      roomId: state.roomId,
      username: cleanUsername
    });
  }).catch(err => {
    console.error(`⚠️ Gagal menyambung ke @${cleanUsername}:`, err.message || err);
    console.log('🔄 Memeriksa kembali dalam 8 detik (pastikan akun sedang aktif LIVE)...');
    setTimeout(connectTikTok, 8000);
  });
}

// 1. CHAT EVENT
tiktokConn.on('chat', (data) => {
  console.log(`💬 [@${data.uniqueId}]: "${data.comment}"`);
  broadcast('chat', {
    uniqueId: data.uniqueId,
    nickname: data.nickname || data.uniqueId,
    comment: data.comment,
    profilePictureUrl: data.profilePictureUrl || null,
    timestamp: Date.now()
  });
});

// 2. GIFT EVENT
tiktokConn.on('gift', (data) => {
  // Hanya proses jika streak sudah selesai atau single gift
  if (data.giftType === 1 && !data.repeatEnd) {
    // Sedang combo, skip sampai combo selesai agar tidak spam
    return;
  }

  console.log(`🎁 [GIFT @${data.uniqueId}]: Mengirim ${data.giftName} x${data.repeatCount}! (${data.diamondCount} diamonds)`);
  broadcast('gift', {
    uniqueId: data.uniqueId,
    nickname: data.nickname || data.uniqueId,
    giftName: data.giftName,
    repeatCount: data.repeatCount || 1,
    diamondCount: data.diamondCount || 1,
    giftPictureUrl: data.giftPictureUrl || null
  });
});

// 3. LIKE EVENT
tiktokConn.on('like', (data) => {
  broadcast('like', {
    uniqueId: data.uniqueId,
    nickname: data.nickname,
    likeCount: data.likeCount,
    totalLikeCount: data.totalLikeCount
  });
});

// 4. DISCONNECT & RECONNECT
tiktokConn.on('disconnected', () => {
  console.warn('⚠️ Terputus dari TikTok Live. Mencoba menghubungkan kembali...');
  setTimeout(connectTikTok, 5000);
});

tiktokConn.on('error', (err) => {
  console.error('⚠️ TikTok Error:', err);
});

// Start Server
server.listen(port, '0.0.0.0', () => {
  connectTikTok();
});
