import { GeminiLiveClient } from './gemini-live.js';
import { AvatarRenderer } from './avatar-renderer.js';
import { TikTokLiveManager } from './tiktok-live.js';

// Elements
const geminiStatusEl = document.getElementById('gemini-status');
const tiktokStatusEl = document.getElementById('tiktok-status');
const transcriptDisplayEl = document.getElementById('transcript-display');
const speakerNameEl = document.getElementById('speaker-name');
const chatFeedEl = document.getElementById('chat-feed');
const queueBadgeEl = document.getElementById('queue-badge');
const soundwaveEl = document.getElementById('soundwave');
const vrmFileInput = document.getElementById('vrm-file-input');
const btnToggleObs = document.getElementById('btn-toggle-obs');
const btnOpenSettings = document.getElementById('btn-open-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnCancelSettings = document.getElementById('btn-cancel-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');
const btnResetAvatar = document.getElementById('btn-reset-avatar');
const settingsModal = document.getElementById('settings-modal');

// Settings Inputs
const inputApiKey = document.getElementById('input-api-key');
const selectModel = document.getElementById('select-model');
const selectVoice = document.getElementById('select-voice');
const inputSystemPrompt = document.getElementById('input-system-prompt');
const inputTiktokUsername = document.getElementById('input-tiktok-username');
const selectFilterMode = document.getElementById('select-filter-mode');
const inputCooldown = document.getElementById('input-cooldown');
const cooldownVal = document.getElementById('cooldown-val');

// Simulator Inputs
const simUser = document.getElementById('sim-user');
const simText = document.getElementById('sim-text');
const btnSimSend = document.getElementById('btn-sim-send');
const btnQuickGift = document.getElementById('btn-quick-gift');

// --- 1. Load Stored Configuration ---
const config = {
  apiKey: localStorage.getItem('gemini_api_key') || '',
  model: localStorage.getItem('gemini_model') || 'gemini-3.1-flash-live-preview',
  voice: localStorage.getItem('gemini_voice') || 'Puck',
  systemPrompt: localStorage.getItem('gemini_system_prompt') || 'Kamu adalah host live stream AI di TikTok bernama Maya. Kamu ceria, ramah, suka bercanda, dan ekspresif. Jawab komentar penonton dalam bahasa Indonesia santai secara langsung dan padat (1-2 kalimat). Sapa nama penonton yang bertanya.',
  tiktokUsername: localStorage.getItem('tiktok_username') || '',
  filterMode: localStorage.getItem('tiktok_filter_mode') || 'all',
  cooldownSeconds: parseInt(localStorage.getItem('tiktok_cooldown') || '4', 10),
};

// Populate inputs
inputApiKey.value = config.apiKey;
selectModel.value = config.model;
selectVoice.value = config.voice;
inputSystemPrompt.value = config.systemPrompt;
inputTiktokUsername.value = config.tiktokUsername;
selectFilterMode.value = config.filterMode;
inputCooldown.value = config.cooldownSeconds;
cooldownVal.textContent = `${config.cooldownSeconds} detik`;

inputCooldown.addEventListener('input', () => {
  cooldownVal.textContent = `${inputCooldown.value} detik`;
});

// --- 2. Initialize 3D Avatar Renderer ---
const avatarContainer = document.getElementById('avatar-viewport');
const avatarRenderer = new AvatarRenderer(avatarContainer);

// --- 3. Initialize Gemini Live Client ---
let geminiClient = new GeminiLiveClient({
  apiKey: config.apiKey,
  model: config.model,
  voice: config.voice,
  systemInstruction: config.systemPrompt,
  onStatusChange: (status, message) => {
    geminiStatusEl.className = `badge-status ${status}`;
    geminiStatusEl.querySelector('.text').textContent = message;
  },
  onTranscript: (text) => {
    transcriptDisplayEl.textContent = text;
  },
  onAudioStart: () => {
    speakerNameEl.textContent = `Maya (${config.voice}) Berbicara...`;
    speakerNameEl.style.color = '#10b981';
  },
  onAudioEnd: () => {
    speakerNameEl.textContent = 'Maya Mendengarkan...';
    speakerNameEl.style.color = '#00f0ff';
  },
  onError: (errMsg) => {
    alert(errMsg);
  }
});

// Link Audio volume to Avatar lip-sync and 3D visualizer
avatarRenderer.setAudioVolumeGetter(() => geminiClient.getAudioVolume());

// Animate soundwave visualizer
const soundwaveBars = soundwaveEl.querySelectorAll('.soundwave-bar');
function updateSoundwave() {
  requestAnimationFrame(updateSoundwave);
  const vol = geminiClient.getAudioVolume();
  soundwaveBars.forEach((bar, index) => {
    const scale = Math.sin(Date.now() * 0.01 + index) * 0.5 + 0.5;
    const height = Math.max(3, vol * 14 * scale);
    bar.style.height = `${height}px`;
  });
}
updateSoundwave();

// --- 4. Initialize TikTok Live Manager ---
const tiktokManager = new TikTokLiveManager({
  targetUsername: config.tiktokUsername,
  filterMode: config.filterMode,
  cooldownSeconds: config.cooldownSeconds,
  onStatusChange: (status, message) => {
    tiktokStatusEl.className = `badge-status ${status}`;
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
      console.warn('Gemini belum terhubung, mencoba menyambungkan...');
      geminiClient.connect();
    }
    transcriptDisplayEl.textContent = `[Merespon ${commentData.nickname}...]: "${commentData.comment}"`;
    geminiClient.sendComment(commentData.nickname, commentData.comment);
  }
});

