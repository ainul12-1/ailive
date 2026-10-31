import { GeminiLiveClient } from './gemini-live.js';
import { AvatarRenderer } from './avatar-renderer.js';
import { TikTokLiveManager } from './tiktok-live.js';

// Assets (Super Lightweight: Only VRM Humanoid)
import sampleVrmUrl from './assets/sample.vrm?url';

// DOM Elements
const geminiStatusEl = document.getElementById('gemini-status');
const tiktokStatusEl = document.getElementById('tiktok-status');
const speechTextEl = document.getElementById('speech-text');
const speakerTitleEl = document.getElementById('speaker-title');
const chatFeedEl = document.getElementById('chat-feed');
const queueBadgeEl = document.getElementById('queue-badge');
const soundwaveEl = document.getElementById('soundwave');
const stageLoaderEl = document.getElementById('stage-loader');
const loaderStatusEl = document.getElementById('loader-status');

// Controls
const modelFileInput = document.getElementById('model-file-input');
const btnToggleObs = document.getElementById('btn-toggle-obs');
const btnTriggerReaction = document.getElementById('btn-trigger-reaction');
const btnOpenSettings = document.getElementById('btn-open-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnCancelSettings = document.getElementById('btn-cancel-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');
const settingsModal = document.getElementById('settings-modal');
const sidebarEl = document.getElementById('sidebar');

// Mobile Dock Buttons
const btnMobileChat = document.getElementById('btn-mobile-chat');
const btnMobileObs = document.getElementById('btn-mobile-obs');
const btnMobileSettings = document.getElementById('btn-mobile-settings');

// Settings Inputs
const selectClothColor = document.getElementById('select-cloth-color');
const inputApiKey = document.getElementById('input-api-key');
const selectModel = document.getElementById('select-model');
const selectVoice = document.getElementById('select-voice');
const inputSystemPrompt = document.getElementById('input-system-prompt');
const inputTiktokUsername = document.getElementById('input-tiktok-username');
const inputTiktokWsUrl = document.getElementById('input-tiktok-ws-url');
const selectFilterMode = document.getElementById('select-filter-mode');
const inputCooldown = document.getElementById('input-cooldown');
const cooldownVal = document.getElementById('cooldown-val');

// Simulator Inputs
const simUser = document.getElementById('sim-user');
const simText = document.getElementById('sim-text');
const btnSimSend = document.getElementById('btn-sim-send');
const btnQuickGift = document.getElementById('btn-quick-gift');

// --- 1. Load Stored Configuration ---
let savedModel = localStorage.getItem('gemini_model');
if (!savedModel || savedModel.includes('2.0-flash-live-001') || savedModel.includes('2.5-flash-preview')) {
  savedModel = 'gemini-3.1-flash-live-preview';
  localStorage.setItem('gemini_model', savedModel);
}

const config = {
  apiKey: localStorage.getItem('gemini_api_key') || '',
  model: savedModel,
  voice: localStorage.getItem('gemini_voice') || 'Aoede',
  systemPrompt:
    localStorage.getItem('gemini_system_prompt') ||
    'Kamu adalah Maya, streamer AI yang cantik, cerdas, ramah, dan mempesona di TikTok Live. Jawab setiap komentar penonton secara langsung, padat (1-2 kalimat), dalam bahasa Indonesia yang anggun, santai, dan menyenangkan. Sapa penonton dengan hangat.',
  tiktokUsername: localStorage.getItem('tiktok_username') || '',
  tiktokWsUrl: localStorage.getItem('tiktok_ws_url') || 'ws://localhost:21213',
  filterMode: localStorage.getItem('tiktok_filter_mode') || 'all',
  cooldownSeconds: parseInt(localStorage.getItem('tiktok_cooldown') || '4', 10),
  clothColor: localStorage.getItem('ailive_cloth_color') || '#2563eb',
};

// Populate inputs
if (selectClothColor) selectClothColor.value = config.clothColor;
inputApiKey.value = config.apiKey;
selectModel.value = config.model;
selectVoice.value = config.voice;
inputSystemPrompt.value = config.systemPrompt;
inputTiktokUsername.value = config.tiktokUsername;
if (inputTiktokWsUrl) inputTiktokWsUrl.value = config.tiktokWsUrl;
selectFilterMode.value = config.filterMode;
inputCooldown.value = config.cooldownSeconds;
cooldownVal.textContent = `${config.cooldownSeconds} detik`;

inputCooldown.addEventListener('input', () => {
  cooldownVal.textContent = `${inputCooldown.value} detik`;
});

// --- 2. Initialize 3D Avatar Renderer ---
const avatarContainer = document.getElementById('avatar-viewport');
const avatarRenderer = new AvatarRenderer(avatarContainer);

// Setup loading indicator
avatarRenderer.setLoadingCallback((isLoading, text) => {
  if (isLoading) {
    stageLoaderEl.classList.add('visible');
    loaderStatusEl.textContent = text || 'Memuat...';
  } else {
    stageLoaderEl.classList.remove('visible');
  }
});

// Load default interactive VRM humanoid avatar
async function loadDefaultAvatar() {
  speechTextEl.textContent = 'Memuat Maya Anime Host (VRM)...';
  try {
    await avatarRenderer.loadModel(sampleVrmUrl, 'Maya Anime Host (VRM)');
    if (config.clothColor) {
      avatarRenderer.setClothColor(config.clothColor);
    }
    speechTextEl.textContent = '✨ Maya (VRM) aktif: Full animasi ekspresi, gestur tangan & bibir siap live!';
  } catch (err) {
    console.error('Gagal memuat VRM:', err);
    speechTextEl.textContent = `⚠️ Gagal memuat VRM: ${err.message}`;
  }
}
loadDefaultAvatar();

// Live cloth recoloring from select
if (selectClothColor) {
  selectClothColor.addEventListener('change', () => {
    config.clothColor = selectClothColor.value;
    localStorage.setItem('ailive_cloth_color', config.clothColor);
    avatarRenderer.setClothColor(config.clothColor);
  });
}

// Spontaneous gratitude reaction button
if (btnTriggerReaction) {
  btnTriggerReaction.addEventListener('click', () => {
    avatarRenderer.triggerReaction('thanks');
    speechTextEl.textContent = '✨ Maya: "Terima kasih banyak untuk dukungannya, semuanya!"';
    geminiClient.simulateSpeech(2.8);
  });
}

// --- 3. Initialize Gemini Live Client ---
let geminiClient = new GeminiLiveClient({
  apiKey: config.apiKey,
  model: config.model,
  voice: config.voice,
  systemInstruction: config.systemPrompt,
  onStatusChange: (status, message) => {
    geminiStatusEl.className = `status-pill ${
      status === 'connected'
        ? 'active'
        : status === 'error'
          ? 'error'
          : ''
    }`;
    geminiStatusEl.querySelector('.text').textContent = message;
  },
  onTranscript: (text) => {
    speechTextEl.textContent = text;
  },
  onAudioStart: () => {
    speakerTitleEl.textContent = `Maya (${config.voice}) Berbicara`;
    speakerTitleEl.style.color = '#10b981';
    tiktokManager.setAiSpeakingState(true);
  },
  onAudioEnd: () => {
    speakerTitleEl.textContent = 'Maya Mendengarkan';
    speakerTitleEl.style.color = 'var(--accent-rose)';
    tiktokManager.setAiSpeakingState(false);
  },
  onError: (errMsg) => {
    console.error('Gemini Error:', errMsg);
    speechTextEl.textContent = `⚠️ ${errMsg}`;
  },
});

// Link Audio volume to Avatar lip-sync and 3D visualizer
avatarRenderer.setAudioVolumeGetter(() => geminiClient.getAudioVolume());

// Animate soundwave bars
const soundwaveBars = soundwaveEl.querySelectorAll('.soundwave-bar');
function updateSoundwave() {
  requestAnimationFrame(updateSoundwave);
  const vol = geminiClient.getAudioVolume();
  soundwaveBars.forEach((bar, index) => {
    const scale = Math.sin(Date.now() * 0.012 + index * 0.8) * 0.5 + 0.5;
    const height = Math.max(3, vol * 16 * scale);
    bar.style.height = `${height}px`;
  });
}
updateSoundwave();

// --- 4. Initialize TikTok Live Manager ---
const recentJoiners = []; // Latest viewers who entered live stream

function updateGreetButtons() {
  const count = Math.min(3, recentJoiners.length);
  const btnQuick = document.getElementById('btn-quick-greet');
  const btnSim = document.getElementById('btn-sim-greet');
  const label = count > 0 ? `👋 Sapa ${count} Baru` : `👋 Sapa 3 Baru`;
  if (btnQuick) btnQuick.textContent = label;
  if (btnSim) btnSim.textContent = label;
}

const tiktokManager = new TikTokLiveManager({
  targetUsername: config.tiktokUsername,
  wsUrl: config.tiktokWsUrl,
  filterMode: config.filterMode,
  cooldownSeconds: config.cooldownSeconds,
  onStatusChange: (status, message) => {
    tiktokStatusEl.className = `status-pill ${
      status === 'connected'
        ? 'active'
        : status === 'error' || status === 'disconnected'
          ? 'error'
          : ''
    }`;
    tiktokStatusEl.querySelector('.text').textContent = message;
    tiktokStatusEl.title = message;
  },
  onNewComment: (comment) => {
    appendChatCard(comment);
    updateQueueBadge();
  },
  onNewGift: (gift) => {
    appendGiftCard(gift);
    updateQueueBadge();
    // Spontaneous emotional gratitude gesture for gifts (Love / Thanks / Peace)
    const giftReactions = ['love', 'thanks', 'peace'];
    const chosen = giftReactions[Math.floor(Math.random() * giftReactions.length)];
    avatarRenderer.triggerReaction(chosen, 3.5);
  },
  onNewLike: (like) => {
    // Spontaneous cute reaction for tap-tap screen likes
    if (Math.random() < 0.35) {
      const likeReactions = ['love', 'peace', 'wave'];
      const chosen = likeReactions[Math.floor(Math.random() * likeReactions.length)];
      avatarRenderer.triggerReaction(chosen, 2.5);
    }
  },
  onNewJoiner: (joiner) => {
    if (!recentJoiners.some((j) => j.nickname === joiner.nickname || j.uniqueId === joiner.uniqueId)) {
      recentJoiners.unshift(joiner);
      if (recentJoiners.length > 15) recentJoiners.pop();
      updateGreetButtons();
    }
  },
  onTriggerAiReply: async (commentData) => {
    updateQueueBadge();
    if (!geminiClient.isConnected) {
      if (config.apiKey) {
        geminiClient.connect();
        await new Promise((r) => setTimeout(r, 1200));
        speechTextEl.textContent = `[Merespon ${commentData.nickname}]: "${commentData.comment}"`;
        geminiClient.sendComment(commentData.nickname, commentData.comment);
      } else {
        // Offline preview simulation with full speech, gesture, and lip-sync
        const greetings = [
          `Halo kak ${commentData.nickname}! Makasih udah mampir dan ngobrol ya!`,
          `Hai ${commentData.nickname}! Senang banget kamu hadir di live kita!`,
          `Makasih ${commentData.nickname}! Enjoy siarannya ya!`
        ];
        const reply = greetings[Math.floor(Math.random() * greetings.length)];
        speechTextEl.textContent = `[Maya merespon ${commentData.nickname}]: "${reply}"`;
        geminiClient.simulateSpeech(2.8);
      }
      return;
    }
    speechTextEl.textContent = `[Merespon ${commentData.nickname}]: "${commentData.comment}"`;
    geminiClient.sendComment(commentData.nickname, commentData.comment);
  },
});

function triggerGreetRecentJoiners() {
  let names = [];
  if (recentJoiners.length > 0) {
    names = recentJoiners.slice(0, 3).map((j) => j.nickname || j.uniqueId);
  } else {
    // Fallback: pick names from recent commenters if no join events yet
    const commenters = Array.from(chatFeedEl.querySelectorAll('.chat-item:not(.gift-item) .author-line'))
      .map((el) => el.textContent.replace(/^@/, '').trim())
      .filter((n) => n && n !== 'Penonton');
    const uniqueCommenters = Array.from(new Set(commenters));
    names = uniqueCommenters.slice(-3);
  }

  if (names.length === 0) {
    names = ['Sahabat TikTok', 'Teman-teman Online'];
  }

  const namesText = names.join(', ');
  speechTextEl.textContent = `[Maya menyapa penonton]: "Halo Kak ${namesText}! Selamat datang di live kita!"`;
  avatarRenderer.triggerReaction('thanks');

  if (geminiClient.isConnected) {
    geminiClient.greetJoiners(names);
  } else {
    geminiClient.simulateSpeech(2.5);
  }
}

function updateQueueBadge() {
  const count = tiktokManager.commentQueue.length;
  queueBadgeEl.textContent = `Antrian: ${count}`;
}

function appendChatCard(data) {
  const item = document.createElement('div');
  item.className = 'chat-item';
  item.innerHTML = `
    <div class="author-line">@${escapeHtml(data.uniqueId)}</div>
    <div class="comment-body">${escapeHtml(data.comment)}</div>
  `;
  chatFeedEl.appendChild(item);
  chatFeedEl.scrollTop = chatFeedEl.scrollHeight;

  while (chatFeedEl.children.length > 100) {
    chatFeedEl.removeChild(chatFeedEl.firstChild);
  }
}

function appendGiftCard(data) {
  const item = document.createElement('div');
  item.className = 'chat-item gift-item';
  item.innerHTML = `
    <div class="author-line">
      <svg viewBox="0 0 24 24" style="width: 12px; height: 12px; stroke: currentColor; fill: none; stroke-width: 2;"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/></svg>
      @${escapeHtml(data.nickname)}
    </div>
    <div class="comment-body">Mengirim <strong>${escapeHtml(data.giftName)}</strong> x${data.repeatCount}!</div>
  `;
  chatFeedEl.appendChild(item);
  chatFeedEl.scrollTop = chatFeedEl.scrollHeight;

  while (chatFeedEl.children.length > 100) {
    chatFeedEl.removeChild(chatFeedEl.firstChild);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

// Resume AudioContext on first user gesture (mobile autoplay policy)
function onFirstInteraction() {
  geminiClient.ensureAudioResumed();
  document.removeEventListener('click', onFirstInteraction);
  document.removeEventListener('touchstart', onFirstInteraction);
}
document.addEventListener('click', onFirstInteraction);
document.addEventListener('touchstart', onFirstInteraction);

if (config.apiKey) {
  geminiClient.connect();
}
if (config.tiktokUsername || config.tiktokWsUrl) {
  tiktokManager.connect(config.tiktokUsername || config.tiktokWsUrl);
}

// --- 5. Event Listeners ---

// File loader (VRM Model)
modelFileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    await avatarRenderer.loadModel(file, file.name);
    speechTextEl.textContent = `Model ${file.name} berhasil dimuat.`;
  } catch (err) {
    speechTextEl.textContent = `⚠️ Gagal memuat model: ${err.message}`;
  }
  modelFileInput.value = '';
});

