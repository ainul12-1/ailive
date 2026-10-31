/**
 * TikTok Live Stream Manager & Event Queue
 * Handles incoming chat, gifts, likes, and triggers Gemini AI responses.
 * Queue waits for AI audio to finish before processing next comment.
 */

export class TikTokLiveManager {
  constructor(options = {}) {
    this.targetUsername = options.targetUsername || '';
    this.filterMode = options.filterMode || 'all'; // 'all', 'questions', 'mentions'
    this.cooldownSeconds = options.cooldownSeconds || 4;

    this.isConnected = false;
    this.ws = null;
    this.commentQueue = [];
    this.isProcessingQueue = false;
    this.lastReplyTime = 0;

    // Track if AI is still speaking (set by main.js via setAiSpeakingState)
    this._isAiSpeaking = false;
    this._aiFinishResolver = null;

    // Callbacks
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onNewComment = options.onNewComment || (() => {});
    this.onNewGift = options.onNewGift || (() => {});
    this.onNewLike = options.onNewLike || (() => {});
    this.onTriggerAiReply = options.onTriggerAiReply || (() => {});
  }

  /**
   * Called by main.js when AI starts or stops speaking.
   * Queue processing waits for AI to finish before sending next comment.
   */
  setAiSpeakingState(isSpeaking) {
    this._isAiSpeaking = isSpeaking;
    if (!isSpeaking && this._aiFinishResolver) {
      this._aiFinishResolver();
      this._aiFinishResolver = null;
    }
  }

  /**
   * Returns a promise that resolves when AI finishes speaking
   */
  _waitForAiFinish() {
    if (!this._isAiSpeaking) return Promise.resolve();
    return new Promise((resolve) => {
      this._aiFinishResolver = resolve;
    });
  }

  setTargetUsername(username) {
    this.targetUsername = username.replace(/^@/, '').trim();
  }

  /**
   * Connect to TikFinity local WebSocket or proxy bridge
   * TikFinity default local WebSocket runs on ws://localhost:21213
   */
  connectTikFinity(port = 21213) {
    // Close existing connection if any
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }

    this.onStatusChange(
      'connecting',
      `Menyambungkan ke TikFinity (ws://localhost:${port})...`
    );

    try {
      this.ws = new WebSocket(`ws://localhost:${port}`);
    } catch (e) {
      this.onStatusChange('error', `Gagal buka socket: ${e.message}`);
      return;
    }

    this.ws.onopen = () => {
      this.isConnected = true;
      this.onStatusChange('connected', `Terhubung ke TikFinity Live`);
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleIncomingEvent(data);
      } catch (err) {
        console.error('Error parsing TikTok message:', err);
      }
    };

    this.ws.onerror = () => {
      console.warn(
        'TikFinity connection not found or error. Use simulator or start TikFinity.'
      );
      this.onStatusChange(
        'idle',
        'TikFinity offline (Gunakan Simulator di bawah)'
      );
    };

    this.ws.onclose = () => {
      this.isConnected = false;
      this.onStatusChange('disconnected', 'Terputus dari TikTok Live');
    };
  }

  /**
   * Handle incoming parsed live event (from TikFinity or Custom Bridge)
   */
  handleIncomingEvent(event) {
    if (!event) return;

    // 1. Comment Event
    if (event.event === 'chat' || event.comment) {
      const commentData = {
        uniqueId: event.uniqueId || event.nickname || 'Penonton',
        nickname: event.nickname || event.uniqueId || 'Penonton',
        comment: event.comment || event.text || '',
        avatar: event.profilePictureUrl || null,
        timestamp: Date.now(),
      };

      this.onNewComment(commentData);
      this.enqueueComment(commentData);
    }

    // 2. Gift Event
    else if (event.event === 'gift' || event.giftName) {
      const giftData = {
        uniqueId: event.uniqueId || 'Penonton',
        nickname: event.nickname || 'Penonton',
        giftName: event.giftName || 'Gift Cantik',
        repeatCount: event.repeatCount || 1,
        diamonds: event.diamondCount || 1,
      };

      this.onNewGift(giftData);
      // High priority: trigger AI thank-you response
      this.enqueueComment(
        {
          uniqueId: giftData.nickname,
          nickname: giftData.nickname,
          comment: `[Mengirim Gift: ${giftData.giftName} x${giftData.repeatCount}!] Tolong ucapkan terima kasih yang heboh dan manis!`,
          isGift: true,
        },
        true
      );
    }

    // 3. Like Event
    else if (event.event === 'like' || event.likeCount) {
      this.onNewLike({
        nickname: event.nickname || 'Penonton',
        count: event.likeCount || 1,
      });
    }
  }

  /**
   * Add comment to queue with filtering logic
   */
  enqueueComment(commentData, highPriority = false) {
    // Check filter
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

  /**
   * Process queue one comment at a time.
   * Waits for:
   *   1. Cooldown timer
   *   2. AI to finish speaking current response
   */
  async processQueue() {
    if (this.isProcessingQueue || this.commentQueue.length === 0) return;

    // 1. Respect cooldown
    const now = Date.now();
    const elapsed = (now - this.lastReplyTime) / 1000;
    if (elapsed < this.cooldownSeconds) {
      const waitMs = (this.cooldownSeconds - elapsed) * 1000;
      setTimeout(() => this.processQueue(), waitMs);
      return;
    }

    this.isProcessingQueue = true;

    // 2. Wait for AI to finish speaking before sending next comment
    await this._waitForAiFinish();

    // Check queue again (might have been cleared while waiting)
    if (this.commentQueue.length === 0) {
      this.isProcessingQueue = false;
      return;
    }

    const nextComment = this.commentQueue.shift();

    try {
      this.lastReplyTime = Date.now();
      await this.onTriggerAiReply(nextComment);
    } catch (e) {
      console.error('Gagal mengirim balasan AI:', e);
    } finally {
      this.isProcessingQueue = false;
      if (this.commentQueue.length > 0) {
        setTimeout(() => this.processQueue(), this.cooldownSeconds * 1000);
      }
    }
  }

  /**
   * Manually simulate an incoming comment for testing and demonstration
   */
  simulateComment(username, message) {
    const commentData = {
      uniqueId: username || 'UserTest',
      nickname: username || 'UserTest',
      comment: message || 'Halo AI, apa kabar hari ini?',
      timestamp: Date.now(),
    };
    this.onNewComment(commentData);
    this.enqueueComment(commentData);
  }

  /**
   * Manually simulate a gift event
   */
  simulateGift(username, giftName, count = 1) {
    this.handleIncomingEvent({
      event: 'gift',
      nickname: username || 'SultanTikTok',
      giftName: giftName || 'Mawar Merah',
      repeatCount: count,
      diamondCount: 10,
    });
  }

  disconnect() {
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
