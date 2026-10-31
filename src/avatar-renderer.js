import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

export class AvatarRenderer {
  constructor(canvasContainer) {
    this.container = canvasContainer;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.clock = new THREE.Clock();

    // Models
    this.currentModel = null;
    this.currentVrm = null;
    this.vrmBones = {};
    this.clothMaterials = [];
    this.currentClothColor = null;
    this.audioVolumeGetter = () => 0;

    // Smoothed volume & speech articulation state
    this.smoothedVolume = 0;
    this.isTalking = false;
    this.talkGesturePhase = 0;

    // Head / Eye tracking target
    this.targetMouse = new THREE.Vector2(0, 0);
    this.currentMouse = new THREE.Vector2(0, 0);

    // Humanoid gesture variety & behavior state machine
    this.gestureStyle = 0; // 0: Right hand explain, 1: Two hands warm storytelling, 2: Left hand active, 3: Thoughtful head tilt
    this.gestureTimer = 0;
    this.nextGestureSwitch = 3.5;

    // Spontaneous Reaction System (e.g. Gift Received, Cheerful greeting)
    this.activeReaction = null;
    this.reactionProgress = 0;
    this.reactionDuration = 3.2;

    // Natural Eye Blinking system (non-linear smooth eyelid animation)
    this.blinkTimer = 0;
    this.blinkDuration = 0.18;
    this.nextBlinkTime = 2.8;
    this.isBlinking = false;

    // Micro-head saccades (subtle subconscious human eye/head shifts)
    this.saccadeTimer = 0;
    this.saccadeTarget = new THREE.Vector2(0, 0);
    this.saccadeCurrent = new THREE.Vector2(0, 0);

    this._currentObjectUrl = null;
    this.onLoadingChange = () => {};

    this.initScene();
  }

  setLoadingCallback(cb) {
    this.onLoadingChange = cb;
  }