// Drag and drop 3D file directly into window
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files?.[0];
  if (file && (file.name.endsWith('.vrm') || file.name.endsWith('.glb') || file.name.endsWith('.gltf'))) {
    try {
      await avatarRenderer.loadModel(file, file.name);
      speechTextEl.textContent = `Model ${file.name} berhasil dimuat.`;
    } catch (err) {
      speechTextEl.textContent = `⚠️ Gagal memuat model: ${err.message}`;
    }
  }
});

// OBS Mode
let isObs = false;
function toggleObsMode() {
  isObs = !isObs;
  document.body.classList.toggle('obs-mode', isObs);
  btnToggleObs.classList.toggle('btn-accent', isObs);
}
btnToggleObs.addEventListener('click', toggleObsMode);
if (btnMobileObs) btnMobileObs.addEventListener('click', toggleObsMode);

// Mobile Chat Drawer Controls
const sheetBackdrop = document.getElementById('sheet-backdrop');
const btnCloseSheet = document.getElementById('btn-close-sheet');

function closeMobileSheet() {
  sidebarEl.classList.remove('sheet-open');
  if (btnMobileChat) btnMobileChat.classList.remove('active');
  const mobileDock = document.querySelector('.mobile-dock');
  if (mobileDock) mobileDock.classList.remove('dock-hidden');
  if (sheetBackdrop) sheetBackdrop.classList.remove('visible');
}

