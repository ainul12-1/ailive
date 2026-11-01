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

    // Toggle Hide / Sembunyi & Peek System
    this.isHidingState = false;
    this.hidePhase = 'idle'; // 'idle', 'running_out', 'peeking', 'running_in'
    this.hideTransitionProgress = 0;
    this.onHideStateChange = () => {};

    this._currentObjectUrl = null;
    this._cameraFramed = false;
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
    if (this.currentModel) {
      this.currentModel.updateMatrixWorld(true);
    }
    let targetHeadY = 1.35;
    const headNode = this.vrmBones?.head;
    if (headNode) {
      headNode.updateWorldMatrix(true, false);
      const headPos = new THREE.Vector3();
      headNode.getWorldPosition(headPos);
      if (headPos.y > 0.6) {
        targetHeadY = headPos.y;
      }
    }
    const zoom = THREE.MathUtils.clamp(this.cameraZoom || 1.85, 1.15, 2.85);
    this.camera.position.set(0, targetHeadY - 0.08, zoom);
    this.camera.lookAt(0, targetHeadY - 0.20, 0);
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
   * Note: In VRM humanoid bones, Right hand curls on negative Z, Left hand curls on positive Z.
   */
  _curlFingers(handPrefix = 'right', mask = [true, true, true, true, true], weight = 1.0) {
    const b = this.vrmBones;
    if (!b) return;
    const sign = handPrefix === 'right' ? -1 : 1;
    const fingers = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];
    fingers.forEach((finger, i) => {
      if (!mask[i]) return;
      const p = b[`${handPrefix}${finger}Proximal`];
      const inter = b[`${handPrefix}${finger}Intermediate`];
      const d = b[`${handPrefix}${finger}Distal`];
      if (finger === 'Thumb') {
        const curlZ = 0.65 * weight * sign;
        const curlX = 0.35 * weight;
        if (p) { p.rotation.z = curlZ * 0.85; p.rotation.x = curlX; }
        if (inter) { inter.rotation.z = curlZ; }
        if (d) { d.rotation.z = curlZ * 0.85; }
      } else {
        const curlZ = 1.25 * weight * sign;
        if (p) { p.rotation.z = curlZ * 0.85; p.rotation.x = 0; p.rotation.y = 0; }
        if (inter) { inter.rotation.z = curlZ; inter.rotation.x = 0; inter.rotation.y = 0; }
        if (d) { d.rotation.z = curlZ * 0.85; d.rotation.x = 0; d.rotation.y = 0; }
      }
    });
  }

  /**
   * Helper to straighten finger joints outward cleanly
   */
  _straightenFingers(handPrefix = 'right', fingers = ['Thumb', 'Index', 'Middle', 'Ring', 'Little']) {
    const b = this.vrmBones;
    if (!b) return;
    fingers.forEach((finger) => {
      const p = b[`${handPrefix}${finger}Proximal`];
      const inter = b[`${handPrefix}${finger}Intermediate`];
      const d = b[`${handPrefix}${finger}Distal`];
      if (p) { p.rotation.set(0, 0, 0); }
      if (inter) { inter.rotation.set(0, 0, 0); }
      if (d) { d.rotation.set(0, 0, 0); }
    });
  }

  /**
   * Interactive Toggle Hide & Peek State Machine (Petak Umpet)
   * 1st click: Runs to the left wall, hides body off-screen, peeks head out cutely indefinitely
   * 2nd click: Runs shyly & happily back to center stage
   */
  toggleHide() {
    this.activeReaction = null;
    if (!this.isHidingState) {
      this.isHidingState = true;
      this.hidePhase = 'running_out';
      this.hideTransitionProgress = 0;
      console.log('🙈 [Avatar Sembunyi]: Lari sembunyi ke balik dinding...');
    } else {
      this.isHidingState = false;
      this.hidePhase = 'running_in';
      this.hideTransitionProgress = 0;
      console.log('👀 [Avatar Muncul]: Lari ceria kembali ke panggung...');
    }
    if (this.onHideStateChange) {
      this.onHideStateChange(this.isHidingState);
    }
    return this.isHidingState;
  }

  /**
   * Trigger modular emotional reaction or hand pose
   * Supported types: 'love', 'middle_finger', 'peace', 'wave', 'dance', 'thanks', 'hide'
   */
  triggerReaction(type = 'thanks', duration = 3.5) {
    if (type === 'hide') {
      return this.toggleHide();
    }
    if (this.isHidingState) {
      this.isHidingState = false;
      this.hidePhase = 'idle';
      if (this.currentModel) this.currentModel.position.set(0, 0, 0);
      if (this.vrmBones?.hips) {
        this.vrmBones.hips.position.set(0, 0, 0);
        this.vrmBones.hips.rotation.set(0, 0, 0);
      }
      if (this.onHideStateChange) {
        this.onHideStateChange(false);
      }
    }
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
            vrm.scene.position.set(0, 0, 0);
            vrm.scene.rotation.set(0, 0, 0);
            this.scene.add(vrm.scene);

            // Cache humanoid skeleton bones
            this.cacheVrmBones(vrm);

            // Compute initial bone transformations immediately
            vrm.scene.updateMatrixWorld(true);
            try {
              vrm.update(0);
            } catch (_) {}

            // Cache clothing materials and enhance face shading contrast
            this.clothMaterials = [];
            vrm.scene.traverse((child) => {
              if (child.isMesh) {
                // CRITICAL: Disable frustum culling so face and hair NEVER turn black/disappear
                child.frustumCulled = false;
                if (child.material) {
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
            modelScene.traverse((child) => {
              if (child.isMesh) child.frustumCulled = false;
            });
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
    this._cameraFramed = false;
    this.isHidingState = false;
    this.hidePhase = 'idle';
    this.hideTransitionProgress = 0;
    if (this.onHideStateChange) {
      this.onHideStateChange(false);
    }
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

    const rawDelta = this.clock.getDelta();
    // Clamp delta to prevent physics explosion & frame drop
    const delta = Math.min(rawDelta, 0.05);
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
      if (!this._cameraFramed) {
        this.updateCameraFrame();
        this._cameraFramed = true;
      }
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
      // In this VRM model: Left Arm points DOWN at +Z, Right Arm points DOWN at -Z
      const baseArmDown = 1.25; // ~72 degrees down along hips/sides
      const baseArmForward = 0.16;
      const baseElbowBend = 0.28;
      const gPhase = this.talkGesturePhase;

      // Check interactive Hide / Sembunyi State Machine
      if (this.hidePhase !== 'idle') {
        const hp = this.hidePhase;
        if (hp === 'running_out') {
          // Phase 1: Runs off-screen to the left
          this.hideTransitionProgress += delta / 1.0;
          const t = Math.min(1.0, this.hideTransitionProgress);
          const e = t * t;
          const runCycle = Math.sin(t * 26.0);
          const stepBounce = Math.abs(Math.sin(t * 26.0)) * 0.04;

          if (this.currentModel) {
            this.currentModel.position.x = -e * 2.4;
            this.currentModel.position.y = 0;
            this.currentModel.position.z = 0;
          }
          if (b.hips) {
            b.hips.rotation.y = -0.75;
            b.hips.position.y = stepBounce;
          }
          if (b.leftUpperArm) {
            b.leftUpperArm.rotation.x = runCycle * 0.75;
            b.leftUpperArm.rotation.z = 0.55;
          }
          if (b.rightUpperArm) {
            b.rightUpperArm.rotation.x = -runCycle * 0.75;
            b.rightUpperArm.rotation.z = -0.55;
          }
          if (b.leftLowerArm) b.leftLowerArm.rotation.y = -0.75;
          if (b.rightLowerArm) b.rightLowerArm.rotation.y = 0.75;

          if (b.head) {
            b.head.rotation.y = -0.35;
            b.head.rotation.x = 0.10;
          }
          this.setExpressionSafe('surprised', 0.85);

          if (t >= 1.0) {
            this.hidePhase = 'peeking';
            this.hideTransitionProgress = 0;
          }
        } else if (hp === 'peeking') {
          // Phase 2: Peeking cute head & shoulder out from behind the wall
          if (this.currentModel) {
            this.currentModel.position.x = -1.35;
            this.currentModel.position.y = 0;
            this.currentModel.position.z = 0;
          }
          if (b.hips) {
            b.hips.rotation.y = -0.28;
            b.hips.position.set(0, 0, 0);
          }
          if (b.spine) b.spine.rotation.set(0, 0, 0);
          if (b.chest) b.chest.rotation.set(0, 0, 0);

          const peekSway = Math.sin(elapsedTime * 1.6) * 0.04;
          if (b.head) {
            b.head.rotation.z = 0.24 + peekSway;
            b.head.rotation.y = 0.45 + this.currentMouse.x * 0.12;
            b.head.rotation.x = -0.06 + Math.sin(elapsedTime * 0.8) * 0.03;
          }
          if (b.neck) {
            b.neck.rotation.y = 0.15;
            b.neck.rotation.z = 0.08;
          }

          // Arms tucked shyly behind body
          if (b.leftUpperArm) {
            b.leftUpperArm.rotation.z = 0.95;
            b.leftUpperArm.rotation.x = 0.20;
          }
          if (b.rightUpperArm) {
            b.rightUpperArm.rotation.z = -0.95;
            b.rightUpperArm.rotation.x = 0.20;
          }
          if (b.leftLowerArm) b.leftLowerArm.rotation.y = -0.50;
          if (b.rightLowerArm) b.rightLowerArm.rotation.y = 0.50;

          this.setExpressionSafe('happy', 0.90);
        } else if (hp === 'running_in') {
          // Phase 3: Runs shyly & happily back to center stage
          this.hideTransitionProgress += delta / 1.0;
          const t = Math.min(1.0, this.hideTransitionProgress);
          const e = 1.0 - (1.0 - t) * (1.0 - t);
          const runCycle = Math.sin(t * 26.0);
          const stepBounce = Math.abs(Math.sin(t * 26.0)) * 0.04;

          if (this.currentModel) {
            this.currentModel.position.x = THREE.MathUtils.lerp(-1.35, 0, e);
            this.currentModel.position.y = 0;
            this.currentModel.position.z = 0;
          }
          if (b.hips) {
            b.hips.rotation.y = (1.0 - e) * 0.55;
            b.hips.position.y = t < 1.0 ? stepBounce : 0;
          }
          if (b.leftUpperArm) {
            b.leftUpperArm.rotation.x = runCycle * 0.55;
            b.leftUpperArm.rotation.z = THREE.MathUtils.lerp(0.55, baseArmDown, e);
          }
          if (b.rightUpperArm) {
            b.rightUpperArm.rotation.x = -runCycle * 0.55;
            b.rightUpperArm.rotation.z = THREE.MathUtils.lerp(-0.55, -baseArmDown, e);
          }
          if (b.leftLowerArm) b.leftLowerArm.rotation.y = -baseElbowBend;
          if (b.rightLowerArm) b.rightLowerArm.rotation.y = baseElbowBend;

          if (b.head) {
            b.head.rotation.y = (1.0 - e) * 0.35;
            b.head.rotation.z = 0;
          }
          this.setExpressionSafe('happy', 0.85);

          if (t >= 1.0) {
            this.hidePhase = 'idle';
            if (this.currentModel) this.currentModel.position.set(0, 0, 0);
            if (b.hips) {
              b.hips.position.set(0, 0, 0);
              b.hips.rotation.set(0, 0, 0);
            }
          }
        }
      } else {
        // Evaluate active spontaneous reaction (e.g. Love / Middle Finger / Peace / Wave / Dance / Thanks)
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
            if (this.currentModel) this.currentModel.position.set(0, 0, 0);
            if (b.hips) {
              b.hips.position.set(0, 0, 0);
              b.hips.rotation.set(0, 0, 0);
            }
            this._straightenFingers('right', ['Thumb', 'Index', 'Middle', 'Ring', 'Little']);
            this._straightenFingers('left', ['Thumb', 'Index', 'Middle', 'Ring', 'Little']);
          }
        }

        if (isReacting) {
          const pose = this.activeReaction;

          if (pose === 'love') {
            // --- 1. POSE LOVE (Mini Finger Heart 🫰 / Saranghae beside cheek) ---
            if (b.leftUpperArm) {
              b.leftUpperArm.rotation.z = baseArmDown;
              b.leftUpperArm.rotation.x = baseArmForward;
              b.leftUpperArm.rotation.y = -0.10;
            }
            if (b.leftLowerArm) {
              b.leftLowerArm.rotation.y = -baseElbowBend;
            }
            if (b.leftHand) {
              b.leftHand.rotation.x = 0.08;
            }

            // Right arm raises gently to cheek level
            if (b.rightUpperArm) {
              b.rightUpperArm.rotation.z = -baseArmDown + 0.70 * rWeight;
              b.rightUpperArm.rotation.y = -0.65 * rWeight;
              b.rightUpperArm.rotation.x = baseArmForward + 0.35 * rWeight;
            }
            if (b.rightLowerArm) {
              b.rightLowerArm.rotation.y = baseElbowBend + 1.20 * rWeight;
              b.rightLowerArm.rotation.z = 0.35 * rWeight;
            }
            if (b.rightHand) {
              b.rightHand.rotation.x = 0.20 * rWeight;
              b.rightHand.rotation.y = 0.35 * rWeight;
              b.rightHand.rotation.z = -0.20 * rWeight;
            }

            // Fingers: Mini heart 🫰 (Thumb & Index crossed, Middle half-curled, Ring & Little curled)
            this._curlFingers('right', [false, false, false, true, true], rWeight * 1.3);
            if (b.rightMiddleProximal) b.rightMiddleProximal.rotation.z = -0.75 * rWeight;
            if (b.rightMiddleIntermediate) b.rightMiddleIntermediate.rotation.z = -0.75 * rWeight;
            if (b.rightThumbProximal) {
              b.rightThumbProximal.rotation.z = -0.40 * rWeight;
              b.rightThumbProximal.rotation.x = 0.35 * rWeight;
            }
            if (b.rightIndexProximal) {
              b.rightIndexProximal.rotation.z = -0.42 * rWeight;
              b.rightIndexProximal.rotation.x = -0.15 * rWeight;
            }
            if (b.rightIndexIntermediate) b.rightIndexIntermediate.rotation.z = -0.35 * rWeight;

            if (b.head) {
              b.head.rotation.z = -0.16 * rWeight;
              b.head.rotation.y = 0.10 * rWeight;
            }
            this.setExpressionSafe('happy', 0.95 * rWeight);
          } else if (pose === 'middle_finger') {
            // --- 2. POSE JARI TENGAH (Straight Forward Defiantly Toward Camera Lens) ---
            if (b.leftUpperArm) {
              b.leftUpperArm.rotation.z = baseArmDown;
              b.leftUpperArm.rotation.x = baseArmForward;
              b.leftUpperArm.rotation.y = -0.10;
            }
            if (b.leftLowerArm) {
              b.leftLowerArm.rotation.y = -baseElbowBend;
            }
            if (b.leftHand) {
              b.leftHand.rotation.x = 0.08;
            }

            // Right arm swung forward pointing directly into camera (+Z)
            if (b.rightUpperArm) {
              b.rightUpperArm.rotation.y = -1.35 * rWeight; // Swings arm forward toward camera!
              b.rightUpperArm.rotation.z = (-baseArmDown * (1 - rWeight)) - 0.12 * rWeight;
              b.rightUpperArm.rotation.x = baseArmForward * (1 - rWeight) + 0.22 * rWeight;
            }
            if (b.rightLowerArm) {
              b.rightLowerArm.rotation.y = 0.15 * rWeight;
              b.rightLowerArm.rotation.x = 0.12 * rWeight;
              b.rightLowerArm.rotation.z = 0.05 * rWeight;
            }
            if (b.rightHand) {
              b.rightHand.rotation.x = 0.15 * rWeight;
              b.rightHand.rotation.y = -0.10 * rWeight;
              b.rightHand.rotation.z = -0.15 * rWeight;
            }

            // Clench Thumb, Index, Ring, Little tightly; middle finger stays fully extended
            this._curlFingers('right', [true, true, false, true, true], rWeight * 1.35);
            this._straightenFingers('right', ['Middle']);
            if (b.rightThumbProximal) {
              b.rightThumbProximal.rotation.z = -0.55 * rWeight;
              b.rightThumbProximal.rotation.x = 0.40 * rWeight;
            }

            // Defiant challenger smirk & tilt
            if (b.head) {
              b.head.rotation.x = -0.08 * rWeight;
              b.head.rotation.z = -0.06 * rWeight;
            }
            this.setExpressionSafe('surprised', 0.40 * rWeight);
          } else if (pose === 'peace') {
            // --- 3. POSE PEACE / V-SIGN ✌️ ---
            if (b.leftUpperArm) {
              b.leftUpperArm.rotation.z = baseArmDown;
              b.leftUpperArm.rotation.x = baseArmForward;
              b.leftUpperArm.rotation.y = -0.10;
            }
            if (b.leftLowerArm) {
              b.leftLowerArm.rotation.y = -baseElbowBend;
            }

            if (b.rightUpperArm) {
              b.rightUpperArm.rotation.z = -baseArmDown + 0.70 * rWeight;
              b.rightUpperArm.rotation.y = -0.55 * rWeight;
              b.rightUpperArm.rotation.x = baseArmForward + 0.35 * rWeight;
            }
            if (b.rightLowerArm) {
              b.rightLowerArm.rotation.y = baseElbowBend + 1.25 * rWeight;
              b.rightLowerArm.rotation.z = 0.35 * rWeight;
            }
            if (b.rightHand) {
              b.rightHand.rotation.x = 0.15 * rWeight;
              b.rightHand.rotation.y = 0.20 * rWeight;
              b.rightHand.rotation.z = -0.25 * rWeight;
            }

            // Curl Ring & Little; Thumb holds them down; Index & Middle extended in V
            this._curlFingers('right', [false, false, false, true, true], rWeight * 1.3);
            if (b.rightThumbProximal) {
              b.rightThumbProximal.rotation.z = -0.65 * rWeight;
              b.rightThumbProximal.rotation.x = 0.35 * rWeight;
            }
            this._straightenFingers('right', ['Index', 'Middle']);
            if (b.rightIndexProximal) b.rightIndexProximal.rotation.y = 0.22 * rWeight;
            if (b.rightMiddleProximal) b.rightMiddleProximal.rotation.y = -0.22 * rWeight;

            if (b.head) b.head.rotation.z = -0.14 * rWeight;
            this.setExpressionSafe('happy', 0.90 * rWeight);
          } else if (pose === 'wave') {
            // --- 4. POSE WAVE (Melambaikan Tangan Menyapa 👋) ---
            if (b.leftUpperArm) {
              b.leftUpperArm.rotation.z = baseArmDown;
              b.leftUpperArm.rotation.x = baseArmForward;
              b.leftUpperArm.rotation.y = -0.10;
            }
            if (b.leftLowerArm) {
              b.leftLowerArm.rotation.y = -baseElbowBend;
            }

            const waveSwing = Math.sin(this.reactionProgress * Math.PI * 7) * 0.45 * rWeight;
            if (b.rightUpperArm) {
              b.rightUpperArm.rotation.z = -baseArmDown + 1.45 * rWeight;
              b.rightUpperArm.rotation.y = -0.30 * rWeight;
              b.rightUpperArm.rotation.x = 0.35 * rWeight;
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
            this.setExpressionSafe('happy', 0.85 * rWeight);
          } else if (pose === 'dance') {
            // --- 5. POSE DANCE (Joget Santai & Asik 💃) ---
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
              b.rightUpperArm.rotation.x = baseArmForward + (danceCycle * 0.30) * rWeight;
              b.rightUpperArm.rotation.z = -baseArmDown + 0.45 * rWeight;
            }
            if (b.leftUpperArm) {
              b.leftUpperArm.rotation.x = baseArmForward - (danceCycle * 0.30) * rWeight;
              b.leftUpperArm.rotation.z = baseArmDown - 0.45 * rWeight;
            }
            this.setExpressionSafe('happy', 0.75 * rWeight);
          } else {
            // --- 6. POSE THANKS (Sungkem Dua Tangan Rapi di Depan Dada 🙏) ---
            if (b.rightUpperArm) {
              b.rightUpperArm.rotation.z = -baseArmDown * (1 - rWeight) - 0.65 * rWeight;
              b.rightUpperArm.rotation.y = -0.45 * rWeight;
              b.rightUpperArm.rotation.x = baseArmForward * (1 - rWeight) + 0.45 * rWeight;
            }
            if (b.rightLowerArm) {
              b.rightLowerArm.rotation.y = baseElbowBend * (1 - rWeight) + 1.10 * rWeight;
              b.rightLowerArm.rotation.z = 0.35 * rWeight;
            }
            if (b.rightHand) {
              b.rightHand.rotation.x = 0.30 * rWeight;
              b.rightHand.rotation.y = 0.30 * rWeight;
              b.rightHand.rotation.z = -0.15 * rWeight;
            }

            if (b.leftUpperArm) {
              b.leftUpperArm.rotation.z = baseArmDown * (1 - rWeight) + 0.65 * rWeight;
              b.leftUpperArm.rotation.y = 0.45 * rWeight;
              b.leftUpperArm.rotation.x = baseArmForward * (1 - rWeight) + 0.45 * rWeight;
            }
            if (b.leftLowerArm) {
              b.leftLowerArm.rotation.y = -baseElbowBend * (1 - rWeight) - 1.10 * rWeight;
              b.leftLowerArm.rotation.z = -0.35 * rWeight;
            }
            if (b.leftHand) {
              b.leftHand.rotation.x = 0.30 * rWeight;
              b.leftHand.rotation.y = -0.30 * rWeight;
              b.leftHand.rotation.z = 0.15 * rWeight;
            }

            this._straightenFingers('right', ['Thumb', 'Index', 'Middle', 'Ring', 'Little']);
            this._straightenFingers('left', ['Thumb', 'Index', 'Middle', 'Ring', 'Little']);

            if (b.head) {
              b.head.rotation.x = 0.22 * rWeight; // Polite respectful bow
            }
            this.setExpressionSafe('happy', 0.85 * rWeight);
          }
        } else {
          // --- RELAXED CONVERSATIONAL GESTURES (NATURAL RESTING ARMS AT SIDES) ---
          let rForearm = 0, lForearm = 0;
          let rWrist = 0, lWrist = 0;

          if (this.isTalking) {
            // Subtle forearm & wrist micro-cadence while talking - arms stay resting down comfortably
            rForearm = (0.06 + Math.sin(gPhase * 1.1) * 0.05) * vol;
            rWrist = Math.sin(gPhase * 1.4) * 0.08 * vol;

            lForearm = (0.05 + Math.cos(gPhase * 0.9) * 0.04) * vol;
            lWrist = Math.cos(gPhase * 1.3) * 0.06 * vol;
          }

          // Left Arm application - hangs down naturally along left hip
          if (b.leftUpperArm) {
            b.leftUpperArm.rotation.z = baseArmDown - breathSine * 0.012;
            b.leftUpperArm.rotation.x = baseArmForward + (this.isTalking ? 0.03 * vol : 0);
            b.leftUpperArm.rotation.y = -0.10;
          }
          if (b.leftLowerArm) {
            b.leftLowerArm.rotation.y = -baseElbowBend - lForearm;
            b.leftLowerArm.rotation.z = -0.10;
          }
          if (b.leftHand) {
            b.leftHand.rotation.x = 0.08 + lWrist;
            b.leftHand.rotation.z = 0.05;
          }

          // Right Arm application - hangs down naturally along right hip
          if (b.rightUpperArm) {
            b.rightUpperArm.rotation.z = -baseArmDown + breathSine * 0.012 - (this.isTalking ? 0.04 * vol : 0);
            b.rightUpperArm.rotation.x = baseArmForward + (this.isTalking ? 0.04 * vol : 0);
            b.rightUpperArm.rotation.y = 0.10;
          }
          if (b.rightLowerArm) {
            b.rightLowerArm.rotation.y = baseElbowBend + rForearm;
            b.rightLowerArm.rotation.z = 0.10;
          }
          if (b.rightHand) {
            b.rightHand.rotation.x = 0.08 + rWrist;
            b.rightHand.rotation.z = -0.05;
          }

          // Ensure fingers rest naturally in idle
          this._straightenFingers('right', ['Thumb', 'Index', 'Middle', 'Ring', 'Little']);
          this._straightenFingers('left', ['Thumb', 'Index', 'Middle', 'Ring', 'Little']);
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
