/**
 * TikTok Live Stream Manager & Event Queue
 * Dual-Mode Connector:
 *  1. Native Rust Engine (inside Tauri .exe & .apk): Directly connects to TikTok Live
 *     without needing TikFinity, Node.js, or external software!
 *  2. Browser WebSocket Fallback (TikFinity / scripts/tiktok-bridge.js)
 */

export class TikTokLiveManager {
  constructor(options = {}) {
    this.targetUsername = options.targetUsername || '';
    this.filterMode = options.filterMode || 'all'; // 'all', 'questions', 'mentions'
    this.cooldownSeconds = options.cooldownSeconds || 4;
    this.wsUrl = options.wsUrl || 'ws://localhost:21213';

    this.isConnected = false;
    this.ws = null;
    this.commentQueue = [];
    this.isProcessingQueue = false;
    this.lastReplyTime = 0;

    // Auto-reconnect engine
    this.shouldAutoReconnect = true;
    this.reconnectTimer = null;
    this.reconnectDelay = 3000;

    // Track AI speaking state
    this._isAiSpeaking = false;
    this._aiFinishResolver = null;
    this._hasTauriListeners = false;

    // Callbacks
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onNewComment = options.onNewComment || (() => {});
    this.onNewGift = options.onNewGift || (() => {});
    this.onNewLike = options.onNewLike || (() => {});
    this.onTriggerAiReply = options.onTriggerAiReply || (() => {});
  }

  setAiSpeakingState(isSpeaking) {
    this._isAiSpeaking = isSpeaking;
    if (!isSpeaking && this._aiFinishResolver) {
      this._aiFinishResolver();
      this._aiFinishResolver = null;
    }
  }

  _waitForAiFinish() {
    if (!this._isAiSpeaking) return Promise.resolve();
    return new Promise((resolve) => {
      this._aiFinishResolver = resolve;
    });
  }

  setTargetUsername(username) {
    this.targetUsername = username.replace(/^@/, '').trim();
  }

  setWsUrl(url) {
    if (url && url.trim()) {
      this.wsUrl = url.trim();
    }
  }

  /**
   * Universal Connect: Direct Native in Tauri (.exe/.apk) or WebSocket Fallback in Browser
   */
  async connect(target = null) {
    if (target && !target.startsWith('ws://') && !target.startsWith('wss://')) {
      this.setTargetUsername(target);
    } else if (target) {
      this.setWsUrl(target);
    }

    const isTauri = typeof window !== 'undefined' && (!!window.__TAURI__ || !!window.__TAURI_INTERNALS__);

    // 1. Native Direct Mode in Tauri (.exe / .apk)
    if (isTauri && this.targetUsername) {
      console.log(`🚀 [Tauri Native TikTok]: Menghubungkan langsung ke live @${this.targetUsername}...`);
      this.onStatusChange('connecting', `Menghubungkan ke live @${this.targetUsername}...`);

      try {
        if (!this._hasTauriListeners) {
          this._hasTauriListeners = true;
          const eventApi = window.__TAURI__.event;

          await eventApi.listen('tiktok-chat', (event) => {
            this.handleIncomingEvent({ event: 'chat', data: event.payload });
          });

          await eventApi.listen('tiktok-gift', (event) => {
            this.handleIncomingEvent({ event: 'gift', data: event.payload });
          });

          await eventApi.listen('tiktok-like', (event) => {
            this.handleIncomingEvent({ event: 'like', data: event.payload });
          });

          await eventApi.listen('tiktok-status', (event) => {
            const { status, message } = event.payload;
            this.isConnected = status === 'connected';
            this.onStatusChange(status, message);
          });
        }

        const coreApi = window.__TAURI__.core;
        await coreApi.invoke('start_tiktok_listener', { username: this.targetUsername });
        return;
      } catch (err) {
        console.warn('Native listener invocation failed, falling back to WebSocket bridge:', err);
      }
    }

    // 2. Browser WebSocket Bridge Fallback (TikFinity / scripts/tiktok-bridge.js)
    this.connectWebSocket();
  }

