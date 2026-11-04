import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

/**
 * AvatarRenderer - Anime-Film Grade Living 3D Humanoid Engine
 * Features:
 *  - Organic Contrapposto Weight-Shift (Living human idle)
 *  - Formant-Driven Multi-Vowel Dynamic Lip-Sync (No robotic flapping)
 *  - Procedural Locomotion (Real walking, pacing & turning across stage)
 *  - Rhythmic Groove & Anime Dance
 *  - Fluid Conversational Gesturing (Storytelling, explanation, thoughtful poses)
 *  - Active Spring Bone Wind Physics (Hair ribbons, bangs & clothes flutter naturally)
 *  - Aesthetic Anime Hand & Finger Poses (No stiff mannequin hands)
 *  - Asymmetrical Snappy Biological Blinking & Eye Look-At
 */
export class AvatarRenderer {
  constructor(canvasContainer) {
    this.container = canvasContainer;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.clock = new THREE.Clock();

    // Models & VRM references
    this.currentModel = null;
    this.currentVrm = null;
    this.vrmBones = {};
    this.boneRestPos = {};
    this.springJoints = [];
    this.clothMaterials = [];
    this.currentClothColor = null;

    // Audio Analysis & Lip-Sync State
    this.audioAnalysisGetter = null;
    this.audioVolumeGetter = () => 0;
    this.smoothedVolume = 0;
    this.vowelValues = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
    this.isTalking = false;
    this.talkCadence = 0;

    // Mouse / Interaction Look-At Target
    this.targetMouse = new THREE.Vector2(0, 0);
    this.currentMouse = new THREE.Vector2(0, 0);

    // Subconscious Human Eye Saccades
    this.saccadeTimer = 0;
    this.saccadeTarget = new THREE.Vector2(0, 0);
    this.saccadeCurrent = new THREE.Vector2(0, 0);

    // Asymmetrical Snappy Blink System
    this.blinkTimer = 0;
    this.blinkDuration = 0.19;
    this.nextBlinkTime = 3.2;
    this.isBlinking = false;

    // Organic Idle & Weight Shift (Contrapposto)
    this.weightShiftTimer = 0;
    this.weightShiftTarget = 0; // -1: Left leg, 0: Center, 1: Right leg
    this.weightShiftCurrent = 0;
    this.nextWeightShift = 5.0;

    // Humanoid Conversational Gesture State Machine
    this.gestureStyle = 0; // 0: Right hand explain, 1: Both hands warm storytelling, 2: Left hand active, 3: Thoughtful head tilt & chest touch
    this.gestureTimer = 0;
    this.nextGestureSwitch = 4.0;
    this.gestureBlendWeight = 1.0;
    this.currentGestureWeights = [1, 0, 0, 0];
    this.targetGestureWeights = [1, 0, 0, 0];

    // Locomotion & Stage Movement State
    this.locomotionMode = 'idle'; // 'idle', 'walk', 'groove'
    this.walkPhase = 0;
    this.walkSpeed = 1.6;
    this.walkDirection = 1; // 1: walking right, -1: walking left
    this.walkBounds = 0.65; // stage limits in meters
    this.currentTurnYaw = 0;
    this.targetTurnYaw = 0;
    this.groovePhase = 0;

    // Modular Spontaneous Reaction System
    this.activeReaction = null;
    this.reactionProgress = 0;
    this.reactionDuration = 3.2;

    // Interactive Hide & Peek System (Petak Umpet)
    this.isHidingState = false;
    this.hidePhase = 'idle'; // 'idle', 'running_out', 'peeking', 'running_in'
    this.hideTransitionProgress = 0;
    this.onHideStateChange = () => {};

    // Camera Framing & Loading State
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

    // Dynamic FOV for portrait mobile vs desktop widescreen
    const baseFov = 28;
    const fov = aspect < 0.75 ? baseFov + (0.75 - aspect) * 26 : baseFov;

    const savedZoom = parseFloat(localStorage.getItem('ailive_cam_zoom'));
    this.cameraZoom = (!savedZoom || isNaN(savedZoom) || savedZoom < 1.0 || savedZoom > 3.0) ? 1.85 : savedZoom;

    this.camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 100);
    this.camera.position.set(0, 1.25, this.cameraZoom);
    this.camera.lookAt(0, 1.15, 0);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(width, height);
    const isMobile = typeof navigator !== 'undefined' && (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || width < 768);
    this.renderer.setPixelRatio(isMobile ? 1.0 : Math.min(window.devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.container.appendChild(this.renderer.domElement);

    this.setupLighting();
    this.setupFloatingParticles();
    this.setupInteractionListeners();

    window.addEventListener('resize', () => this.onWindowResize());
    this.animate();
  }

  setupLighting() {
    // 1. Warm Soft Ambient Fill
    const ambientLight = new THREE.AmbientLight(0xfff5ee, 0.48);
    this.scene.add(ambientLight);

    // 2. Key Anime Portrait Light - top-right angled for crisp anime nose and jaw shadows
    const keyLight = new THREE.DirectionalLight(0xfffaed, 0.98);
    keyLight.position.set(0.65, 2.2, 1.45);
    this.scene.add(keyLight);

    // 3. Cool Soft Fill - left side
    const fillLight = new THREE.DirectionalLight(0xdce7f8, 0.38);
    fillLight.position.set(-0.85, 1.2, 1.1);
    this.scene.add(fillLight);

    // 4. Low Chin & Lip Contour Light
    const chinLight = new THREE.DirectionalLight(0xffe2d5, 0.28);
    chinLight.position.set(0, 0.4, 1.1);
    this.scene.add(chinLight);

    // 5. Stylistic Crimson Rim Light - silhouettes hair strands and body contour
    const rimLight = new THREE.DirectionalLight(0xf43f5e, 1.35);
    rimLight.position.set(-1.2, 1.6, -1.3);
    this.scene.add(rimLight);

    // 6. Warm Gold Hair Rim
    const goldRim = new THREE.DirectionalLight(0xfbbf24, 0.85);
    goldRim.position.set(1.2, 1.2, -1.1);
    this.scene.add(goldRim);
  }

  setupFloatingParticles() {
    const isMobile = typeof navigator !== 'undefined' && (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768);
    const particleCount = isMobile ? 20 : 55;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i += 3) {
      pos[i] = (Math.random() - 0.5) * 3.2;
      pos[i + 1] = Math.random() * 2.3 + 0.3;
      pos[i + 2] = (Math.random() - 0.5) * 2.6;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xf43f5e,
      size: isMobile ? 0.016 : 0.022,
      transparent: true,
      opacity: 0.32,
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
    let targetHeadY = 1.38;
    const headNode = this.vrmBones?.head;
    if (headNode) {
      headNode.updateWorldMatrix(true, false);
      const headPos = new THREE.Vector3();
      headNode.getWorldPosition(headPos);
      if (headPos.y > 0.8 && headPos.y < 2.2) {
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

  setAudioAnalysisGetter(getter) {
    this.audioAnalysisGetter = getter;
  }

  setClothColor(hexColor) {
    if (!hexColor) return;
    this.currentClothColor = hexColor;
    const color = new THREE.Color(hexColor);
    for (const mat of this.clothMaterials) {
      if (mat.color) mat.color.copy(color);
      if (mat.shadeColor) mat.shadeColor.copy(color).multiplyScalar(0.72);
      if (mat.shadeColorFactor) mat.shadeColorFactor.copy(color).multiplyScalar(0.72);
    }
  }

  /**
   * Safe VRM expression helper supporting both VRM 0.0 and VRM 1.0 preset names
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
      name === 'blink' ? 'Blink' : null,
    ].filter(Boolean);

    for (const c of candidates) {
      try {
        em.setValue(c, weight);
      } catch (_) {}
    }
  }

  /**
   * Safe VRM vowel helper for phoneme expression
   */
  setVowelSafe(vowel, weight, maxVal = 1.0) {
    if (!this.currentVrm?.expressionManager) return;
    const em = this.currentVrm.expressionManager;
    const clamped = THREE.MathUtils.clamp(weight, 0, maxVal);
    const vowelMap = {
      aa: ['aa', 'a', 'A', 'aa_vowel'],
      ih: ['ih', 'i', 'I', 'ih_vowel'],
      ou: ['ou', 'u', 'U', 'ou_vowel'],
      ee: ['ee', 'e', 'E', 'ee_vowel'],
      oh: ['oh', 'o', 'O', 'oh_vowel'],
    };
    const candidates = vowelMap[vowel] || [vowel];
    for (const c of candidates) {
      try {
        em.setValue(c, clamped);
      } catch (_) {}
    }
  }

  /**
   * Anime Aesthetic Resting Hand Pose Helper
   * Naturally curles fingers with gentle elegance, preventing stiff mannequin hands.
   */
  _setAnimeFingers(handPrefix = 'right', curlMultiplier = 1.0, flex = 0.0) {
    const b = this.vrmBones;
    if (!b) return;
    const sign = handPrefix === 'right' ? -1 : 1;

    // Natural graduated curvature of anime hands
    const fingerProfiles = {
      Thumb:  { baseZ: 0.22, baseX: 0.20, interZ: 0.18, distZ: 0.15 },
      Index:  { baseZ: 0.28, baseX: 0.02, interZ: 0.32, distZ: 0.22 },
      Middle: { baseZ: 0.40, baseX: 0.00, interZ: 0.45, distZ: 0.30 },
      Ring:   { baseZ: 0.50, baseX: -0.02, interZ: 0.54, distZ: 0.35 },
      Little: { baseZ: 0.56, baseX: -0.04, interZ: 0.60, distZ: 0.38 },
    };

    for (const [finger, p] of Object.entries(fingerProfiles)) {
      const prox = b[`${handPrefix}${finger}Proximal`];
      const inter = b[`${handPrefix}${finger}Intermediate`];
      const dist = b[`${handPrefix}${finger}Distal`];

      const z = (p.baseZ * curlMultiplier + flex * 0.05) * sign;
      const x = p.baseX;

      if (prox) { prox.rotation.z = z; prox.rotation.x = x; }
      if (inter) { inter.rotation.z = p.interZ * curlMultiplier * sign; }
      if (dist) { dist.rotation.z = p.distZ * curlMultiplier * sign; }
    }
  }

  /**
   * Custom Finger Curling Helper (for poses such as Heart, Peace, Middle Finger)
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
   * Straighten specific fingers outward
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
   * Set Locomotion Mode ('idle', 'walk', 'groove')
   */
  setLocomotion(mode = 'idle') {
    this.locomotionMode = mode;
    console.log(`🚶‍♀️ [Avatar Gerak]: Mode lokomosi diubah ke "${mode}"`);
  }

  /**
   * Toggle Locomotion Walking Mode
   */
  toggleWalk() {
    if (this.locomotionMode === 'walk') {
      this.setLocomotion('idle');
      return false;
    } else {
      this.setLocomotion('walk');
      return true;
    }
  }

  /**
   * Toggle Locomotion Groove / Dance Mode
   */
  toggleGroove() {
    if (this.locomotionMode === 'groove') {
      this.setLocomotion('idle');
      return false;
    } else {
      this.setLocomotion('groove');
      return true;
    }
  }

  /**
   * Interactive Toggle Hide & Peek State Machine (Petak Umpet)
   */
  toggleHide() {
    this.activeReaction = null;
    this.locomotionMode = 'idle';
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
   * Trigger Modular Reaction Pose
   */
  triggerReaction(type = 'thanks', duration = 3.5) {
    if (type === 'hide') return this.toggleHide();
    if (type === 'walk') return this.toggleWalk();
    if (type === 'groove') return this.toggleGroove();

    if (this.isHidingState) {
      this.isHidingState = false;
      this.hidePhase = 'idle';
      if (this.currentModel) this.currentModel.position.set(0, 0, 0);
      if (this.vrmBones?.hips && this.boneRestPos?.hips) {
        this.vrmBones.hips.position.copy(this.boneRestPos.hips);
        this.vrmBones.hips.rotation.set(0, 0, 0);
      }
      if (this.onHideStateChange) this.onHideStateChange(false);
    }

    this.activeReaction = type;
    this.reactionProgress = 0;
    this.reactionDuration = duration;
    console.log(`🎭 [Avatar Pose]: Menjalankan reaksi "${type}" (${duration}s)`);
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
            this.scene.add(vrm.scene);

            // Cache all humanoid skeleton bones and rest positions
            this.cacheVrmBones(vrm);

            // Setup Spring Bone Wind Physics (hair, ribbons, and cloth)
            this.setupSpringBones(vrm);

            // Compute initial bone transformations immediately
            vrm.scene.updateMatrixWorld(true);
            try {
              vrm.update(0);
            } catch (_) {}

            // Cache clothing materials and enhance face shading contrast
            this.clothMaterials = [];
            vrm.scene.traverse((child) => {
              if (child.isMesh) {
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

                    // Boost facial definition for clean anime look
                    if (name.includes('face') || name.includes('skin') || name.includes('mouth')) {
                      if (mat.shadeColor) mat.shadeColor.setRGB(0.90, 0.76, 0.70);
                      if (mat.shadeColorFactor) mat.shadeColorFactor.setRGB(0.92, 0.82, 0.78);
                    }
                  }
                }
              }
            });

            if (this.currentClothColor) {
              this.setClothColor(this.currentClothColor);
            }

            this.updateCameraFrame();
          } else {
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
      // Core spine & head
      hips: h.getNormalizedBoneNode('hips'),
      spine: h.getNormalizedBoneNode('spine'),
      chest: h.getNormalizedBoneNode('chest') || h.getNormalizedBoneNode('upperChest'),
      upperChest: h.getNormalizedBoneNode('upperChest'),
      neck: h.getNormalizedBoneNode('neck'),
      head: h.getNormalizedBoneNode('head'),
      jaw: h.getNormalizedBoneNode('jaw'),

      // Shoulders & Arms
      leftShoulder: h.getNormalizedBoneNode('leftShoulder'),
      rightShoulder: h.getNormalizedBoneNode('rightShoulder'),
      leftUpperArm: h.getNormalizedBoneNode('leftUpperArm'),
      rightUpperArm: h.getNormalizedBoneNode('rightUpperArm'),
      leftLowerArm: h.getNormalizedBoneNode('leftLowerArm'),
      rightLowerArm: h.getNormalizedBoneNode('rightLowerArm'),
      leftHand: h.getNormalizedBoneNode('leftHand'),
      rightHand: h.getNormalizedBoneNode('rightHand'),

      // Legs & Feet (Full-Body Locomotion & Weight Shift)
      leftUpperLeg: h.getNormalizedBoneNode('leftUpperLeg'),
      rightUpperLeg: h.getNormalizedBoneNode('rightUpperLeg'),
      leftLowerLeg: h.getNormalizedBoneNode('leftLowerLeg'),
      rightLowerLeg: h.getNormalizedBoneNode('rightLowerLeg'),
      leftFoot: h.getNormalizedBoneNode('leftFoot'),
      rightFoot: h.getNormalizedBoneNode('rightFoot'),
      leftToes: h.getNormalizedBoneNode('leftToes'),
      rightToes: h.getNormalizedBoneNode('rightToes'),

      // Right Hand Fingers
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

    // Store rest position and rotation for smooth transitions
    this.boneRestPos = {};
    for (const [key, bone] of Object.entries(this.vrmBones)) {
      if (bone) {
        this.boneRestPos[key] = {
          position: bone.position.clone(),
          rotation: bone.rotation.clone(),
        };
      }
    }
  }

  setupSpringBones(vrm) {
    this.springJoints = [];
    if (!vrm.springBoneManager) return;
    const sm = vrm.springBoneManager;
    if (sm.joints && Array.isArray(sm.joints)) {
      for (const joint of sm.joints) {
        if (joint && joint.settings) {
          // Enable dynamic physical responsiveness for hair & cloth
          joint.settings.gravityPower = Math.max(0.32, joint.settings.gravityPower || 0.32);
          joint.settings.dragForce = Math.min(0.55, Math.max(0.28, joint.settings.dragForce || 0.40));
          this.springJoints.push(joint);
        }
      }
    }
    console.log(`✨ [VRM Physics]: Mengaktifkan simulasi angin fisik untuk ${this.springJoints.length} sendi rambut & pakaian`);
  }

  clearCurrentModel() {
    this._cameraFramed = false;
    this.isHidingState = false;
    this.hidePhase = 'idle';
    this.hideTransitionProgress = 0;
    this.locomotionMode = 'idle';
    if (this.onHideStateChange) this.onHideStateChange(false);

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
    this.boneRestPos = {};
    this.springJoints = [];
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.0 : 1.5));
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const rawDelta = this.clock.getDelta();
    const delta = Math.min(rawDelta, 0.05);
    const elapsedTime = this.clock.getElapsedTime();

    // 1. Audio Analysis & Vocal Articulation
    let audioData = { volume: 0, lowBand: 0, midBand: 0, highBand: 0, isSpeaking: false };
    if (this.audioAnalysisGetter) {
      audioData = this.audioAnalysisGetter();
    } else if (this.audioVolumeGetter) {
      const v = this.audioVolumeGetter() || 0;
      audioData = { volume: v, lowBand: v * 0.8, midBand: v, highBand: v * 0.7, isSpeaking: v > 0.05 };
    }

    const rawVol = audioData.volume || 0;
    // Asymmetrical envelope follower (instant attack, organic decay)
    if (rawVol > this.smoothedVolume) {
      this.smoothedVolume += (rawVol - this.smoothedVolume) * 0.55;
    } else {
      this.smoothedVolume += (rawVol - this.smoothedVolume) * 0.18;
    }
    const vol = this.smoothedVolume;
    this.isTalking = vol > 0.05;

    if (this.isTalking) {
      this.talkCadence += delta * (3.2 + vol * 4.2);
    }

    // 2. Behavioral Conversational Gesture State Machine (switches styles smoothly every 3.5 - 6s)
    this.gestureTimer += delta;
    if (this.gestureTimer >= this.nextGestureSwitch) {
      this.gestureTimer = 0;
      const prev = this.gestureStyle;
      let next = Math.floor(Math.random() * 4);
      if (next === prev) next = (next + 1) % 4;
      this.gestureStyle = next;
      this.nextGestureSwitch = 3.8 + Math.random() * 3.2;

      // Update target blend weights
      this.targetGestureWeights = [0, 0, 0, 0];
      this.targetGestureWeights[next] = 1.0;
    }

    // Smoothly blend gesture style weights
    for (let i = 0; i < 4; i++) {
      this.currentGestureWeights[i] += (this.targetGestureWeights[i] - this.currentGestureWeights[i]) * 0.08;
    }

    // 3. Living Human Weight Shift (Contrapposto) Timer
    this.weightShiftTimer += delta;
    if (this.weightShiftTimer >= this.nextWeightShift) {
      this.weightShiftTimer = 0;
      // Cycle: -0.75 (left leg stance) -> 0.75 (right leg stance) -> 0 (balanced)
      const stances = [-0.75, 0.75, -0.4, 0.4];
      this.weightShiftTarget = stances[Math.floor(Math.random() * stances.length)];
      this.nextWeightShift = 4.5 + Math.random() * 3.5;
    }
    this.weightShiftCurrent += (this.weightShiftTarget - this.weightShiftCurrent) * 0.035;

    // 4. Smooth Mouse Parallax Tracking & Micro Saccades
    this.currentMouse.x += (this.targetMouse.x - this.currentMouse.x) * 0.055;
    this.currentMouse.y += (this.targetMouse.y - this.currentMouse.y) * 0.055;

    this.saccadeTimer += delta;
    if (this.saccadeTimer > 2.5 + Math.random() * 2.8) {
      this.saccadeTarget.x = (Math.random() - 0.5) * 0.055;
      this.saccadeTarget.y = (Math.random() - 0.5) * 0.035;
      this.saccadeTimer = 0;
    }
    this.saccadeCurrent.lerp(this.saccadeTarget, 0.08);

    // 5. Floating Ambient Particles Rotation
    if (this.particles) {
      this.particles.rotation.y = elapsedTime * 0.022;
    }

    // =========================================================================
    // 🎭 VRM LIVING ANIME MOTION ENGINE
    // =========================================================================
    if (this.currentVrm) {
      if (!this._cameraFramed) {
        this.updateCameraFrame();
        this._cameraFramed = true;
      }

      const b = this.vrmBones;
      const exp = this.currentVrm.expressionManager;
      const rest = this.boneRestPos;

      // Base arm resting constants (arms hang naturally along sides)
      const baseArmDown = 1.25; // ~72 degrees
      const baseArmForward = 0.16;
      const baseElbowBend = 0.28;

      // --- 1. Respiration Curves ---
      // Non-harmonic frequencies combine to prevent mechanical looping
      const breathSine = Math.sin(elapsedTime * 1.35) * 0.65 + Math.sin(elapsedTime * 0.55 + 1.2) * 0.35;
      const breathPhaseDelayed = Math.sin(elapsedTime * 1.35 - 0.22) * 0.65 + Math.sin(elapsedTime * 0.55 + 0.98) * 0.35;
      const hostSway = Math.sin(elapsedTime * 0.42) * 0.015;

      let rootVelocityX = 0;
      let rootVelocityZ = 0;

      // =======================================================================
      // A. LOCOMOTION & STAGE STATE MACHINE
      // =======================================================================
      if (this.hidePhase !== 'idle') {
        // --- PETAK UMPET (Hide & Peek) ---
        const hp = this.hidePhase;
        if (hp === 'running_out') {
          this.hideTransitionProgress += delta / 1.0;
          const t = Math.min(1.0, this.hideTransitionProgress);
          const e = t * t;
          const runCycle = Math.sin(t * 26.0);
          const stepBounce = Math.abs(Math.sin(t * 26.0)) * 0.04;

          if (this.currentModel) this.currentModel.position.set(-e * 2.4, 0, 0);
          if (b.hips && rest.hips) {
            b.hips.rotation.y = -0.75;
            b.hips.position.set(rest.hips.position.x, rest.hips.position.y + stepBounce, rest.hips.position.z);
          }
          if (b.leftUpperArm) { b.leftUpperArm.rotation.x = runCycle * 0.75; b.leftUpperArm.rotation.z = 0.55; }
          if (b.rightUpperArm) { b.rightUpperArm.rotation.x = -runCycle * 0.75; b.rightUpperArm.rotation.z = -0.55; }
          if (b.leftLowerArm) b.leftLowerArm.rotation.y = -0.75;
          if (b.rightLowerArm) b.rightLowerArm.rotation.y = 0.75;
          if (b.head) { b.head.rotation.y = -0.35; b.head.rotation.x = 0.10; }
          this.setExpressionSafe('surprised', 0.85);

          if (t >= 1.0) {
            this.hidePhase = 'peeking';
            this.hideTransitionProgress = 0;
          }
        } else if (hp === 'peeking') {
          if (this.currentModel) this.currentModel.position.set(-1.35, 0, 0);
          if (b.hips && rest.hips) {
            b.hips.rotation.y = -0.28;
            b.hips.position.copy(rest.hips.position);
          }
          if (b.spine) b.spine.rotation.set(0, 0, 0);
          if (b.chest) b.chest.rotation.set(0, 0, 0);
          const peekSway = Math.sin(elapsedTime * 1.6) * 0.04;
          if (b.head) {
            b.head.rotation.z = 0.24 + peekSway;
            b.head.rotation.y = 0.45 + this.currentMouse.x * 0.12;
            b.head.rotation.x = -0.06 + Math.sin(elapsedTime * 0.8) * 0.03;
          }
          if (b.neck) { b.neck.rotation.y = 0.15; b.neck.rotation.z = 0.08; }
          if (b.leftUpperArm) { b.leftUpperArm.rotation.z = 0.95; b.leftUpperArm.rotation.x = 0.20; }
          if (b.rightUpperArm) { b.rightUpperArm.rotation.z = -0.95; b.rightUpperArm.rotation.x = 0.20; }
          if (b.leftLowerArm) b.leftLowerArm.rotation.y = -0.50;
          if (b.rightLowerArm) b.rightLowerArm.rotation.y = 0.50;
          this.setExpressionSafe('happy', 0.90);
        } else if (hp === 'running_in') {
          this.hideTransitionProgress += delta / 1.0;
          const t = Math.min(1.0, this.hideTransitionProgress);
          const e = 1.0 - (1.0 - t) * (1.0 - t);
          const runCycle = Math.sin(t * 26.0);
          const stepBounce = Math.abs(Math.sin(t * 26.0)) * 0.04;

          if (this.currentModel) this.currentModel.position.set(THREE.MathUtils.lerp(-1.35, 0, e), 0, 0);
          if (b.hips && rest.hips) {
            b.hips.rotation.y = (1.0 - e) * 0.55;
            b.hips.position.set(rest.hips.position.x, rest.hips.position.y + (t < 1.0 ? stepBounce : 0), rest.hips.position.z);
          }
          if (b.leftUpperArm) { b.leftUpperArm.rotation.x = runCycle * 0.55; b.leftUpperArm.rotation.z = THREE.MathUtils.lerp(0.55, baseArmDown, e); }
          if (b.rightUpperArm) { b.rightUpperArm.rotation.x = -runCycle * 0.55; b.rightUpperArm.rotation.z = THREE.MathUtils.lerp(-0.55, -baseArmDown, e); }
          if (b.leftLowerArm) b.leftLowerArm.rotation.y = -baseElbowBend;
          if (b.rightLowerArm) b.rightLowerArm.rotation.y = baseElbowBend;
          if (b.head) { b.head.rotation.y = (1.0 - e) * 0.35; b.head.rotation.z = 0; }
          this.setExpressionSafe('happy', 0.85);

          if (t >= 1.0) {
            this.hidePhase = 'idle';
            if (this.currentModel) this.currentModel.position.set(0, 0, 0);
            if (b.hips && rest.hips) {
              b.hips.position.copy(rest.hips.position);
              b.hips.rotation.set(0, 0, 0);
            }
          }
        }
      } else if (this.activeReaction) {
        // --- ACTIVE MODULAR REACTION POSE ---
        this.reactionProgress += delta / this.reactionDuration;
        let rWeight = 0;
        if (this.reactionProgress <= 1.0) {
          rWeight = Math.sin(this.reactionProgress * Math.PI);
        } else {
          this.activeReaction = null;
          this.reactionProgress = 0;
          if (this.currentModel) this.currentModel.position.set(0, 0, 0);
          if (b.hips && rest.hips) {
            b.hips.position.copy(rest.hips.position);
            b.hips.rotation.set(0, 0, 0);
          }
        }

        if (this.activeReaction) {
          const pose = this.activeReaction;
          if (pose === 'love') {
            // Mini Finger Heart 🫰
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
            this._curlFingers('right', [false, false, false, true, true], rWeight * 1.3);
            if (b.rightMiddleProximal) b.rightMiddleProximal.rotation.z = -0.75 * rWeight;
            if (b.rightMiddleIntermediate) b.rightMiddleIntermediate.rotation.z = -0.75 * rWeight;
            if (b.rightThumbProximal) { b.rightThumbProximal.rotation.z = -0.40 * rWeight; b.rightThumbProximal.rotation.x = 0.35 * rWeight; }
            if (b.rightIndexProximal) { b.rightIndexProximal.rotation.z = -0.42 * rWeight; b.rightIndexProximal.rotation.x = -0.15 * rWeight; }
            if (b.head) { b.head.rotation.z = -0.16 * rWeight; b.head.rotation.y = 0.10 * rWeight; }
            this.setExpressionSafe('happy', 0.95 * rWeight);
          } else if (pose === 'middle_finger') {
            // Defiant Forward Jari Tengah
            if (b.rightUpperArm) {
              b.rightUpperArm.rotation.y = -1.35 * rWeight;
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
            this._curlFingers('right', [true, true, false, true, true], rWeight * 1.35);
            this._straightenFingers('right', ['Middle']);
            if (b.rightThumbProximal) { b.rightThumbProximal.rotation.z = -0.55 * rWeight; b.rightThumbProximal.rotation.x = 0.40 * rWeight; }
            if (b.head) { b.head.rotation.x = -0.08 * rWeight; b.head.rotation.z = -0.06 * rWeight; }
            this.setExpressionSafe('surprised', 0.40 * rWeight);
          } else if (pose === 'peace') {
            // Peace V-Sign ✌️
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
            this._curlFingers('right', [false, false, false, true, true], rWeight * 1.3);
            if (b.rightThumbProximal) { b.rightThumbProximal.rotation.z = -0.65 * rWeight; b.rightThumbProximal.rotation.x = 0.35 * rWeight; }
            this._straightenFingers('right', ['Index', 'Middle']);
            if (b.rightIndexProximal) b.rightIndexProximal.rotation.y = 0.22 * rWeight;
            if (b.rightMiddleProximal) b.rightMiddleProximal.rotation.y = -0.22 * rWeight;
            if (b.head) b.head.rotation.z = -0.14 * rWeight;
            this.setExpressionSafe('happy', 0.90 * rWeight);
          } else if (pose === 'wave') {
            // Wave Greetings 👋
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
            if (b.rightHand) b.rightHand.rotation.z = waveSwing;
            this._setAnimeFingers('right', 0.5);
            if (b.head) { b.head.rotation.z = 0.12 * rWeight; b.head.rotation.y = -0.10 * rWeight; }
            this.setExpressionSafe('happy', 0.85 * rWeight);
          } else if (pose === 'dance') {
            // Energetic Dance
            const danceCycle = Math.sin(this.reactionProgress * Math.PI * 5);
            const danceCos = Math.cos(this.reactionProgress * Math.PI * 5);
            if (b.hips && rest.hips) {
              b.hips.position.set(rest.hips.position.x + danceCycle * 0.08 * rWeight, rest.hips.position.y, rest.hips.position.z);
              b.hips.rotation.z = danceCycle * 0.08 * rWeight;
            }
            if (b.chest) b.chest.rotation.z = -danceCycle * 0.06 * rWeight;
            if (b.head) { b.head.rotation.y = danceCos * 0.15 * rWeight; b.head.rotation.z = danceCycle * 0.08 * rWeight; }
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
            // Thanks / Sungkem Pose 🙏
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
            this._setAnimeFingers('right', 0.4);
            this._setAnimeFingers('left', 0.4);
            if (b.head) b.head.rotation.x = 0.22 * rWeight;
            this.setExpressionSafe('happy', 0.85 * rWeight);
          }
        }
      } else if (this.locomotionMode === 'walk') {
        // =====================================================================
        // REAL PROCEDURAL LOCOMOTION (JALAN & PINDAH TEMPAT)
        // =====================================================================
        this.walkPhase += delta * this.walkSpeed * Math.PI * 2;
        const wp = this.walkPhase;

        // Advance root position along X axis
        const stepDist = delta * 0.42 * this.walkDirection;
        if (this.currentModel) {
          this.currentModel.position.x += stepDist;
          rootVelocityX = stepDist / delta;

          // Check stage boundaries and turn smoothly
          if (this.currentModel.position.x > this.walkBounds && this.walkDirection > 0) {
            this.walkDirection = -1;
            this.targetTurnYaw = Math.PI * 0.55;
          } else if (this.currentModel.position.x < -this.walkBounds && this.walkDirection < 0) {
            this.walkDirection = 1;
            this.targetTurnYaw = -Math.PI * 0.55;
          }
        }

        // Smooth turn yaw
        this.currentTurnYaw += (this.targetTurnYaw - this.currentTurnYaw) * 0.08;
        if (this.currentModel) {
          this.currentModel.rotation.y = this.currentTurnYaw;
        }

        // Pelvic bob (two vertical dips per stride)
        const walkBob = -Math.abs(Math.sin(wp)) * 0.035;
        const walkPelvisRoll = Math.sin(wp) * 0.055;
        const walkPelvisYaw = Math.cos(wp) * 0.085;

        if (b.hips && rest.hips) {
          b.hips.position.set(rest.hips.position.x, rest.hips.position.y + walkBob, rest.hips.position.z);
          b.hips.rotation.z = walkPelvisRoll;
          b.hips.rotation.y = walkPelvisYaw;
        }

        // Counter-rotation on Spine and Chest
        if (b.spine) {
          b.spine.rotation.z = -walkPelvisRoll * 0.65;
          b.spine.rotation.y = -walkPelvisYaw * 0.55;
        }
        if (b.chest) {
          b.chest.rotation.z = -walkPelvisRoll * 0.35;
          b.chest.rotation.y = -walkPelvisYaw * 0.45;
        }

        // Alternating Leg Stride
        const rightLegSwing = Math.sin(wp);
        const leftLegSwing = Math.sin(wp + Math.PI);

        // Right leg
        if (b.rightUpperLeg) {
          b.rightUpperLeg.rotation.x = rightLegSwing * 0.42;
          b.rightUpperLeg.rotation.z = -0.04;
        }
        if (b.rightLowerLeg) {
          // Knee flexes during recovery phase (when swinging forward)
          const kneeFlex = Math.max(0, -rightLegSwing * 0.75);
          b.rightLowerLeg.rotation.x = kneeFlex;
        }
        if (b.rightFoot) {
          b.rightFoot.rotation.x = -rightLegSwing * 0.22;
        }

        // Left leg
        if (b.leftUpperLeg) {
          b.leftUpperLeg.rotation.x = leftLegSwing * 0.42;
          b.leftUpperLeg.rotation.z = 0.04;
        }
        if (b.leftLowerLeg) {
          const kneeFlex = Math.max(0, -leftLegSwing * 0.75);
          b.leftLowerLeg.rotation.x = kneeFlex;
        }
        if (b.leftFoot) {
          b.leftFoot.rotation.x = -leftLegSwing * 0.22;
        }

        // Counter Arm Swing (Left arm swings with right leg)
        if (b.leftUpperArm) {
          b.leftUpperArm.rotation.x = baseArmForward + rightLegSwing * 0.38;
          b.leftUpperArm.rotation.z = baseArmDown * 0.85;
        }
        if (b.leftLowerArm) {
          b.leftLowerArm.rotation.y = -baseElbowBend - 0.25;
        }
        if (b.rightUpperArm) {
          b.rightUpperArm.rotation.x = baseArmForward + leftLegSwing * 0.38;
          b.rightUpperArm.rotation.z = -baseArmDown * 0.85;
        }
        if (b.rightLowerArm) {
          b.rightLowerArm.rotation.y = baseElbowBend + 0.25;
        }

        // Anime relaxed fingers while walking
        this._setAnimeFingers('right', 0.85);
        this._setAnimeFingers('left', 0.85);

        // Head LookAt stabilization
        if (b.head) {
          b.head.rotation.y = this.currentMouse.x * 0.18 - this.currentTurnYaw * 0.6;
          b.head.rotation.x = -this.currentMouse.y * 0.12 + Math.sin(wp * 2) * 0.02;
          b.head.rotation.z = -walkPelvisRoll * 0.4;
        }
      } else if (this.locomotionMode === 'groove') {
        // =====================================================================
        // ANIME GROOVE / RHYTHMIC SWAY (GOYANG ASLI HIDUP)
        // =====================================================================
        this.groovePhase += delta * 2.8;
        const gp = this.groovePhase;

        const swayX = Math.sin(gp) * 0.045;
        const bounceY = -Math.abs(Math.sin(gp)) * 0.025;
        const swayRoll = Math.sin(gp) * 0.085;

        if (b.hips && rest.hips) {
          b.hips.position.set(rest.hips.position.x + swayX, rest.hips.position.y + bounceY, rest.hips.position.z);
          b.hips.rotation.z = swayRoll;
          b.hips.rotation.y = Math.cos(gp * 0.5) * 0.06;
        }

        // Knees gently pumping in rhythm
        if (b.leftUpperLeg) b.leftUpperLeg.rotation.x = 0.06 + Math.sin(gp) * 0.04;
        if (b.leftLowerLeg) b.leftLowerLeg.rotation.x = 0.12 - Math.sin(gp) * 0.05;
        if (b.rightUpperLeg) b.rightUpperLeg.rotation.x = 0.06 - Math.sin(gp) * 0.04;
        if (b.rightLowerLeg) b.rightLowerLeg.rotation.x = 0.12 + Math.sin(gp) * 0.05;

        // Torso counter-sway
        if (b.spine) b.spine.rotation.z = -swayRoll * 0.6;
        if (b.chest) b.chest.rotation.z = -swayRoll * 0.4;

        // Charming anime forearm groove
        const armSway = Math.cos(gp) * 0.18;
        if (b.rightUpperArm) {
          b.rightUpperArm.rotation.z = -baseArmDown + 0.40;
          b.rightUpperArm.rotation.x = baseArmForward + armSway;
        }
        if (b.rightLowerArm) {
          b.rightLowerArm.rotation.y = baseElbowBend + 0.55 + armSway * 0.5;
        }
        if (b.leftUpperArm) {
          b.leftUpperArm.rotation.z = baseArmDown - 0.40;
          b.leftUpperArm.rotation.x = baseArmForward - armSway;
        }
        if (b.leftLowerArm) {
          b.leftLowerArm.rotation.y = -baseElbowBend - 0.55 - armSway * 0.5;
        }

        this._setAnimeFingers('right', 0.6);
        this._setAnimeFingers('left', 0.6);

        if (b.head) {
          b.head.rotation.z = -swayRoll * 0.75;
          b.head.rotation.y = this.currentMouse.x * 0.18 + Math.sin(gp * 0.5) * 0.08;
          b.head.rotation.x = -this.currentMouse.y * 0.12 + Math.abs(Math.sin(gp)) * 0.03;
        }
        this.setExpressionSafe('happy', 0.65);
      } else {
        // =====================================================================
        // ORGANIC LIVING IDLE (CONTRAPPOSTO & FLUID GESTURES)
        // =====================================================================
        const ws = this.weightShiftCurrent; // [-1.0 ... 1.0]

        // 1. Pelvic & Hips Weight Shift
        if (b.hips && rest.hips) {
          const hipShiftX = ws * 0.032 + hostSway;
          const hipRollZ = -ws * 0.045;
          const hipYawY = ws * 0.025 + this.currentMouse.x * 0.04;
          const hipDipY = -Math.abs(ws) * 0.008 + breathSine * 0.003;

          b.hips.position.set(rest.hips.position.x + hipShiftX, rest.hips.position.y + hipDipY, rest.hips.position.z);
          b.hips.rotation.z = hipRollZ;
          b.hips.rotation.y = hipYawY;
        }

        // 2. Spine & Chest Natural Counter-Balance & Respiration
        if (b.spine) {
          b.spine.rotation.x = breathSine * 0.022;
          b.spine.rotation.y = this.currentMouse.x * 0.06 + Math.sin(elapsedTime * 0.4) * 0.012;
          b.spine.rotation.z = ws * 0.032 - this.currentMouse.x * 0.012;
        }
        if (b.chest) {
          const chestNod = this.isTalking ? Math.sin(this.talkCadence * 0.8) * 0.015 * vol : 0;
          b.chest.rotation.x = breathSine * 0.035 + chestNod;
          b.chest.rotation.y = this.currentMouse.x * 0.08;
          b.chest.rotation.z = ws * 0.022;
        }

        // 3. Legs Anatomical Stance (Weight-Bearing vs Relaxed Leg)
        if (b.leftUpperLeg && b.rightUpperLeg) {
          if (ws < 0) {
            // Leaning on Left Leg: left leg straightens, right leg relaxes cute anime bend
            b.leftUpperLeg.rotation.z = -0.02;
            b.leftUpperLeg.rotation.x = 0;
            if (b.leftLowerLeg) b.leftLowerLeg.rotation.x = 0;

            b.rightUpperLeg.rotation.z = 0.06;
            b.rightUpperLeg.rotation.x = -ws * 0.08;
            if (b.rightLowerLeg) b.rightLowerLeg.rotation.x = -ws * 0.14;
          } else {
            // Leaning on Right Leg
            b.rightUpperLeg.rotation.z = 0.02;
            b.rightUpperLeg.rotation.x = 0;
            if (b.rightLowerLeg) b.rightLowerLeg.rotation.x = 0;

            b.leftUpperLeg.rotation.z = -0.06;
            b.leftUpperLeg.rotation.x = ws * 0.08;
            if (b.leftLowerLeg) b.leftLowerLeg.rotation.x = ws * 0.14;
          }
        }

        // 4. Shoulders Respiration (lagging behind chest expansion for realism)
        if (b.leftShoulder) {
          b.leftShoulder.rotation.z = -0.05 + breathPhaseDelayed * 0.020 + (this.isTalking ? vol * 0.035 : 0);
        }
        if (b.rightShoulder) {
          b.rightShoulder.rotation.z = 0.05 - breathPhaseDelayed * 0.020 - (this.isTalking ? vol * 0.035 : 0);
        }

        // 5. Conversational Gesturing vs Relaxed Resting Arms
        const w0 = this.currentGestureWeights[0];
        const w1 = this.currentGestureWeights[1];
        const w2 = this.currentGestureWeights[2];
        const w3 = this.currentGestureWeights[3];
        const tCad = this.talkCadence;
        const talkAmp = this.isTalking ? THREE.MathUtils.clamp(vol * 1.5, 0.2, 1.0) : 0;

        // Base Idle Arm Rotations (resting naturally along hips)
        let rArmZ = -baseArmDown + breathSine * 0.015;
        let rArmX = baseArmForward;
        let rArmY = 0.10;
        let rElbowY = baseElbowBend;
        let rWristX = 0.06;
        let rWristZ = -0.04;

        let lArmZ = baseArmDown - breathSine * 0.015;
        let lArmX = baseArmForward;
        let lArmY = -0.10;
        let lElbowY = -baseElbowBend;
        let lWristX = 0.06;
        let lWristZ = 0.04;

        if (this.isTalking) {
          // --- STYLE 0: Right Hand Expressive Explanation ---
          const g0Pulse = Math.sin(tCad * 1.2) * 0.08;
          const g0_rArmZ = -0.68 + g0Pulse * 0.5;
          const g0_rArmX = 0.52 + Math.cos(tCad * 0.9) * 0.08;
          const g0_rArmY = -0.42;
          const g0_rElbowY = 1.15 + g0Pulse;
          const g0_rWristX = 0.22 + g0Pulse * 1.2;

          // --- STYLE 1: Two Hands Warm Storytelling ---
          const g1Pulse = Math.sin(tCad * 1.1) * 0.06;
          const g1_rArmZ = -0.75 + g1Pulse * 0.4;
          const g1_rArmX = 0.42 + Math.cos(tCad * 0.8) * 0.06;
          const g1_rArmY = -0.35;
          const g1_rElbowY = 0.95 + g1Pulse;

          const g1_lArmZ = 0.75 - g1Pulse * 0.4;
          const g1_lArmX = 0.42 + Math.cos(tCad * 0.8) * 0.06;
          const g1_lArmY = 0.35;
          const g1_lElbowY = -0.95 - g1Pulse;

          // --- STYLE 2: Left Hand Active Gesturing ---
          const g2Pulse = Math.sin(tCad * 1.3) * 0.08;
          const g2_lArmZ = 0.68 - g2Pulse * 0.5;
          const g2_lArmX = 0.52 + Math.cos(tCad * 0.9) * 0.08;
          const g2_lArmY = 0.42;
          const g2_lElbowY = -1.15 - g2Pulse;
          const g2_lWristX = 0.22 + g2Pulse * 1.2;

          // --- STYLE 3: Thoughtful Presenting (Hand Near Chest / Heart) ---
          const g3_rArmZ = -0.45;
          const g3_rArmX = 0.65;
          const g3_rArmY = -0.55;
          const g3_rElbowY = 1.45;

          // Blend according to active gesture weights & speech amplitude
          rArmZ = THREE.MathUtils.lerp(rArmZ, (g0_rArmZ * w0 + g1_rArmZ * w1 + rArmZ * w2 + g3_rArmZ * w3), talkAmp);
          rArmX = THREE.MathUtils.lerp(rArmX, (g0_rArmX * w0 + g1_rArmX * w1 + rArmX * w2 + g3_rArmX * w3), talkAmp);
          rArmY = THREE.MathUtils.lerp(rArmY, (g0_rArmY * w0 + g1_rArmY * w1 + rArmY * w2 + g3_rArmY * w3), talkAmp);
          rElbowY = THREE.MathUtils.lerp(rElbowY, (g0_rElbowY * w0 + g1_rElbowY * w1 + rElbowY * w2 + g3_rElbowY * w3), talkAmp);
          rWristX = THREE.MathUtils.lerp(rWristX, (g0_rWristX * w0 + 0.15 * w1 + rWristX * w2 + 0.10 * w3), talkAmp);

          lArmZ = THREE.MathUtils.lerp(lArmZ, (lArmZ * w0 + g1_lArmZ * w1 + g2_lArmZ * w2 + lArmZ * w3), talkAmp);
          lArmX = THREE.MathUtils.lerp(lArmX, (lArmX * w0 + g1_lArmX * w1 + g2_lArmX * w2 + lArmX * w3), talkAmp);
          lArmY = THREE.MathUtils.lerp(lArmY, (lArmY * w0 + g1_lArmY * w1 + g2_lArmY * w2 + lArmY * w3), talkAmp);
          lElbowY = THREE.MathUtils.lerp(lElbowY, (lElbowY * w0 + g1_lElbowY * w1 + g2_lElbowY * w2 + lElbowY * w3), talkAmp);
          lWristX = THREE.MathUtils.lerp(lWristX, (lWristX * w0 + 0.15 * w1 + g2_lWristX * w2 + lWristX * w3), talkAmp);
        }

        // Apply Right Arm rotations
        if (b.rightUpperArm) {
          b.rightUpperArm.rotation.z = rArmZ;
          b.rightUpperArm.rotation.x = rArmX;
          b.rightUpperArm.rotation.y = rArmY;
        }
        if (b.rightLowerArm) {
          b.rightLowerArm.rotation.y = rElbowY;
          b.rightLowerArm.rotation.z = 0.10;
        }
        if (b.rightHand) {
          b.rightHand.rotation.x = rWristX;
          b.rightHand.rotation.z = rWristZ;
        }

        // Apply Left Arm rotations
        if (b.leftUpperArm) {
          b.leftUpperArm.rotation.z = lArmZ;
          b.leftUpperArm.rotation.x = lArmX;
          b.leftUpperArm.rotation.y = lArmY;
        }
        if (b.leftLowerArm) {
          b.leftLowerArm.rotation.y = lElbowY;
          b.leftLowerArm.rotation.z = -0.10;
        }
        if (b.leftHand) {
          b.leftHand.rotation.x = lWristX;
          b.leftHand.rotation.z = lWristZ;
        }

        // 6. Natural Anime Hand Curl (Replaces rigid mannequin straighten)
        const fingerFlex = Math.sin(elapsedTime * 1.35) * 0.1 + (this.isTalking ? Math.sin(tCad * 1.5) * 0.15 * vol : 0);
        this._setAnimeFingers('right', 0.95 - (this.isTalking ? w0 * 0.45 + w1 * 0.35 : 0), fingerFlex);
        this._setAnimeFingers('left', 0.95 - (this.isTalking ? w1 * 0.35 + w2 * 0.45 : 0), fingerFlex);

        // 7. Head & Neck Looking, Conversational Nods & Tilts
        if (b.neck) {
          b.neck.rotation.y = this.currentMouse.x * 0.12 + this.saccadeCurrent.x;
          b.neck.rotation.x = -this.currentMouse.y * 0.08 + this.saccadeCurrent.y;
        }
        if (b.head) {
          const talkNod = this.isTalking ? Math.sin(tCad * 1.6) * 0.10 * vol : 0;
          let talkTilt = this.isTalking ? Math.cos(tCad * 0.9) * 0.08 * vol : 0;
          if (this.gestureStyle === 3) talkTilt += 0.08;

          b.head.rotation.y = this.currentMouse.x * 0.22 + Math.sin(elapsedTime * 0.55) * 0.025 + this.saccadeCurrent.x * 1.4;
          b.head.rotation.x = -this.currentMouse.y * 0.14 + talkNod + breathSine * 0.01;
          b.head.rotation.z = -this.currentMouse.x * 0.04 + talkTilt - ws * 0.025;
        }
      }

      // =======================================================================
      // B. ASYMMETRICAL SNAPPY BIOLOGICAL BLINK
      // =======================================================================
      this.blinkTimer += delta;
      if (this.blinkTimer >= this.nextBlinkTime) {
        this.isBlinking = true;
        const p = (this.blinkTimer - this.nextBlinkTime) / this.blinkDuration;
        if (p <= 1.0) {
          // Asymmetrical curve: fast snap down in 28% of time, smooth ease open in 72%
          let weight = 0;
          if (p < 0.28) {
            weight = Math.pow(p / 0.28, 1.8);
          } else {
            weight = 1.0 - Math.pow((p - 0.28) / 0.72, 1.4);
          }
          this.setExpressionSafe('blink', weight);
        } else {
          this.setExpressionSafe('blink', 0.0);
          this.isBlinking = false;
          this.blinkTimer = 0;
          const isDoubleBlink = Math.random() < 0.22;
          this.nextBlinkTime = isDoubleBlink ? 0.32 : 2.6 + Math.random() * 3.4;
        }
      }

      // =======================================================================
      // C. FORMANT-DRIVEN ORGANIC MULTI-VOWEL LIP-SYNC (NO ROBOTIC FLAPPING)
      // =======================================================================
      if (exp) {
        if (!this.activeReaction && this.hidePhase === 'idle') {
          if (this.isTalking) {
            // Formant analysis drives mouth shapes with natural dynamic range
            const targetAa = THREE.MathUtils.clamp(audioData.midBand * 0.85 + vol * 0.40, 0, 0.85);
            const targetOh = THREE.MathUtils.clamp(audioData.lowBand * 0.75 + (vol > 0.4 ? 0.25 : 0), 0, 0.75);
            const targetIh = THREE.MathUtils.clamp(audioData.highBand * 0.70, 0, 0.65);
            const targetEe = THREE.MathUtils.clamp((audioData.highBand + audioData.midBand * 0.4) * 0.60, 0, 0.60);
            const targetOu = THREE.MathUtils.clamp((audioData.lowBand + audioData.midBand * 0.3) * 0.55, 0, 0.55);

            // Responsive exponential smoothing
            this.vowelValues.aa += (targetAa - this.vowelValues.aa) * 0.48;
            this.vowelValues.oh += (targetOh - this.vowelValues.oh) * 0.42;
            this.vowelValues.ih += (targetIh - this.vowelValues.ih) * 0.40;
            this.vowelValues.ee += (targetEe - this.vowelValues.ee) * 0.38;
            this.vowelValues.ou += (targetOu - this.vowelValues.ou) * 0.38;

            this.setVowelSafe('aa', this.vowelValues.aa, 0.85);
            this.setVowelSafe('oh', this.vowelValues.oh, 0.75);
            this.setVowelSafe('ih', this.vowelValues.ih, 0.65);
            this.setVowelSafe('ee', this.vowelValues.ee, 0.60);
            this.setVowelSafe('ou', this.vowelValues.ou, 0.55);

            // Subtle jaw bone opening if available
            if (b.jaw) {
              b.jaw.rotation.x = this.vowelValues.aa * 0.12;
            }

            // Warm pleasant host smile while talking
            this.setExpressionSafe('happy', 0.22 + vol * 0.16);
          } else {
            // Smooth natural decay when silent
            this.vowelValues.aa *= 0.75;
            this.vowelValues.oh *= 0.75;
            this.vowelValues.ih *= 0.75;
            this.vowelValues.ee *= 0.75;
            this.vowelValues.ou *= 0.75;

            this.setVowelSafe('aa', this.vowelValues.aa);
            this.setVowelSafe('oh', this.vowelValues.oh);
            this.setVowelSafe('ih', this.vowelValues.ih);
            this.setVowelSafe('ee', this.vowelValues.ee);
            this.setVowelSafe('ou', this.vowelValues.ou);

            if (b.jaw) b.jaw.rotation.x *= 0.75;
            this.setExpressionSafe('happy', 0.08);
          }
        }
      }

      // =======================================================================
      // D. ACTIVE SPRING BONE WIND PHYSICS (HAIR, RIBBONS, SKIRT FLUTTERING)
      // =======================================================================
      if (this.springJoints.length > 0) {
        // Multi-frequency ambient wind + body movement inertia
        const windX = Math.sin(elapsedTime * 1.5) * 0.22 + Math.cos(elapsedTime * 2.8) * 0.10 + rootVelocityX * 0.65;
        const windY = -1.0 + Math.sin(elapsedTime * 2.1) * 0.06;
        const windZ = Math.sin(elapsedTime * 1.2 + 0.4) * 0.18 + rootVelocityZ * 0.65;
        const windDir = new THREE.Vector3(windX, windY, windZ).normalize();

        for (const joint of this.springJoints) {
          if (joint.settings?.gravityDir) {
            joint.settings.gravityDir.copy(windDir);
          }
        }
      }

      // Propagate bone updates and spring bone physics
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
