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
    this.systemInstruction = options.systemInstruction || 
      'Kamu adalah host live stream AI bernama Maya. Kamu ceria, gaul, ramah, dan seru. Jawab komentar penonton TikTok secara langsung, singkat (1-2 kalimat), dalam bahasa Indonesia santai. Sapa nama penanya jika ada.';
    
    this.ws = null;
    this.isConnected = false;
    this.isSpeaking = false;
    
    // Callbacks
    this.onStatusChange = options.onStatusChange || (() => {});
    this.onTranscript = options.onTranscript || (() => {});
    this.onAudioStart = options.onAudioStart || (() => {});
    this.onAudioEnd = options.onAudioEnd || (() => {});
    this.onError = options.onError || (() => {});

    // Web Audio API context for 24kHz PCM playback and lip-sync analysis
    this.audioCtx = null;
    this.analyser = null;
    this.pcmQueue = [];
    this.isPlayingQueue = false;
    this.scheduledEndTime = 0;
  }

  initAudio() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass({ sampleRate: 24000 });
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.5;
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  connect() {
    if (!this.apiKey) {
      this.onError('API Key Gemini belum diisi. Silakan isi di Pengaturan.');
      return;
    }

    this.initAudio();
    this.onStatusChange('connecting', 'Menghubungkan ke Gemini Live API...');

    // Live API WebSocket endpoint
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;
    
    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      this.onError(`Gagal membuat WebSocket: ${e.message}`);
      return;
    }

    this.ws.onopen = () => {
      this.isConnected = true;
      this.onStatusChange('connected', 'Gemini Live Terhubung');
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
      this.onError('Koneksi WebSocket Gemini error.');
      this.onStatusChange('error', 'Error Koneksi');
    };

    this.ws.onclose = (event) => {
      this.isConnected = false;
      this.onStatusChange('disconnected', 'Terputus dari Gemini');
      console.log('Gemini Live WS closed:', event.code, event.reason);
    };
  }

  sendInitialSetup() {
    const setupMessage = {
      setup: {
        model: `models/${this.model}`,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: this.voice
              }
            }
          }
        },
        systemInstruction: {
          parts: [{ text: this.systemInstruction }]
        }
      }
    };
    this.ws.send(JSON.stringify(setupMessage));
  }

  /**
   * Send a TikTok comment to Gemini Live
   */
  sendComment(author, comment) {
    if (!this.isConnected || !this.ws) {
      console.warn('Gemini belum terhubung.');
      return false;
    }

    const promptText = `Komentar penonton dari "${author}": "${comment}"`;
    
    const clientContent = {
      clientContent: {
        turns: [
          {
            role: "user",
            parts: [{ text: promptText }]
          }
        ],
        turnComplete: true
      }
    };

    this.ws.send(JSON.stringify(clientContent));
    return true;
  }

  /**
   * Handle server messages: audio chunks & transcripts
   */
  handleServerMessage(data) {
    // 1. Check for audio chunks in serverContent
    if (data.serverContent) {
      const modelTurn = data.serverContent.modelTurn;
      if (modelTurn && modelTurn.parts) {
        for (const part of modelTurn.parts) {
          // If transcript is available
          if (part.text) {
            this.onTranscript(part.text);
          }
          // If raw PCM audio is available
          if (part.inlineData && part.inlineData.mimeType?.startsWith('audio/pcm')) {
            const base64Audio = part.inlineData.data;
            this.queueAudioChunk(base64Audio);
          }
        }
      }

      if (data.serverContent.turnComplete) {
        // Model finished generating turn
      }
    }
  }

  /**
   * Queue raw 24kHz 16-bit little-endian PCM audio and play smoothly
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

    // Convert 16-bit Little Endian PCM to Float32 [-1.0, 1.0]
    const pcm16 = new Int16Array(bytes.buffer);
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

    if (!this.isSpeaking) {
      this.isSpeaking = true;
      this.onAudioStart();
    }

    source.onended = () => {
      if (this.audioCtx && this.audioCtx.currentTime >= this.scheduledEndTime - 0.05) {
        this.isSpeaking = false;
        this.onAudioEnd();
      }
    };
  }

  /**
   * Get current audio volume / mouth open level for lip-sync [0.0 - 1.0]
   */
  getAudioVolume() {
    if (!this.analyser || !this.isSpeaking) return 0;
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);

    let sum = 0;
    // Focus on vocal speech frequencies (around 300Hz - 3400Hz)
    const binCount = Math.min(dataArray.length, 64);
    for (let i = 0; i < binCount; i++) {
      sum += dataArray[i];
    }
    const average = sum / binCount;
    // Normalized to 0.0 - 1.0 with a sensible gain
    return Math.min(1.0, (average / 128.0) * 1.5);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.isSpeaking = false;
    this.scheduledEndTime = 0;
    this.onStatusChange('disconnected', 'Terputus');
  }
}
