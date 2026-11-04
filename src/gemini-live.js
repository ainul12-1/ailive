/**
 * Gemini Live API Client (WebSocket BidiGenerateContent)
 * Model: gemini-3.1-flash-live-preview / gemini-3.8-live
 * Generates raw 24kHz PCM audio natively and streams real-time responses.
 */

export class GeminiLiveClient {
  constructor(options = {}) {
    this.apiKey = options.apiKey || '';
    this.model = options.model || 'gemini-3.1-flash-live-preview';
    this.voice = options.voice || 'Puck'; // Puck, Charon, Kore, Fenrir, Aoede
    this.systemInstruction =
      options.systemInstruction ||
      'Kamu adalah host live stream AI bernama Maya. Kamu ceria, ramah, dan seru. Jawab setiap komentar penonton TikTok secara langsung dan SANGAT SINGKAT (cukup 1-2 kalimat pendek saja, maksimal 20 kata). Sapa nama penonton dengan hangat.';

    this.ws = null;
    this.isConnected = false;
    this.isSpeaking = false;
    this.isSetupComplete = false;

    // Callbacks
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onTranscript = options.onTranscript || (() => {});
    this.onAudioStart = options.onAudioStart || (() => {});
    this.onAudioEnd = options.onAudioEnd || (() => {});
    this.onError = options.onError || (() => {});

    // Web Audio API context for 24kHz PCM playback and lip-sync analysis
    this.audioCtx = null;
    this.analyser = null;
    this.scheduledEndTime = 0;

    // Track active audio sources for cleanup
    this._activeSources = [];

    // Pending messages queue (before setup is complete)
    this._pendingMessages = [];
  }