function openMobileSheet() {
  sidebarEl.classList.add('sheet-open');
  if (btnMobileChat) btnMobileChat.classList.add('active');
  const mobileDock = document.querySelector('.mobile-dock');
  if (mobileDock) mobileDock.classList.add('dock-hidden');
  if (sheetBackdrop) sheetBackdrop.classList.add('visible');
}

if (btnMobileChat) {
  btnMobileChat.addEventListener('click', () => {
    if (sidebarEl.classList.contains('sheet-open')) {
      closeMobileSheet();
    } else {
      openMobileSheet();
    }
  });
}
if (btnCloseSheet) btnCloseSheet.addEventListener('click', closeMobileSheet);
if (sheetBackdrop) sheetBackdrop.addEventListener('click', closeMobileSheet);

// Settings Modal Controls
const openSettings = () => settingsModal.classList.add('active');
const closeSettings = () => settingsModal.classList.remove('active');

btnOpenSettings.addEventListener('click', openSettings);
if (btnMobileSettings) btnMobileSettings.addEventListener('click', openSettings);
btnCloseSettings.addEventListener('click', closeSettings);
btnCancelSettings.addEventListener('click', closeSettings);

settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) closeSettings();
});

// Save Settings
btnSaveSettings.addEventListener('click', () => {
  const oldApiKey = config.apiKey;
  const oldModel = config.model;
  const oldVoice = config.voice;
  const oldSystemPrompt = config.systemPrompt;
  const oldTiktokUsername = config.tiktokUsername;
  const oldTiktokWsUrl = config.tiktokWsUrl;

  config.apiKey = inputApiKey.value.trim();
  config.model = selectModel.value;
  config.voice = selectVoice.value;
  config.systemPrompt = inputSystemPrompt.value.trim();
  config.tiktokUsername = inputTiktokUsername.value.trim();
  config.tiktokWsUrl = (inputTiktokWsUrl ? inputTiktokWsUrl.value.trim() : '') || 'ws://localhost:21213';
  config.filterMode = selectFilterMode.value;
  config.cooldownSeconds = parseInt(inputCooldown.value, 10);
  if (selectClothColor) {
    config.clothColor = selectClothColor.value;
    localStorage.setItem('ailive_cloth_color', config.clothColor);
    avatarRenderer.setClothColor(config.clothColor);
  }

  localStorage.setItem('gemini_api_key', config.apiKey);
  localStorage.setItem('gemini_model', config.model);
  localStorage.setItem('gemini_voice', config.voice);
  localStorage.setItem('gemini_system_prompt', config.systemPrompt);
  localStorage.setItem('tiktok_username', config.tiktokUsername);
  localStorage.setItem('tiktok_ws_url', config.tiktokWsUrl);
  localStorage.setItem('tiktok_filter_mode', config.filterMode);
  localStorage.setItem('tiktok_cooldown', config.cooldownSeconds);

  // Update Gemini: only reconnect if settings actually changed
  const geminiSettingsChanged =
    oldApiKey !== config.apiKey ||
    oldModel !== config.model ||
    oldVoice !== config.voice ||
    oldSystemPrompt !== config.systemPrompt;

  if (geminiSettingsChanged) {
    geminiClient.disconnect();
    geminiClient.apiKey = config.apiKey;
    geminiClient.model = config.model;
    geminiClient.voice = config.voice;
    geminiClient.systemInstruction = config.systemPrompt;
    if (config.apiKey) {
      geminiClient.connect();
    }
  }

  // Update TikTok: ONLY reconnect if target username or ws url was CHANGED!
  // If streamer username is the same, keep existing connection running smoothly without resetting!
  tiktokManager.filterMode = config.filterMode;
  tiktokManager.cooldownSeconds = config.cooldownSeconds;

  const tiktokTargetChanged =
    oldTiktokUsername !== config.tiktokUsername ||
    oldTiktokWsUrl !== config.tiktokWsUrl;

  if (tiktokTargetChanged && (config.tiktokUsername || config.tiktokWsUrl)) {
    tiktokManager.disconnect();
    tiktokManager.setTargetUsername(config.tiktokUsername);
    tiktokManager.setWsUrl(config.tiktokWsUrl);
    tiktokManager.connect(config.tiktokUsername || config.tiktokWsUrl);
  }

  closeSettings();
  speechTextEl.textContent = 'Pengaturan berhasil diperbarui (Live tetap lanjut).';
});