function updateQueueBadge() {
  const count = tiktokManager.commentQueue.length;
  queueBadgeEl.textContent = `Antrian: ${count}`;
}

function appendChatCard(data) {
  const card = document.createElement('div');
  card.className = 'chat-card';
  card.innerHTML = `
    <div class="user-name">@${data.uniqueId}</div>
    <div class="comment-text">${escapeHtml(data.comment)}</div>
  `;
  chatFeedEl.appendChild(card);
  chatFeedEl.scrollTop = chatFeedEl.scrollHeight;
}

function appendGiftCard(data) {
  const card = document.createElement('div');
  card.className = 'chat-card gift-card';
  card.innerHTML = `
    <div class="user-name">🎁 @${data.nickname}</div>
    <div class="comment-text">Mengirim <strong>${escapeHtml(data.giftName)}</strong> x${data.repeatCount}!</div>
  `;
  chatFeedEl.appendChild(card);
  chatFeedEl.scrollTop = chatFeedEl.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

// Auto connect if API key exists
if (config.apiKey) {
  geminiClient.connect();
}
if (config.tiktokUsername) {
  tiktokManager.connectTikFinity();
}

// --- 5. UI Event Listeners ---

// VRM 3D File Loader
vrmFileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    transcriptDisplayEl.textContent = `Memuat model 3D VRM: ${file.name}...`;
    await avatarRenderer.loadVRM(file);
    transcriptDisplayEl.textContent = `Model 3D ${file.name} berhasil dimuat! Siap live.`;
  } catch (err) {
    alert(`Gagal memuat model VRM: ${err.message}`);
  }
});

btnResetAvatar.addEventListener('click', () => {
  avatarRenderer.resetToCyberAvatar();
  settingsModal.classList.remove('active');
  transcriptDisplayEl.textContent = 'Kembali ke 3D Cyber Core Avatar bawaan.';
});

// OBS Mode Toggle
let isObsMode = false;
btnToggleObs.addEventListener('click', () => {
  isObsMode = !isObsMode;
  document.body.classList.toggle('obs-mode', isObsMode);
  btnToggleObs.classList.toggle('btn-primary', isObsMode);
  btnToggleObs.querySelector('span').textContent = isObsMode ? '🖥️' : '🎥';
});

// Modal Open/Close
btnOpenSettings.addEventListener('click', () => settingsModal.classList.add('active'));
btnCloseSettings.addEventListener('click', () => settingsModal.classList.remove('active'));
btnCancelSettings.addEventListener('click', () => settingsModal.classList.remove('active'));

// Save Settings
btnSaveSettings.addEventListener('click', () => {
  config.apiKey = inputApiKey.value.trim();
  config.model = selectModel.value;
  config.voice = selectVoice.value;
  config.systemPrompt = inputSystemPrompt.value.trim();
  config.tiktokUsername = inputTiktokUsername.value.trim();
  config.filterMode = selectFilterMode.value;
  config.cooldownSeconds = parseInt(inputCooldown.value, 10);

  // Save to local storage
  localStorage.setItem('gemini_api_key', config.apiKey);
  localStorage.setItem('gemini_model', config.model);
  localStorage.setItem('gemini_voice', config.voice);
  localStorage.setItem('gemini_system_prompt', config.systemPrompt);
  localStorage.setItem('tiktok_username', config.tiktokUsername);
  localStorage.setItem('tiktok_filter_mode', config.filterMode);
  localStorage.setItem('tiktok_cooldown', config.cooldownSeconds);

  // Re-configure Gemini Live
  geminiClient.disconnect();
  geminiClient.apiKey = config.apiKey;
  geminiClient.model = config.model;
  geminiClient.voice = config.voice;
  geminiClient.systemInstruction = config.systemPrompt;
  if (config.apiKey) {
    geminiClient.connect();
  }

  // Re-configure TikTok Manager
  tiktokManager.setTargetUsername(config.tiktokUsername);
  tiktokManager.filterMode = config.filterMode;
  tiktokManager.cooldownSeconds = config.cooldownSeconds;
  if (config.tiktokUsername) {
    tiktokManager.connectTikFinity();
  }

  settingsModal.classList.remove('active');
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
  const user = simUser.value.trim() || 'Sultan_TikTok';
  tiktokManager.simulateGift(user, 'Mawar Merah', 1);
});