  connectWebSocket() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }

    const targetUrl = this.wsUrl;
    const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isLocalhost = targetUrl.includes('localhost') || targetUrl.includes('127.0.0.1');

    if (isMobile && isLocalhost) {
      this.onStatusChange(
        'idle',
        'HP Android: Masukkan IP PC (misal: ws://192.168.1.XX:21213) di Pengaturan atau gunakan Simulator'
      );
      console.warn('⚠️ [AILIVE Android]: localhost tidak dapat diakses dari HP. Silakan atur IP PC di Pengaturan.');
      return;
    }

    this.onStatusChange('connecting', `Menyambungkan (${targetUrl})...`);

    try {
      this.ws = new WebSocket(targetUrl);
    } catch (e) {
      this.onStatusChange('error', `Gagal buka socket: ${e.message}`);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.isConnected = true;
      this.reconnectDelay = 3000;
      this.onStatusChange('connected', `TikTok Live Terhubung`);
      console.log(`✅ [TikTok WebSocket Terhubung]: ${targetUrl}`);
    };

    this.ws.onmessage = (event) => {
      try {
        let payload = event.data;
        if (typeof payload === 'string') {
          payload = JSON.parse(payload);
        }
        this.handleIncomingEvent(payload);
      } catch (err) {
        console.error('Error parsing TikTok payload:', err, event.data);
      }
    };

    this.ws.onerror = () => {
      this.onStatusChange(
        'idle',
        `TikTok Offline (Mencari TikFinity / Bridge di ${targetUrl})`
      );
    };

    this.ws.onclose = () => {
      this.isConnected = false;
      this.onStatusChange('disconnected', 'Terputus dari TikTok Live');
      this.scheduleReconnect();
    };
  }

  // Alias for backward compatibility
  connectTikFinity(port = 21213) {
    this.connect();
  }

  scheduleReconnect() {
    if (!this.shouldAutoReconnect) return;
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isConnected && (this.targetUsername || this.wsUrl)) {
        this.connect();
      }
    }, this.reconnectDelay);

    this.reconnectDelay = Math.min(15000, this.reconnectDelay * 1.5);
  }

  /**
   * UNIVERSAL EVENT PARSER
   * Extracts chat, gifts, and likes from native Rust, TikFinity, Bridge, or Streamer.bot
   */
  handleIncomingEvent(raw) {
    if (!raw) return;

    const eventType = String(raw.event || raw.type || '').toLowerCase();
    const data = raw.data || raw;

    // 1. CHAT / COMMENT EVENT
    const isChat =
      eventType === 'chat' ||
      eventType === 'comment' ||
      typeof data.comment === 'string' ||
      typeof raw.comment === 'string';

    if (isChat) {
      const user = data.user || raw.user || {};
      const uniqueId =
        user.uniqueId ||
        user.username ||
        data.uniqueId ||
        raw.uniqueId ||
        user.nickname ||
        data.nickname ||
        'Penonton';

      const nickname =
        user.nickname ||
        data.nickname ||
        user.uniqueId ||
        data.uniqueId ||
        'Penonton';

      const comment =
        data.comment ||
        raw.comment ||
        data.text ||
        raw.text ||
        '';

      if (!comment || !String(comment).trim()) {
        return;
      }

      const commentData = {
        uniqueId: String(uniqueId).replace(/^@/, '').trim(),
        nickname: String(nickname).trim(),
        comment: String(comment).trim(),
        avatar: user.profilePictureUrl || data.profilePictureUrl || null,
        timestamp: Date.now(),
      };

      console.log(`💬 [TikTok Chat]: @${commentData.uniqueId}: "${commentData.comment}"`);
      this.onNewComment(commentData);
      this.enqueueComment(commentData);
      return;
    }

    // 2. GIFT EVENT
    const isGift =
      eventType === 'gift' ||
      data.giftName !== undefined ||
      raw.giftName !== undefined ||
      data.giftId !== undefined;

    if (isGift) {
      const user = data.user || raw.user || {};
      const uniqueId =
        user.uniqueId ||
        user.nickname ||
        data.uniqueId ||
        data.nickname ||
        'Penonton';

      const nickname =
        user.nickname ||
        data.nickname ||
        user.uniqueId ||
        data.uniqueId ||
        'Penonton';

      const giftName =
        data.giftName ||
        raw.giftName ||
        data.name ||
        'Gift Cantik';

      const repeatCount = Number(data.repeatCount || raw.repeatCount || data.count || 1);
      const diamondCount = Number(data.diamondCount || data.diamondTotal || data.coins || 1);

      const giftData = {
        uniqueId: String(uniqueId).replace(/^@/, '').trim(),
        nickname: String(nickname).trim(),
        giftName: String(giftName).trim(),
        repeatCount: Math.max(1, repeatCount),
        diamonds: Math.max(1, diamondCount),
      };

      console.log(`🎁 [TikTok Gift]: @${giftData.nickname} mengirim ${giftData.giftName} x${giftData.repeatCount}`);
      this.onNewGift(giftData);

      this.enqueueComment(
        {
          uniqueId: giftData.nickname,
          nickname: giftData.nickname,
          comment: `[Mengirim Gift: ${giftData.giftName} x${giftData.repeatCount}!] Tolong ucapkan terima kasih yang heboh, manis, dan sebut namanya!`,
          isGift: true,
        },
        true
      );
      return;
    }

    // 3. LIKE EVENT
    const isLike =
      eventType === 'like' ||
      data.likeCount !== undefined ||
      raw.likeCount !== undefined;

    if (isLike) {
      const user = data.user || raw.user || {};
      const nickname = user.nickname || data.nickname || 'Penonton';
      const count = Number(data.likeCount || raw.likeCount || 1);
      this.onNewLike({
        nickname: String(nickname),
        count: count,
      });
      return;
    }
  }

  enqueueComment(commentData, highPriority = false) {
    if (!commentData || !commentData.comment) return;

    if (!highPriority) {
      if (
        this.filterMode === 'questions' &&
        !commentData.comment.includes('?')
      ) {
        return;
      }
      if (
        this.filterMode === 'mentions' &&
        !/@ai|maya|bot|halo/i.test(commentData.comment)
      ) {
        return;
      }
    }

    if (highPriority) {
      this.commentQueue.unshift(commentData);
    } else {
      this.commentQueue.push(commentData);
    }

    this.processQueue();
  }

  async processQueue() {
    if (this.isProcessingQueue || this.commentQueue.length === 0) return;

    const now = Date.now();
    const elapsed = (now - this.lastReplyTime) / 1000;
    if (elapsed < this.cooldownSeconds) {
      const waitMs = (this.cooldownSeconds - elapsed) * 1000;
      setTimeout(() => this.processQueue(), waitMs);
      return;
    }

    this.isProcessingQueue = true;
    await this._waitForAiFinish();

    if (this.commentQueue.length === 0) {
      this.isProcessingQueue = false;
      return;
    }

    const nextComment = this.commentQueue.shift();

    try {
      this.lastReplyTime = Date.now();
      await this.onTriggerAiReply(nextComment);
    } catch (e) {
      console.error('Gagal memproses balasan AI:', e);
    } finally {
      this.isProcessingQueue = false;
      if (this.commentQueue.length > 0) {
        setTimeout(() => this.processQueue(), this.cooldownSeconds * 1000);
      }
    }
  }

  simulateComment(username, message) {
    this.handleIncomingEvent({
      event: 'chat',
      data: {
        user: {
          uniqueId: username || 'UserTest',
          nickname: username || 'UserTest',
        },
        comment: message || 'Halo AI, apa kabar hari ini?',
      },
    });
  }

  simulateGift(username, giftName, count = 1) {
    this.handleIncomingEvent({
      event: 'gift',
      data: {
        user: {
          uniqueId: username || 'SultanTikTok',
          nickname: username || 'SultanTikTok',
        },
        giftName: giftName || 'Mawar Merah',
        repeatCount: count,
        diamondCount: 10,
      },
    });
  }

  async disconnect() {
    this.shouldAutoReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const isTauri = typeof window !== 'undefined' && (!!window.__TAURI__ || !!window.__TAURI_INTERNALS__);
    if (isTauri) {
      try {
        await window.__TAURI__.core.invoke('stop_tiktok_listener');
      } catch (_) {}
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.commentQueue = [];
    this.isProcessingQueue = false;
    if (this._aiFinishResolver) {
      this._aiFinishResolver();
      this._aiFinishResolver = null;
    }
    this.onStatusChange('disconnected', 'Terputus');
  }
}