// Quick Greetings Buttons (Sapa 3 Penonton Baru)
const btnQuickGreet = document.getElementById('btn-quick-greet');
const btnSimGreet = document.getElementById('btn-sim-greet');
if (btnQuickGreet) btnQuickGreet.addEventListener('click', triggerGreetRecentJoiners);
if (btnSimGreet) btnSimGreet.addEventListener('click', triggerGreetRecentJoiners);

// Modular Hand Poses & Expressions (❤️ Love, 🖕 Jari Tengah, 🙈 Sembunyi/👀 Muncul, ✌️ Peace, 👋 Wave, 💃 Joget, 🙏 Makasih)
function updateHideButtons(isHiding) {
  document.querySelectorAll('[data-pose="hide"]').forEach((btn) => {
    if (isHiding) {
      btn.innerHTML = '👀 Muncul';
      btn.setAttribute('title', 'Klik untuk keluar dari persembunyian');
      btn.classList.add('btn-accent');
    } else {
      btn.innerHTML = '🙈 Sembunyi';
      btn.setAttribute('title', 'Pose Petak Umpet');
      btn.classList.remove('btn-accent');
    }
  });
}

avatarRenderer.onHideStateChange = (isHiding) => {
  updateHideButtons(isHiding);
};

document.querySelectorAll('.stage-pose-pill, .pose-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const pose = btn.getAttribute('data-pose');
    if (!pose) return;

    if (pose === 'hide') {
      const isNowHiding = avatarRenderer.toggleHide();
      speechTextEl.textContent = isNowHiding
        ? '[Avatar Sembunyi]: Lari malu-malu sembunyi di balik dinding... 👀'
        : '[Avatar Muncul]: Lari ceria kembali ke panggung! ✨';
      return;
    }

    avatarRenderer.triggerReaction(pose, 3.5);
    speechTextEl.textContent = `[Pose Avatar]: Menjalankan pose "${pose}"...`;
  });
});