  /**
   * Initialize Web Audio API (must be called after user gesture on mobile)
   */
  initAudio() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass({ sampleRate: 24000 });
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.5;
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch((e) => {
        console.warn('AudioContext resume failed (needs user gesture):', e);
      });
    }
  }

  /**
   * Ensure AudioContext is running (call on user click/touch)
   */
  ensureAudioResumed() {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  connect() {
    if (!this.apiKey) {
      this.onError('API Key Gemini belum diisi. Silakan isi di Pengaturan.');
      return;
    }

    // Disconnect existing connection first
    if (this.ws) {
      this.disconnect();
    }

    this.initAudio();
    this.isSetupComplete = false;
    this._pendingMessages = [];
    this.onStatusChange('connecting', 'Menghubungkan ke Gemini Live API...');

    // Live API WebSocket endpoint
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;

    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      this.onError(`Gagal membuat WebSocket: ${e.message}`);
      this.onStatusChange('error', 'Gagal Terhubung');
      return;
    }

    this.ws.onopen = () => {
      this.isConnected = true;
      this.onStatusChange('connected', 'Mengirim Setup...');
      this.sendInitialSetup();
    };

    this.ws.onmessage = async (event) => {
      try {
        let data;
        if (event.data instanceof Blob) {
          const text = await event.data.text();
          data = JSON.parse(text);
        } else {
          data = JSON.parse(event.data);
        }
        this.handleServerMessage(data);
      } catch (err) {
        console.error('Error parsing Gemini message:', err);
      }
    };

    this.ws.onerror = (err) => {
      console.error('Gemini WebSocket error:', err);
      this.onStatusChange('error', 'Error Koneksi');
    };

    this.ws.onclose = (event) => {
      this.isConnected = false;
      this.isSetupComplete = false;
      const reason = event.reason || `Code ${event.code}`;
      this.onStatusChange('disconnected', `Terputus (${reason})`);
      console.log('Gemini Live WS closed:', event.code, event.reason);
    };
  }

  sendInitialSetup() {
    const setupMessage = {
      setup: {
        model: `models/${this.model}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: this.voice,
              },
            },
          },
        },
        systemInstruction: {
          parts: [{ text: this.systemInstruction }],
        },
      },
    };
    this.ws.send(JSON.stringify(setupMessage));
  }

  /**
   * Send a TikTok comment to Gemini Live
   */
  sendComment(author, comment) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('Gemini WebSocket belum terhubung.');
      return false;
    }

    const promptText = `Komentar dari "${author}": "${comment}". (Jawab ramah dan SANGAT SINGKAT, 1-2 kalimat pendek saja!)`;

    const clientContent = {
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [{ text: promptText }],
          },
        ],
        turnComplete: true,
      },
    };

    // If setup not complete yet, queue the message
    if (!this.isSetupComplete) {
      this._pendingMessages.push(clientContent);
      return true;
    }

    this.ws.send(JSON.stringify(clientContent));
    return true;
  }

  /**
   * Greet recently joined viewers warmly and concisely
   */
  greetJoiners(names) {
    if (!names || names.length === 0) return false;
    const namesList = names.map(n => `Kak ${n}`).join(', ');
    const promptText = `Penonton baru saja bergabung ke siaran live kita: ${namesList}. (Sapa mereka dengan SANGAT HANGAT dan SINGKAT, cukup 1-2 kalimat menyambut mereka ke live stream!)`;

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('Gemini WebSocket belum terhubung untuk menyapa.');
      return false;
    }

    const clientContent = {
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [{ text: promptText }],
          },
        ],
        turnComplete: true,
      },
    };

    if (!this.isSetupComplete) {
      this._pendingMessages.push(clientContent);
      return true;
    }

    this.ws.send(JSON.stringify(clientContent));
    return true;
  }

  /**
   * Handle server messages: setup complete, audio chunks & transcripts
   */
  handleServerMessage(data) {
    // 1. Setup complete acknowledgment
    if (data.setupComplete) {
      this.isSetupComplete = true;
      this.onStatusChange('connected', 'Gemini Live Terhubung');
      // Flush pending messages
      for (const msg of this._pendingMessages) {
        this.ws.send(JSON.stringify(msg));
      }
      this._pendingMessages = [];
      return;
    }

    // 2. Check for audio chunks in serverContent
    if (data.serverContent) {
      const modelTurn = data.serverContent.modelTurn;
      if (modelTurn && modelTurn.parts) {
        for (const part of modelTurn.parts) {
          // If transcript is available
          if (part.text) {
            this.onTranscript(part.text);
          }
          // If raw PCM audio is available
          if (
            part.inlineData &&
            part.inlineData.mimeType?.startsWith('audio/pcm')
          ) {
            const base64Audio = part.inlineData.data;
            this.queueAudioChunk(base64Audio);
          }
        }
      }

      if (data.serverContent.turnComplete) {
        // Model finished generating this turn
      }
    }
  }

  /**
   * Queue raw 24kHz 16-bit little-endian PCM audio and play smoothly.
   * Handles odd-length buffers safely and tracks sources for cleanup.
   */
  queueAudioChunk(base64Data) {
    this.initAudio();

    // Decode base64 to binary
    const binaryString = atob(base64Data);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // FIX: Ensure even byte count to prevent Int16Array RangeError
    const evenLength = bytes.length - (bytes.length % 2);
    if (evenLength < 2) return; // Skip tiny/corrupt chunks

    // Convert 16-bit Little Endian PCM to Float32 [-1.0, 1.0]
    const pcm16 = new Int16Array(bytes.buffer, 0, evenLength / 2);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      float32[i] = pcm16[i] / 32768.0;
    }

    // Create AudioBuffer
    const audioBuffer = this.audioCtx.createBuffer(1, float32.length, 24000);
    audioBuffer.copyToChannel(float32, 0);

    // Schedule playback seamlessly
    const source = this.audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.analyser);
    this.analyser.connect(this.audioCtx.destination);

    const currentTime = this.audioCtx.currentTime;
    const startTime = Math.max(currentTime, this.scheduledEndTime);
    source.start(startTime);
    this.scheduledEndTime = startTime + audioBuffer.duration;

    // Track source for potential cleanup
    this._activeSources.push(source);

    if (!this.isSpeaking) {
      this.isSpeaking = true;
      this.onAudioStart();
    }

    source.onended = () => {
      // Remove from active sources
      const idx = this._activeSources.indexOf(source);
      if (idx !== -1) this._activeSources.splice(idx, 1);

      if (
        this.audioCtx &&
        this.audioCtx.currentTime >= this.scheduledEndTime - 0.05
      ) {
        this.isSpeaking = false;
        this.onAudioEnd();
      }
    };
  }

  /**
   * Get current detailed audio analysis for natural multi-vowel lip-sync
   * Returns { volume, lowBand, midBand, highBand, isSpeaking }
   */
  getAudioAnalysis() {
    if (this.simulatedSpeechEndTime && performance.now() < this.simulatedSpeechEndTime) {
      const now = performance.now();
      const t = now * 0.007;
      // Syllable rhythm with brief phrase pauses
      const phrasePause = Math.sin(t * 0.6) > -0.3 ? 1.0 : 0.08;
      const syllable = Math.max(0, Math.sin(t * 5.5) * 0.5 + Math.sin(t * 2.8) * 0.3 + 0.2);
      const vol = Math.min(1.0, syllable * phrasePause * 0.95);

      // Formant distribution variations
      const low = Math.min(1.0, (Math.sin(t * 4.2) * 0.5 + 0.5) * vol * 1.2);
      const mid = Math.min(1.0, (Math.sin(t * 6.8 + 1.2) * 0.5 + 0.5) * vol * 1.3);
      const high = Math.min(1.0, (Math.cos(t * 5.1) * 0.5 + 0.5) * vol * 0.9);

      return {
        volume: vol,
        lowBand: low,
        midBand: mid,
        highBand: high,
        isSpeaking: vol > 0.06,
      };
    }

    if (!this.analyser || !this.isSpeaking) {
      return { volume: 0, lowBand: 0, midBand: 0, highBand: 0, isSpeaking: false };
    }

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);

    // 1. Low vocal band (~180Hz - 650Hz, bins 2..7): 'ou' / 'oh' resonance
    let lowSum = 0;
    for (let i = 2; i <= 7 && i < dataArray.length; i++) lowSum += dataArray[i];
    const lowBand = Math.min(1.0, (lowSum / 6 / 128.0) * 1.6);

    // 2. Mid vocal band (~650Hz - 1700Hz, bins 8..18): 'aa' open mouth
    let midSum = 0;
    for (let i = 8; i <= 18 && i < dataArray.length; i++) midSum += dataArray[i];
    const midBand = Math.min(1.0, (midSum / 11 / 128.0) * 1.8);

    // 3. High vocal band (~1700Hz - 4200Hz, bins 19..45): 'ee' / 'ih' teeth & spread
    let highSum = 0;
    for (let i = 19; i <= 45 && i < dataArray.length; i++) highSum += dataArray[i];
    const highBand = Math.min(1.0, (highSum / 27 / 128.0) * 1.7);

    // Overall energy
    const totalAvg = (lowSum + midSum * 1.2 + highSum * 0.9) / 44 / 128.0;
    const volume = Math.min(1.0, totalAvg * 1.55);

    return {
      volume,
      lowBand,
      midBand,
      highBand,
      isSpeaking: volume > 0.05,
    };
  }

  /**
   * Get current audio volume / mouth open level for lip-sync [0.0 - 1.0] (legacy compat)
   */
  getAudioVolume() {
    return this.getAudioAnalysis().volume;
  }

  /**
   * Simulate speech for testing lip-sync and animations when offline
   */
  simulateSpeech(durationSeconds = 3.5) {
    this.stopAllAudio();
    this.isSpeaking = true;
    this.simulatedSpeechEndTime = performance.now() + durationSeconds * 1000;
    this.onAudioStart();

    setTimeout(() => {
      this.isSpeaking = false;
      this.simulatedSpeechEndTime = 0;
      this.onAudioEnd();
    }, durationSeconds * 1000);
  }

  /**
   * Stop all currently playing audio
   */
  stopAllAudio() {
    for (const source of this._activeSources) {
      try {
        source.stop();
      } catch (_) {
        // Already stopped
      }
    }
    this._activeSources = [];
    this.isSpeaking = false;
    this.scheduledEndTime = 0;
    this.onAudioEnd();
  }

  disconnect() {
    this.stopAllAudio();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.isSpeaking = false;
    this.isSetupComplete = false;
    this.scheduledEndTime = 0;
    this._pendingMessages = [];
    this.onStatusChange('disconnected', 'Terputus');
  }
}