  initScene() {
    this.scene = new THREE.Scene();

    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 600;
    const aspect = width / height;

    // Dynamic FOV: portrait screens get wider FOV so arms & shoulders remain visible
    const baseFov = 28;
    const fov = aspect < 0.75 ? baseFov + (0.75 - aspect) * 26 : baseFov;

    this.cameraZoom = parseFloat(localStorage.getItem('ailive_cam_zoom')) || 1.85;

    this.camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 100);
    this.camera.position.set(0, 1.25, this.cameraZoom);
    this.camera.lookAt(0, 1.15, 0);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'default', // battery & heat friendly for mobile phones
    });
    this.renderer.setSize(width, height);
    // Super enteng anti-lag: cap DPR at 1.0 on mobile to drastically reduce GPU fragment fill-rate & overheating
    const isMobile = typeof navigator !== 'undefined' && (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || width < 768);
    this.renderer.setPixelRatio(isMobile ? 1.0 : Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Balanced tone exposure so skin highlight doesn't bleach nose and mouth details
    this.renderer.toneMappingExposure = 0.90;
    this.container.appendChild(this.renderer.domElement);

    this.setupLighting();
    this.setupFloatingParticles();
    this.setupInteractionListeners();

    window.addEventListener('resize', () => this.onWindowResize());
    this.animate();
  }

  /**
   * Refined 3D Studio Portrait Lighting:
   * Accentuates nose contour, lip separation, and cheekbone depth without bleaching skin white.
   */
  setupLighting() {
    // 1. Ambient Light - Softer ambient fill so facial contouring and nose shadow show clearly
    const ambientLight = new THREE.AmbientLight(0xfff6f0, 0.42);
    this.scene.add(ambientLight);

    // 2. Key Portrait Light - Angled from top-right to cast natural, crisp soft shadow under nose tip and lower lip
    const keyLight = new THREE.DirectionalLight(0xffeedb, 0.95);
    keyLight.position.set(0.6, 2.0, 1.4);
    this.scene.add(keyLight);

    // 3. Cool Fill Light - Soft gentle fill from left
    const fillLight = new THREE.DirectionalLight(0xdce7f5, 0.35);
    fillLight.position.set(-0.8, 1.2, 1.2);
    this.scene.add(fillLight);

    // 4. Low Chin & Lip Contour Light - Subtle bounce emphasizing lower lip and jawline
    const chinLight = new THREE.DirectionalLight(0xffded0, 0.25);
    chinLight.position.set(0, 0.5, 1.0);
    this.scene.add(chinLight);

    // 5. Stylistic Crimson Rim Light - Hair strands & streamer silhouette glow
    const rimLight = new THREE.DirectionalLight(0xe11d48, 1.4);
    rimLight.position.set(-1.1, 1.6, -1.3);
    this.scene.add(rimLight);

    // 6. Warm Gold Secondary Rim Light
    const goldRim = new THREE.DirectionalLight(0xfbbf24, 0.85);
    goldRim.position.set(1.1, 1.1, -1.0);
    this.scene.add(goldRim);
  }

  setupFloatingParticles() {
    const isMobile = typeof navigator !== 'undefined' && (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768);
    const particleCount = isMobile ? 18 : 60;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i += 3) {
      pos[i] = (Math.random() - 0.5) * 3.0;
      pos[i + 1] = Math.random() * 2.2 + 0.4;
      pos[i + 2] = (Math.random() - 0.5) * 2.5;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xf43f5e,
      size: isMobile ? 0.016 : 0.020,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
    });
    this.particles = new THREE.Points(geo, mat);
    this.scene.add(this.particles);
  }

  setupInteractionListeners() {
    const handleMove = (x, y) => {
      const rect = this.container.getBoundingClientRect();
      const normX = ((x - rect.left) / rect.width) * 2 - 1;
      const normY = -(((y - rect.top) / rect.height) * 2 - 1);
      this.targetMouse.x = THREE.MathUtils.clamp(normX, -1, 1);
      this.targetMouse.y = THREE.MathUtils.clamp(normY, -1, 1);
    };

    window.addEventListener('mousemove', (e) => handleMove(e.clientX, e.clientY));
    window.addEventListener(
      'touchmove',
      (e) => {
        if (e.touches.length === 1) {
          handleMove(e.touches[0].clientX, e.touches[0].clientY);
        }
      },
      { passive: true }
    );

    // Mouse Wheel Zoom
    this.container.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const delta = e.deltaY * 0.0015;
        this.setCameraZoom(this.cameraZoom + delta);
      },
      { passive: false }
    );

    // Mobile Pinch-to-Zoom
    let initialPinchDist = null;
    let initialZoom = null;
    this.container.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length === 2) {
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          initialPinchDist = Math.hypot(dx, dy);
          initialZoom = this.cameraZoom;
        }
      },
      { passive: true }
    );

    this.container.addEventListener(
      'touchmove',
      (e) => {
        if (e.touches.length === 2 && initialPinchDist) {
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          const dist = Math.hypot(dx, dy);
          if (dist > 10) {
            const scale = initialPinchDist / dist;
            this.setCameraZoom(initialZoom * scale);
          }
        }
      },
      { passive: true }
    );

    this.container.addEventListener('touchend', () => {
      initialPinchDist = null;
    });
  }

  setCameraZoom(zoomVal) {
    this.cameraZoom = THREE.MathUtils.clamp(zoomVal, 1.15, 2.85);
    localStorage.setItem('ailive_cam_zoom', this.cameraZoom.toString());
    this.updateCameraFrame();
  }

  updateCameraFrame() {
    if (!this.camera) return;
    const headNode = this.vrmBones?.head;
    if (headNode) {
      const headPos = new THREE.Vector3();
      headNode.getWorldPosition(headPos);
      this.camera.position.set(0, headPos.y - 0.08, this.cameraZoom);
      this.camera.lookAt(0, headPos.y - 0.20, 0);
    } else {
      this.camera.position.set(0, 1.25, this.cameraZoom);
      this.camera.lookAt(0, 1.15, 0);
    }
  }

  setAudioVolumeGetter(getter) {
    this.audioVolumeGetter = getter;
  }

  /**
   * Dynamically change clothes color (tops, bottoms, dresses)
   */
  setClothColor(hexColor) {
    if (!hexColor) return;
    this.currentClothColor = hexColor;
    const color = new THREE.Color(hexColor);
    for (const mat of this.clothMaterials) {
      if (mat.color) mat.color.copy(color);
      if (mat.shadeColor) {
        mat.shadeColor.copy(color).multiplyScalar(0.72);
      }
    }
  }

  /**
   * Set VRM facial expression safely across VRM 0.0 (Joy/Fun) & VRM 1.0 (happy/relaxed)
   */
  setExpressionSafe(name, weight) {
    if (!this.currentVrm?.expressionManager) return;
    const em = this.currentVrm.expressionManager;
    const candidates = [
      name,
      name.toLowerCase(),
      name.charAt(0).toUpperCase() + name.slice(1).toLowerCase(),
      name === 'happy' ? 'Joy' : name === 'Joy' ? 'happy' : null,
      name === 'relaxed' ? 'Fun' : name === 'Fun' ? 'relaxed' : null,
    ].filter(Boolean);

    for (const c of candidates) {
      try {
        em.setValue(c, weight);
      } catch (_) {}
    }
  }

  /**
   * Helper to curl finger joints naturally into a fist or pose
   */
  _curlFingers(handPrefix = 'right', mask = [true, true, true, true, true], weight = 1.0) {
    const b = this.vrmBones;
    if (!b) return;
    const fingers = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
    fingers.forEach((finger, i) => {
      if (!mask[i]) return;
      const p = b[`${handPrefix}${finger}Proximal`];
      const inter = b[`${handPrefix}${finger}Intermediate`];
      const d = b[`${handPrefix}${finger}Distal`];
      const curlZ = (finger === 'Thumb' ? 0.65 : 1.15) * weight;
      const curlX = (finger === 'Thumb' ? 0.35 : 0.0) * weight;
      if (p) { p.rotation.z = curlZ * 0.85; p.rotation.x = curlX; }
      if (inter) { inter.rotation.z = curlZ * 1.0; }
      if (d) { d.rotation.z = curlZ * 0.85; }
    });
  }

  /**
   * Helper to straighten finger joints outward
   */
  _straightenFingers(handPrefix = 'right', fingers = ['Index', 'Middle']) {
    const b = this.vrmBones;
    if (!b) return;
    fingers.forEach((finger) => {
      const p = b[`${handPrefix}${finger}Proximal`];
      const inter = b[`${handPrefix}${finger}Intermediate`];
      const d = b[`${handPrefix}${finger}Distal`];
      if (p) { p.rotation.z = 0; p.rotation.x = 0; p.rotation.y = 0; }
      if (inter) { inter.rotation.z = 0; inter.rotation.x = 0; inter.rotation.y = 0; }
      if (d) { d.rotation.z = 0; d.rotation.x = 0; d.rotation.y = 0; }
    });
  }

  /**
   * Set VRM vowel mouth shape safely across VRM 0.0 (A, I, U, E, O) and VRM 1.0 (aa, ih, ou, ee, oh)
   * Clamps mouth opening between 0 and maxOpen (default 0.38) to prevent jaw dislocation
   */
  setVowelSafe(vowel, weight, maxOpen = 0.38) {
    if (!this.currentVrm?.expressionManager) return;
    const em = this.currentVrm.expressionManager;
    const clamped = THREE.MathUtils.clamp(weight, 0, maxOpen);
    const map = {
      aa: ['aa', 'a', 'A', 'Aa'],
      ih: ['ih', 'i', 'I', 'Ii'],
      ou: ['ou', 'u', 'U', 'Uu'],
      ee: ['ee', 'e', 'E', 'Ee'],
      oh: ['oh', 'o', 'O', 'Oh'],
    };
    const candidates = map[vowel.toLowerCase()] || [vowel];
    for (const c of candidates) {
      try {
        em.setValue(c, clamped);
      } catch (_) {}
    }
  }

  /**
   * Smoothly decay all mouth vowel shapes back to resting closed lips
   */
  decayVowelsSafe(factor = 0.25) {
    if (!this.currentVrm?.expressionManager) return;
    const em = this.currentVrm.expressionManager;
    const vowels = ['aa', 'ih', 'ou', 'ee', 'oh', 'a', 'i', 'u', 'e', 'o', 'A', 'I', 'U', 'E', 'O'];
    for (const v of vowels) {
      try {
        const val = em.getValue(v);
        if (val !== undefined && val > 0.001) {
          em.setValue(v, THREE.MathUtils.lerp(val, 0, factor));
        }
      } catch (_) {}
    }
  }

  /**
   * Trigger modular emotional reaction or hand pose
   * Supported types: 'love', 'middle_finger', 'peace', 'wave', 'dance', 'thanks', 'hide'
   */
  triggerReaction(type = 'thanks', duration = 3.5) {
    this.activeReaction = type;
    this.reactionProgress = 0;
    this.reactionDuration = duration;
    console.log(`🎭 [Avatar Pose]: Menjalankan pose "${type}" (${duration}s)`);
  }

  /**
   * Load any 3D model (VRM preferred)
   */
  async loadModel(fileOrUrl, modelName = '3D Avatar') {
    this.onLoadingChange(true, `Memuat ${modelName}...`);

    if (this._currentObjectUrl) {
      URL.revokeObjectURL(this._currentObjectUrl);
      this._currentObjectUrl = null;
    }

    let url;
    if (typeof fileOrUrl === 'string') {
      url = fileOrUrl;
    } else {
      url = URL.createObjectURL(fileOrUrl);
      this._currentObjectUrl = url;
    }

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    return new Promise((resolve, reject) => {
      loader.load(
        url,
        (gltf) => {
          this.clearCurrentModel();

          const vrm = gltf.userData.vrm;
          if (vrm) {
            this.currentVrm = vrm;
            this.currentModel = vrm.scene;
            VRMUtils.rotateVRM0(vrm);
            this.scene.add(vrm.scene);

            // Cache humanoid skeleton bones
            this.cacheVrmBones(vrm);

            // Cache clothing materials and enhance face shading contrast
            this.clothMaterials = [];
            vrm.scene.traverse((child) => {
              if (child.isMesh && child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                for (const mat of materials) {
                  const name = (mat.name || '').toLowerCase();
                  if (
                    name.includes('cloth') ||
                    name.includes('top') ||
                    name.includes('bottom') ||
                    name.includes('shirt') ||
                    name.includes('skirt')
                  ) {
                    this.clothMaterials.push(mat);
                  }

                  // Boost facial definition: sharpen shadows on nose, lips, and neck
                  if (name.includes('face') || name.includes('skin') || name.includes('mouth')) {
                    if (mat.shadeColor) {
                      // Warm natural contour tone so nose and lips are clearly visible
                      mat.shadeColor.setRGB(0.90, 0.76, 0.70);
                    }
                  }
                }
              }
            });

            // Reapply custom cloth color if already chosen
            if (this.currentClothColor) {
              this.setClothColor(this.currentClothColor);
            }

            // Frame camera with chosen/persisted zoom distance (bust/torso view)
            this.updateCameraFrame();
          } else {
            // Generic fallback
            const modelScene = gltf.scene;
            this.currentModel = modelScene;
            this.scene.add(modelScene);
          }

          this.onLoadingChange(false);
          console.log('Model 3D berhasil dimuat!');
          resolve(this.currentModel);
        },
        (progress) => {
          if (progress.total > 0) {
            const pct = Math.round((progress.loaded / progress.total) * 100);
            this.onLoadingChange(true, `Mengunduh 3D: ${pct}%`);
          }
        },
        (err) => {
          this.onLoadingChange(false);
          console.error('Error loading 3D model:', err);
          reject(err);
        }
      );
    });
  }

  cacheVrmBones(vrm) {
    if (!vrm.humanoid) return;
    const h = vrm.humanoid;
    this.vrmBones = {
      head: h.getNormalizedBoneNode('head'),
      neck: h.getNormalizedBoneNode('neck'),
      chest: h.getNormalizedBoneNode('chest') || h.getNormalizedBoneNode('upperChest'),
      spine: h.getNormalizedBoneNode('spine'),
      hips: h.getNormalizedBoneNode('hips'),
      leftShoulder: h.getNormalizedBoneNode('leftShoulder'),
      rightShoulder: h.getNormalizedBoneNode('rightShoulder'),
      leftUpperArm: h.getNormalizedBoneNode('leftUpperArm'),
      rightUpperArm: h.getNormalizedBoneNode('rightUpperArm'),
      leftLowerArm: h.getNormalizedBoneNode('leftLowerArm'),
      rightLowerArm: h.getNormalizedBoneNode('rightLowerArm'),
      leftHand: h.getNormalizedBoneNode('leftHand'),
      rightHand: h.getNormalizedBoneNode('rightHand'),

      // Right Hand Fingers (for finger hearts, middle finger, peace sign)
      rightThumbProximal: h.getNormalizedBoneNode('rightThumbProximal'),
      rightThumbIntermediate: h.getNormalizedBoneNode('rightThumbIntermediate'),
      rightThumbDistal: h.getNormalizedBoneNode('rightThumbDistal'),
      rightIndexProximal: h.getNormalizedBoneNode('rightIndexProximal'),
      rightIndexIntermediate: h.getNormalizedBoneNode('rightIndexIntermediate'),
      rightIndexDistal: h.getNormalizedBoneNode('rightIndexDistal'),
      rightMiddleProximal: h.getNormalizedBoneNode('rightMiddleProximal'),
      rightMiddleIntermediate: h.getNormalizedBoneNode('rightMiddleIntermediate'),
      rightMiddleDistal: h.getNormalizedBoneNode('rightMiddleDistal'),
      rightRingProximal: h.getNormalizedBoneNode('rightRingProximal'),
      rightRingIntermediate: h.getNormalizedBoneNode('rightRingIntermediate'),
      rightRingDistal: h.getNormalizedBoneNode('rightRingDistal'),
      rightLittleProximal: h.getNormalizedBoneNode('rightLittleProximal'),
      rightLittleIntermediate: h.getNormalizedBoneNode('rightLittleIntermediate'),
      rightLittleDistal: h.getNormalizedBoneNode('rightLittleDistal'),

      // Left Hand Fingers
      leftThumbProximal: h.getNormalizedBoneNode('leftThumbProximal'),
      leftThumbIntermediate: h.getNormalizedBoneNode('leftThumbIntermediate'),
      leftThumbDistal: h.getNormalizedBoneNode('leftThumbDistal'),
      leftIndexProximal: h.getNormalizedBoneNode('leftIndexProximal'),
      leftIndexIntermediate: h.getNormalizedBoneNode('leftIndexIntermediate'),
      leftIndexDistal: h.getNormalizedBoneNode('leftIndexDistal'),
      leftMiddleProximal: h.getNormalizedBoneNode('leftMiddleProximal'),
      leftMiddleIntermediate: h.getNormalizedBoneNode('leftMiddleIntermediate'),
      leftMiddleDistal: h.getNormalizedBoneNode('leftMiddleDistal'),
      leftRingProximal: h.getNormalizedBoneNode('leftRingProximal'),
      leftRingIntermediate: h.getNormalizedBoneNode('leftRingIntermediate'),
      leftRingDistal: h.getNormalizedBoneNode('leftRingDistal'),
      leftLittleProximal: h.getNormalizedBoneNode('leftLittleProximal'),
      leftLittleIntermediate: h.getNormalizedBoneNode('leftLittleIntermediate'),
      leftLittleDistal: h.getNormalizedBoneNode('leftLittleDistal'),
    };
  }

  clearCurrentModel() {
    if (this.currentVrm) {
      this.scene.remove(this.currentVrm.scene);
      VRMUtils.deepDispose(this.currentVrm.scene);
      this.currentVrm = null;
    }
    if (this.currentModel) {
      this.scene.remove(this.currentModel);
      this.currentModel = null;
    }
    this.vrmBones = {};
    this.clothMaterials = [];
  }

  onWindowResize() {
    if (!this.container || !this.renderer || !this.camera) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const aspect = width / height;

    this.camera.aspect = aspect;
    const baseFov = 28;
    this.camera.fov = aspect < 0.75 ? baseFov + (0.75 - aspect) * 26 : baseFov;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    const isMobile = width < 768;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const delta = this.clock.getDelta();
    const elapsedTime = this.clock.getElapsedTime();

    // 1. Audio volume smoothing with dynamic attack and decay
    const rawVolume = this.audioVolumeGetter() || 0;
    if (rawVolume > this.smoothedVolume) {
      this.smoothedVolume += (rawVolume - this.smoothedVolume) * 0.48;
    } else {
      this.smoothedVolume += (rawVolume - this.smoothedVolume) * 0.18;
    }
    const vol = this.smoothedVolume;
    this.isTalking = vol > 0.05;

    // Track speech gesture timing
    if (this.isTalking) {
      this.talkGesturePhase += delta * (3.0 + vol * 3.8);
    }

    // 2. Behavioral State Machine: Switch natural gestural styles every 3-6 seconds
    this.gestureTimer += delta;
    if (this.gestureTimer >= this.nextGestureSwitch) {
      this.gestureTimer = 0;
      const prev = this.gestureStyle;
      let next = Math.floor(Math.random() * 4);
      if (next === prev) next = (next + 1) % 4;
      this.gestureStyle = next;
      this.nextGestureSwitch = 3.5 + Math.random() * 3.0;
    }

    // 3. Smooth mouse / touch parallax tracking
    this.currentMouse.x += (this.targetMouse.x - this.currentMouse.x) * 0.06;
    this.currentMouse.y += (this.targetMouse.y - this.currentMouse.y) * 0.06;

    // 4. Subconscious Human Micro Saccades (natural eye and head glances)
    this.saccadeTimer += delta;
    if (this.saccadeTimer > 2.2 + Math.random() * 2.8) {
      this.saccadeTarget.x = (Math.random() - 0.5) * 0.06;
      this.saccadeTarget.y = (Math.random() - 0.5) * 0.04;
      this.saccadeTimer = 0;
    }
    this.saccadeCurrent.lerp(this.saccadeTarget, 0.08);

    // 5. Subtle background particle float
    if (this.particles) {
      this.particles.rotation.y = elapsedTime * 0.022;
    }

    // =====================================================================
    // 🎭 VRM: ADVANCED MULTI-STATE LIVING HUMAN MOTION ENGINE
    // =====================================================================
    if (this.currentVrm) {
      const b = this.vrmBones;
      const exp = this.currentVrm.expressionManager;

      // --- A. Organic Multi-Frequency Asynchronous Respiration ---
      // Combining non-harmonic frequencies prevents robotic looping
      const breathSine = Math.sin(elapsedTime * 1.35) * 0.65 + Math.sin(elapsedTime * 0.55 + 1.2) * 0.35;
      const swayX = Math.sin(elapsedTime * 0.38) * 0.012 + Math.sin(elapsedTime * 0.85) * 0.006;

      // Spine & Chest natural breathing and gentle host sway
      if (b.spine) {
        b.spine.rotation.x = breathSine * 0.016;
        b.spine.rotation.y = this.currentMouse.x * 0.06 + swayX;
        b.spine.rotation.z = -this.currentMouse.x * 0.015;
      }
      if (b.chest) {
        b.chest.rotation.x = breathSine * 0.024 + (this.isTalking ? Math.sin(this.talkGesturePhase * 0.75) * 0.015 : 0);
        b.chest.rotation.y = this.currentMouse.x * 0.08;
      }

      // --- B. Neck & Head Natural Looking + Conversational Nods ---
      if (b.neck) {
        b.neck.rotation.y = this.currentMouse.x * 0.12 + this.saccadeCurrent.x;
        b.neck.rotation.x = -this.currentMouse.y * 0.08 + this.saccadeCurrent.y;
      }

      if (b.head) {
        // Conversational head nods and friendly tilts
        const talkNod = this.isTalking ? Math.sin(this.talkGesturePhase * 1.8) * 0.12 * vol : 0;
        let talkTilt = this.isTalking ? Math.cos(this.talkGesturePhase * 1.1) * 0.08 * vol : 0;

        // In Style 3 (Thoughtful): Tilt head gently as if listening attentively
        if (this.gestureStyle === 3) {
          talkTilt += 0.06;
        }

        b.head.rotation.y = this.currentMouse.x * 0.22 + Math.sin(elapsedTime * 0.55) * 0.025 + this.saccadeCurrent.x * 1.4;
        b.head.rotation.x = -this.currentMouse.y * 0.14 + talkNod + breathSine * 0.01;
        b.head.rotation.z = -this.currentMouse.x * 0.04 + talkTilt;
      }

      // --- C. Shoulders Respiration & Natural Posture ---
      if (b.leftShoulder) {
        b.leftShoulder.rotation.z = -0.06 + breathSine * 0.015 + (this.isTalking ? vol * 0.03 : 0);
      }
      if (b.rightShoulder) {
        b.rightShoulder.rotation.z = 0.06 - breathSine * 0.015 - (this.isTalking ? vol * 0.03 : 0);
      }

      // --- D. Natural Arms & Hands Conversational Gestures (Multi-Style) ---
      const baseArmDown = 1.38; // Relaxed resting arms at desk / streamer sides (~80 deg down)
      const baseArmForward = 0.18;
      const baseElbowBend = 0.35;
      const gPhase = this.talkGesturePhase;

      // Evaluate active spontaneous reaction (e.g. Gift / Gratitude / Wave / Middle Finger / Hide)
      let isReacting = false;
      let rWeight = 0;
      if (this.activeReaction) {
        this.reactionProgress += delta / this.reactionDuration;
        if (this.reactionProgress <= 1.0) {
          isReacting = true;
          // Smooth bell curve envelope [0.0 -> 1.0 -> 0.0]
          rWeight = Math.sin(this.reactionProgress * Math.PI);
        } else {
          this.activeReaction = null;
          this.reactionProgress = 0;
        }
      }

      if (isReacting) {
        const pose = this.activeReaction;

        if (pose === 'love') {
          // --- 1. POSE LOVE (Finger Heart / Saranghae) ---
          if (b.rightUpperArm) {
            b.rightUpperArm.rotation.z = baseArmDown - 0.85 * rWeight;
            b.rightUpperArm.rotation.x = baseArmForward + 0.70 * rWeight;
            b.rightUpperArm.rotation.y = -0.30 * rWeight;
          }
          if (b.rightLowerArm) {
            b.rightLowerArm.rotation.y = baseElbowBend + 1.25 * rWeight;
            b.rightLowerArm.rotation.z = 0.45 * rWeight;
          }
          if (b.rightHand) {
            b.rightHand.rotation.x = 0.20 * rWeight;
            b.rightHand.rotation.y = 0.55 * rWeight;
            b.rightHand.rotation.z = -0.15 * rWeight;
          }
          this._curlFingers('right', [false, false, true, true, true], rWeight);
          if (b.rightThumbProximal) b.rightThumbProximal.rotation.z = 0.40 * rWeight;
          if (b.rightIndexProximal) b.rightIndexProximal.rotation.z = 0.55 * rWeight;

          if (b.head) {
            b.head.rotation.z = 0.16 * rWeight;
            b.head.rotation.y = -0.08 * rWeight;
          }
          this.setExpressionSafe('happy', 0.85 * rWeight);
        } else if (pose === 'middle_finger') {
          // --- 2. POSE JARI TENGAH (Reaching Forward Straight Toward Camera) ---
          if (b.rightUpperArm) {
            // Thrust arm straight forward toward viewer / camera
            b.rightUpperArm.rotation.z = (baseArmDown - 1.22) * (1 - rWeight) + 0.16 * rWeight;
            b.rightUpperArm.rotation.x = baseArmForward + 1.28 * rWeight;
            b.rightUpperArm.rotation.y = -0.18 * rWeight;
          }
          if (b.rightLowerArm) {
            // Extended forearm pointing forward into the lens
            b.rightLowerArm.rotation.y = baseElbowBend * (1 - rWeight) + 0.22 * rWeight;
            b.rightLowerArm.rotation.x = 0.15 * rWeight;
          }
          if (b.rightHand) {
            b.rightHand.rotation.x = 0.32 * rWeight;
            b.rightHand.rotation.y = 0.05 * rWeight;
            b.rightHand.rotation.z = 0.08 * rWeight;
          }
          // Clench thumb, index, ring, little fingers into tight fist; middle finger fully straight
          this._curlFingers('right', [true, true, false, true, true], rWeight * 1.35);
          this._straightenFingers('right', ['Middle']);

          // Defiant confident smirk and slight head tilt
          if (b.head) {
            b.head.rotation.x = -0.14 * rWeight;
            b.head.rotation.z = 0.08 * rWeight;
            b.head.rotation.y = 0.06 * rWeight;
          }
          this.setExpressionSafe('surprised', 0.50 * rWeight);
        } else if (pose === 'hide') {
          // --- 3. POSE SEMBUNYI / PETAK UMPET (Peek-a-boo: Hands Cover Face, Then Peek) ---
          const peekSplit = this.reactionProgress > 0.40 && this.reactionProgress < 0.75
            ? Math.sin((this.reactionProgress - 0.40) / 0.35 * Math.PI) * 0.28
            : 0;

          // Both hands raise to playfully cover cheeks/eyes
          if (b.rightUpperArm) {
            b.rightUpperArm.rotation.z = baseArmDown - 0.75 * rWeight;
            b.rightUpperArm.rotation.x = baseArmForward + 1.05 * rWeight;
            b.rightUpperArm.rotation.y = (-0.45 + peekSplit) * rWeight;
          }
          if (b.rightLowerArm) {
            b.rightLowerArm.rotation.y = baseElbowBend + 1.40 * rWeight;
            b.rightLowerArm.rotation.z = (0.35 + peekSplit * 0.5) * rWeight;
          }
          if (b.rightHand) {
            b.rightHand.rotation.x = 0.35 * rWeight;
            b.rightHand.rotation.y = (0.45 - peekSplit) * rWeight;
          }

          if (b.leftUpperArm) {
            b.leftUpperArm.rotation.z = -baseArmDown + 0.75 * rWeight;
            b.leftUpperArm.rotation.x = baseArmForward + 1.05 * rWeight;
            b.leftUpperArm.rotation.y = (0.45 - peekSplit) * rWeight;
          }
          if (b.leftLowerArm) {
            b.leftLowerArm.rotation.y = -baseElbowBend - 1.40 * rWeight;
            b.leftLowerArm.rotation.z = (-0.35 - peekSplit * 0.5) * rWeight;
          }
          if (b.leftHand) {
            b.leftHand.rotation.x = 0.35 * rWeight;
            b.leftHand.rotation.y = (-0.45 + peekSplit) * rWeight;
          }

          // Relaxed open fingers near face
          this._straightenFingers('right', ['Thumb', 'Index', 'Middle', 'Ring', 'Little']);
          this._straightenFingers('left', ['Thumb', 'Index', 'Middle', 'Ring', 'Little']);

          if (b.head) {
            b.head.rotation.x = (0.12 - peekSplit * 0.15) * rWeight;
            b.head.rotation.z = peekSplit * 0.12 * rWeight;
          }
          this.setExpressionSafe('happy', (0.65 + peekSplit * 0.35) * rWeight);
        } else if (pose === 'peace') {
          // --- 4. POSE PEACE / V-SIGN ---
          if (b.rightUpperArm) {
            b.rightUpperArm.rotation.z = baseArmDown - 0.70 * rWeight;
            b.rightUpperArm.rotation.x = baseArmForward + 0.65 * rWeight;
          }
          if (b.rightLowerArm) {
            b.rightLowerArm.rotation.y = baseElbowBend + 1.20 * rWeight;
          }
          if (b.rightHand) {
            b.rightHand.rotation.y = 0.45 * rWeight;
            b.rightHand.rotation.z = -0.30 * rWeight;
          }
          this._curlFingers('right', [true, false, false, true, true], rWeight);
          this._straightenFingers('right', ['Index', 'Middle']);
          if (b.rightIndexProximal) b.rightIndexProximal.rotation.y = 0.22 * rWeight;
          if (b.rightMiddleProximal) b.rightMiddleProximal.rotation.y = -0.22 * rWeight;

          if (b.head) b.head.rotation.z = -0.15 * rWeight;
          this.setExpressionSafe('happy', 0.85 * rWeight);
        } else if (pose === 'wave') {
          // --- 5. POSE WAVE (Melambaikan Tangan Menyapa) ---
          const waveSwing = Math.sin(this.reactionProgress * Math.PI * 7) * 0.45 * rWeight;
          if (b.rightUpperArm) {
            b.rightUpperArm.rotation.z = 1.45 * rWeight;
            b.rightUpperArm.rotation.x = 0.45 * rWeight;
          }
          if (b.rightLowerArm) {
            b.rightLowerArm.rotation.y = 0.95 * rWeight;
            b.rightLowerArm.rotation.z = waveSwing * 0.5;
          }
          if (b.rightHand) {
            b.rightHand.rotation.z = waveSwing;
          }
          this._straightenFingers('right', ['Thumb', 'Index', 'Middle', 'Ring', 'Little']);

          if (b.head) {
            b.head.rotation.z = 0.12 * rWeight;
            b.head.rotation.y = -0.10 * rWeight;
          }
          this.setExpressionSafe('happy', 0.80 * rWeight);
        } else if (pose === 'dance') {
          // --- 6. POSE DANCE (Joget Santai & Asik) ---
          const danceCycle = Math.sin(this.reactionProgress * Math.PI * 5);
          const danceCos = Math.cos(this.reactionProgress * Math.PI * 5);
          if (b.hips) {
            b.hips.position.x = danceCycle * 0.08 * rWeight;
            b.hips.rotation.z = danceCycle * 0.08 * rWeight;
          }
          if (b.chest) {
            b.chest.rotation.z = -danceCycle * 0.06 * rWeight;
          }
          if (b.head) {
            b.head.rotation.y = danceCos * 0.15 * rWeight;
            b.head.rotation.z = danceCycle * 0.08 * rWeight;
          }
          if (b.rightUpperArm) {
            b.rightUpperArm.rotation.x = (0.45 + danceCycle * 0.35) * rWeight;
            b.rightUpperArm.rotation.z = 0.65 * rWeight;
          }
          if (b.leftUpperArm) {
            b.leftUpperArm.rotation.x = (0.45 - danceCycle * 0.35) * rWeight;
            b.leftUpperArm.rotation.z = -0.65 * rWeight;
          }
          this.setExpressionSafe('happy', 0.70 * rWeight);
        } else {
          // --- 7. POSE THANKS (Terima Kasih / Sungkem Dua Tangan Rapi) ---
          if (b.rightUpperArm) {
            b.rightUpperArm.rotation.z = baseArmDown - 0.55 * rWeight;
            b.rightUpperArm.rotation.x = baseArmForward + 0.55 * rWeight;
            b.rightUpperArm.rotation.y = -0.32 * rWeight;
          }
          if (b.rightLowerArm) {
            b.rightLowerArm.rotation.y = baseElbowBend + 0.90 * rWeight;
            b.rightLowerArm.rotation.z = 0.30 * rWeight;
          }
          if (b.rightHand) {
            b.rightHand.rotation.x = 0.35 * rWeight;
            b.rightHand.rotation.y = 0.35 * rWeight;
          }

          if (b.leftUpperArm) {
            b.leftUpperArm.rotation.z = -baseArmDown + 0.55 * rWeight;
            b.leftUpperArm.rotation.x = baseArmForward + 0.55 * rWeight;
            b.leftUpperArm.rotation.y = 0.32 * rWeight;
          }
          if (b.leftLowerArm) {
            b.leftLowerArm.rotation.y = -baseElbowBend - 0.90 * rWeight;
            b.leftLowerArm.rotation.z = -0.30 * rWeight;
          }
          if (b.leftHand) {
            b.leftHand.rotation.x = 0.35 * rWeight;
            b.leftHand.rotation.y = -0.35 * rWeight;
          }

          this._straightenFingers('right', ['Thumb', 'Index', 'Middle', 'Ring', 'Little']);
          this._straightenFingers('left', ['Thumb', 'Index', 'Middle', 'Ring', 'Little']);

          if (b.head) {
            b.head.rotation.x = 0.22 * rWeight; // Polite bow
          }
          this.setExpressionSafe('happy', 0.85 * rWeight);
        }
      } else {
        // --- RELAXED CONVERSATIONAL GESTURES (NO STIFF HIGH ARM LIFTS) ---
        let rForearm = 0, lForearm = 0;
        let rWrist = 0, lWrist = 0;

        if (this.isTalking) {
          // Gentle forearm and wrist cadence - arms remain resting down comfortably
          rForearm = (0.08 + Math.sin(gPhase * 1.1) * 0.06) * vol;
          rWrist = Math.sin(gPhase * 1.5) * 0.10 * vol;

          lForearm = (0.06 + Math.cos(gPhase * 0.9) * 0.05) * vol;
          lWrist = Math.cos(gPhase * 1.4) * 0.08 * vol;
        }

        // Left Arm application - resting naturally at desk level
        if (b.leftUpperArm) {
          b.leftUpperArm.rotation.z = -baseArmDown + breathSine * 0.012;
          b.leftUpperArm.rotation.x = baseArmForward + (this.isTalking ? 0.04 * vol : 0);
          b.leftUpperArm.rotation.y = 0.12;
        }
        if (b.leftLowerArm) {
          b.leftLowerArm.rotation.y = -baseElbowBend - lForearm;
          b.leftLowerArm.rotation.z = -0.12;
        }
        if (b.leftHand) {
          b.leftHand.rotation.x = 0.10 + lWrist;
          b.leftHand.rotation.z = 0.06;
        }

        // Right Arm application - resting naturally at desk level
        if (b.rightUpperArm) {
          b.rightUpperArm.rotation.z = baseArmDown - breathSine * 0.012 - (this.isTalking ? 0.05 * vol : 0);
          b.rightUpperArm.rotation.x = baseArmForward + (this.isTalking ? 0.06 * vol : 0);
          b.rightUpperArm.rotation.y = -0.12;
        }
        if (b.rightLowerArm) {
          b.rightLowerArm.rotation.y = baseElbowBend + rForearm;
          b.rightLowerArm.rotation.z = 0.14;
        }
        if (b.rightHand) {
          b.rightHand.rotation.x = 0.14 + rWrist;
          b.rightHand.rotation.z = -0.08;
        }
      }

      // --- E. Realistic Non-Linear Eyelid Blinking ---
      this.blinkTimer += delta;
      if (this.blinkTimer >= this.nextBlinkTime) {
        this.isBlinking = true;
        const blinkProgress = (this.blinkTimer - this.nextBlinkTime) / this.blinkDuration;
        if (blinkProgress <= 1.0) {
          const blinkWeight = Math.sin(blinkProgress * Math.PI);
          this.setExpressionSafe('blink', blinkWeight);
        } else {
          this.setExpressionSafe('blink', 0.0);
          this.isBlinking = false;
          this.blinkTimer = 0;
          // Random natural interval: 2.5 to 5.5s with 25% chance of realistic double-blink
          const isDoubleBlink = Math.random() < 0.25;
          this.nextBlinkTime = isDoubleBlink ? 0.35 : 2.5 + Math.random() * 3.2;
        }
      }

      // --- F. Real-time Multi-Vowel Dynamic Lip-Sync & Facial Expressions ---
      // Clamped to max 0.38 opening to prevent unnatural anime jaw dropping
      if (exp) {
        if (isReacting) {
          // Expressive reactions handle their own expression above
        } else if (this.isTalking) {
          const mouthOpen = Math.min(0.36, vol * 0.72);
          const vowelCycle = elapsedTime * 11.5;
          const aWeight = Math.max(0, Math.sin(vowelCycle)) * mouthOpen;
          const oWeight = Math.max(0, -Math.sin(vowelCycle)) * mouthOpen * 0.65;
          const iWeight = Math.max(0, Math.cos(vowelCycle * 0.85)) * mouthOpen * 0.45;

          this.setVowelSafe('aa', aWeight, 0.36);
          this.setVowelSafe('oh', oWeight, 0.30);
          this.setVowelSafe('ih', iWeight, 0.25);

          // Warm pleasant smile while speaking
          this.setExpressionSafe('happy', 0.22 + vol * 0.12);
        } else {
          // Smooth decay when silent
          this.decayVowelsSafe(0.25);
          // Gentle pleasant resting host expression
          this.setExpressionSafe('happy', 0.08);
        }
      }

      // Propagate bone updates and spring bone physics (hair & cloth fluttering)
      this.currentVrm.update(delta);
    }

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.clearCurrentModel();
    if (this._currentObjectUrl) {
      URL.revokeObjectURL(this._currentObjectUrl);
      this._currentObjectUrl = null;
    }
    if (this.particles) {
      this.particles.geometry.dispose();
      this.particles.material.dispose();
      this.scene.remove(this.particles);
    }
    if (this.renderer) {
      this.renderer.dispose();
    }
  }
}