// Camera Zoom Controls (Zoom In, Zoom Out, Reset 1x)
const btnZoomIn = document.getElementById('btn-zoom-in');
const btnZoomOut = document.getElementById('btn-zoom-out');
const btnZoomReset = document.getElementById('btn-zoom-reset');

if (btnZoomIn) {
  btnZoomIn.addEventListener('click', () => {
    avatarRenderer.setCameraZoom(avatarRenderer.cameraZoom - 0.22);
  });
}
if (btnZoomOut) {
  btnZoomOut.addEventListener('click', () => {
    avatarRenderer.setCameraZoom(avatarRenderer.cameraZoom + 0.22);
  });
}
if (btnZoomReset) {
  btnZoomReset.addEventListener('click', () => {
    avatarRenderer.setCameraZoom(1.85);
  });
}

// Simulator Chat Send
btnSimSend.addEventListener('click', () => {
  const user = simUser.value.trim() || 'Penonton';
  const text = simText.value.trim();
  if (!text) return;
  tiktokManager.simulateComment(user, text);
  simText.value = '';
});

simText.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    btnSimSend.click();
  }
});

btnQuickGift.addEventListener('click', () => {
  const user = simUser.value.trim() || 'Sultan';
  tiktokManager.simulateGift(user, 'Mawar Merah', 1);
  avatarRenderer.triggerReaction('thanks');
});
