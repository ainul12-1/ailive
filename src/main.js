import { GeminiLiveClient } from './gemini-live.js';
import { AvatarRenderer } from './avatar-renderer.js';
import { TikTokLiveManager } from './tiktok-live.js';

// Assets
import weddingGirlUrl from './assets/WhiteWeddingDressGirl.glb?url';
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
// Clean up any invalid cached model from localStorage
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
};

// Populate inputs
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

// Auto-load user's default 3D avatar on startup (WhiteWeddingDressGirl)
async function loadDefaultAvatar() {
  try {
    await avatarRenderer.loadModel(weddingGirlUrl, 'Avatar 3D');
  } catch (err) {
    console.warn('Gagal memuat GLB default, mencoba VRM fallback...', err);
    try {
      await avatarRenderer.loadModel(sampleVrmUrl, 'Sample VRM');
    } catch (e) {
      console.error('Gagal memuat model:', e);
    }
  }
}
loadDefaultAvatar();

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
    // Notify TikTok manager that AI is speaking
    tiktokManager.setAiSpeakingState(true);
  },
  onAudioEnd: () => {
    speakerTitleEl.textContent = 'Maya Mendengarkan';
    speakerTitleEl.style.color = 'var(--accent-rose)';
    // Notify TikTok manager that AI finished speaking
    tiktokManager.setAiSpeakingState(false);
  },
  onError: (errMsg) => {
    // Use non-blocking notification instead of alert()
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
const tiktokManager = new TikTokLiveManager({
  targetUsername: config.tiktokUsername,
  wsUrl: config.tiktokWsUrl,
  filterMode: config.filterMode,
  cooldownSeconds: config.cooldownSeconds,
  onStatusChange: (status, message) => {
    tiktokStatusEl.className = `status-pill ${
      status === 'connected'
        ? 'active'
        : status === 'error'
          ? 'error'
          : ''
    }`;
    tiktokStatusEl.querySelector('.text').textContent = message;
  },
  onNewComment: (comment) => {
    appendChatCard(comment);
    updateQueueBadge();
  },
  onNewGift: (gift) => {
    appendGiftCard(gift);
    updateQueueBadge();
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
          `Halo kak ${commentData.nickname}! Makasih banyak udah mampir dan ngobrol di live Maya hari ini!`,
          `Hai ${commentData.nickname}! Wah seru banget pertanyaannya, salam kenal ya!`,
          `Makasih ${commentData.nickname}! Tetap semangat dan enjoy nonton live streaming ini ya!`
        ];
        const reply = greetings[Math.floor(Math.random() * greetings.length)];
        speechTextEl.textContent = `[Maya merespon ${commentData.nickname}]: "${reply}"`;
        geminiClient.simulateSpeech(3.5);
      }
      return;
    }
    speechTextEl.textContent = `[Merespon ${commentData.nickname}]: "${commentData.comment}"`;
    geminiClient.sendComment(commentData.nickname, commentData.comment);
  },
});

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

  // Limit chat history to prevent DOM bloat
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

// --- FIX: Resume AudioContext on first user gesture (mobile autoplay policy) ---
function onFirstInteraction() {
  geminiClient.ensureAudioResumed();
  document.removeEventListener('click', onFirstInteraction);
  document.removeEventListener('touchstart', onFirstInteraction);
}
document.addEventListener('click', onFirstInteraction);
document.addEventListener('touchstart', onFirstInteraction);

// Auto connect if credentials exist (but don't auto-connect on load to avoid
// autoplay issues - Gemini will connect on first interaction or save)
if (config.apiKey) {
  geminiClient.connect();
}
if (config.tiktokUsername || config.tiktokWsUrl) {
  tiktokManager.connect(config.tiktokWsUrl);
}

// --- 5. Event Listeners ---

// File loader (VRM, GLB, GLTF)
modelFileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    await avatarRenderer.loadModel(file, file.name);
    speechTextEl.textContent = `Model ${file.name} berhasil dimuat.`;
  } catch (err) {
    speechTextEl.textContent = `⚠️ Gagal memuat model: ${err.message}`;
  }
  // Reset file input so same file can be selected again
  modelFileInput.value = '';
});

// Drag and drop 3D file directly into window
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files?.[0];
  if (
    file &&
    (file.name.endsWith('.glb') ||
      file.name.endsWith('.vrm') ||
      file.name.endsWith('.gltf'))
  ) {
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

if (sheetBackdrop) sheetBackdrop.addEventListener('click', closeMobileSheet);
if (btnCloseSheet) btnCloseSheet.addEventListener('click', closeMobileSheet);

// Settings Modal
const openSettings = () => settingsModal.classList.add('active');
const closeSettings = () => settingsModal.classList.remove('active');

btnOpenSettings.addEventListener('click', openSettings);
if (btnMobileSettings) btnMobileSettings.addEventListener('click', openSettings);
btnCloseSettings.addEventListener('click', closeSettings);
btnCancelSettings.addEventListener('click', closeSettings);

// Close modal on backdrop click
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) closeSettings();
});

// Save Settings
btnSaveSettings.addEventListener('click', () => {
  config.apiKey = inputApiKey.value.trim();
  config.model = selectModel.value;
  config.voice = selectVoice.value;
  config.systemPrompt = inputSystemPrompt.value.trim();
  config.tiktokUsername = inputTiktokUsername.value.trim();
  config.tiktokWsUrl = (inputTiktokWsUrl ? inputTiktokWsUrl.value.trim() : '') || 'ws://localhost:21213';
  config.filterMode = selectFilterMode.value;
  config.cooldownSeconds = parseInt(inputCooldown.value, 10);

  localStorage.setItem('gemini_api_key', config.apiKey);
  localStorage.setItem('gemini_model', config.model);
  localStorage.setItem('gemini_voice', config.voice);
  localStorage.setItem('gemini_system_prompt', config.systemPrompt);
  localStorage.setItem('tiktok_username', config.tiktokUsername);
  localStorage.setItem('tiktok_ws_url', config.tiktokWsUrl);
  localStorage.setItem('tiktok_filter_mode', config.filterMode);
  localStorage.setItem('tiktok_cooldown', config.cooldownSeconds);

  // Update Gemini
  geminiClient.disconnect();
  geminiClient.apiKey = config.apiKey;
  geminiClient.model = config.model;
  geminiClient.voice = config.voice;
  geminiClient.systemInstruction = config.systemPrompt;
  if (config.apiKey) {
    geminiClient.connect();
  }

  // Update TikTok
  tiktokManager.setTargetUsername(config.tiktokUsername);
  tiktokManager.setWsUrl(config.tiktokWsUrl);
  tiktokManager.filterMode = config.filterMode;
  tiktokManager.cooldownSeconds = config.cooldownSeconds;
  if (config.tiktokUsername || config.tiktokWsUrl) {
    tiktokManager.connect(config.tiktokWsUrl);
  }

  closeSettings();
  speechTextEl.textContent = 'Pengaturan berhasil disimpan.';
});

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
});
