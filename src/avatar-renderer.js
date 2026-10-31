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

    this.camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 100);
    this.camera.position.set(0, 1.25, 1.35);
    this.camera.lookAt(0, 1.18, 0);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(width, height);
    // Super enteng: cap DPR at 1.5 on mobile to guarantee smooth 60/120fps without overheating
    const isMobile = width < 768;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // Neutral tone exposure prevents face wash-out / overexposure
    this.renderer.toneMappingExposure = 0.96;
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
    // 1. Ambient Light - Soft, warm, non-blinding fill
    const ambientLight = new THREE.AmbientLight(0xfff6f0, 0.65);
    this.scene.add(ambientLight);

    // 2. Key Portrait Light - Crisp warm light angled to cast natural soft shadow under nose tip
    const keyLight = new THREE.DirectionalLight(0xffeedb, 1.45);
    keyLight.position.set(0.5, 1.85, 1.4);
    this.scene.add(keyLight);

    // 3. Cool Fill Light - Soft complementary fill from left to balance facial shadows
    const fillLight = new THREE.DirectionalLight(0xdce7f5, 0.60);
    fillLight.position.set(-0.8, 1.35, 1.2);
    this.scene.add(fillLight);

    // 4. Low Chin & Lip Contour Light - Subtle bounce emphasizing lower lip and jawline
    const chinLight = new THREE.DirectionalLight(0xffded0, 0.35);
    chinLight.position.set(0, 0.6, 1.1);
    this.scene.add(chinLight);

    // 5. Stylistic Crimson Rim Light - Hair strands & streamer silhouette glow
    const rimLight = new THREE.DirectionalLight(0xe11d48, 1.9);
    rimLight.position.set(-1.1, 1.6, -1.3);
    this.scene.add(rimLight);

    // 6. Warm Gold Secondary Rim Light
    const goldRim = new THREE.DirectionalLight(0xfbbf24, 1.1);
    goldRim.position.set(1.1, 1.1, -1.0);
    this.scene.add(goldRim);
  }

  setupFloatingParticles() {
    const particleCount = 75;
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
      size: 0.020,
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
        if (e.touches.length > 0) {
          handleMove(e.touches[0].clientX, e.touches[0].clientY);
        }
      },
      { passive: true }
    );
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
   * Trigger emotional reaction (gift received, cheerful greeting, thanks)
   */
  triggerReaction(type = 'thanks') {
    this.activeReaction = type;
    this.reactionProgress = 0;
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

            // Frame camera at eye-level portrait with warm framing
            const headNode = this.vrmBones.head;
            if (headNode) {
              const headPos = new THREE.Vector3();
              headNode.getWorldPosition(headPos);
              const isMobile = window.innerWidth < 768;
              const camZ = isMobile ? 1.35 : 1.15;
              this.camera.position.set(0, headPos.y - 0.04, camZ);
              this.camera.lookAt(0, headPos.y - 0.08, 0);
            } else {
              this.camera.position.set(0, 1.25, 1.25);
              this.camera.lookAt(0, 1.18, 0);
            }
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
      const baseArmDown = 1.25; // ~72 degrees down (relaxed streamer desk pose)
      const baseArmForward = 0.22;
      const baseElbowBend = 0.45;
      const gPhase = this.talkGesturePhase;

      // Evaluate active spontaneous reaction (e.g. Gift / Gratitude / Wave)
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
        // --- REACTION POSE: Hand-to-Heart Gratitude / Appreciative Host Pose ---
        // Right hand moves to heart / chest, head bows slightly in gratitude
        if (b.rightUpperArm) {
          b.rightUpperArm.rotation.z = baseArmDown - 0.45 * rWeight;
          b.rightUpperArm.rotation.x = baseArmForward + 0.45 * rWeight;
          b.rightUpperArm.rotation.y = -0.35 * rWeight;
        }
        if (b.rightLowerArm) {
          b.rightLowerArm.rotation.y = baseElbowBend + 0.95 * rWeight;
          b.rightLowerArm.rotation.z = 0.35 * rWeight;
        }
        if (b.rightHand) {
          b.rightHand.rotation.x = 0.35 * rWeight;
          b.rightHand.rotation.y = 0.25 * rWeight;
        }

        // Left arm warm supporting pose
        if (b.leftUpperArm) {
          b.leftUpperArm.rotation.z = -baseArmDown + 0.25 * rWeight;
          b.leftUpperArm.rotation.x = baseArmForward + 0.20 * rWeight;
        }
        if (b.leftLowerArm) {
          b.leftLowerArm.rotation.y = -baseElbowBend - 0.35 * rWeight;
        }

        // Appreciative bow
        if (b.head) {
          b.head.rotation.x += 0.12 * rWeight;
        }
      } else {
        // --- NORMAL MULTI-STYLE CONVERSATIONAL GESTURES ---
        let rGestureX = 0, rGestureY = 0, rGestureZ = 0, rElbowLift = 0;
        let lGestureX = 0, lGestureY = 0, lGestureZ = 0, lElbowLift = 0;

        if (this.isTalking) {
          if (this.gestureStyle === 0) {
            // Style 0: Dominant Right Hand Explaining
            rGestureX = (0.28 + Math.sin(gPhase * 1.1) * 0.22) * vol;
            rGestureY = Math.cos(gPhase * 0.8) * 0.18 * vol;
            rGestureZ = Math.sin(gPhase * 1.4) * 0.15 * vol;
            rElbowLift = (0.55 + Math.sin(gPhase * 1.3) * 0.25) * vol;

            lGestureX = Math.cos(gPhase * 0.8 + 1.2) * 0.10 * vol;
          } else if (this.gestureStyle === 1) {
            // Style 1: Two-Hand Warm Storytelling Emphasis
            rGestureX = (0.22 + Math.sin(gPhase * 1.2) * 0.16) * vol;
            rElbowLift = (0.42 + Math.sin(gPhase * 1.2) * 0.20) * vol;

            lGestureX = (0.20 + Math.cos(gPhase * 1.2) * 0.16) * vol;
            lElbowLift = (0.38 + Math.cos(gPhase * 1.2) * 0.20) * vol;
          } else if (this.gestureStyle === 2) {
            // Style 2: Left Hand Active Gesturing
            lGestureX = (0.28 + Math.cos(gPhase * 1.1) * 0.22) * vol;
            lElbowLift = (0.50 + Math.cos(gPhase * 1.3) * 0.25) * vol;

            rGestureX = Math.sin(gPhase * 0.8) * 0.10 * vol;
          } else {
            // Style 3: Thoughtful / Gentle Listen & Talk
            rGestureX = (0.15 + Math.sin(gPhase * 0.9) * 0.10) * vol;
            rElbowLift = (0.30 + Math.sin(gPhase * 0.9) * 0.15) * vol;
          }
        }

        // Left Arm application
        if (b.leftUpperArm) {
          b.leftUpperArm.rotation.z = -baseArmDown + breathSine * 0.015 + lGestureZ;
          b.leftUpperArm.rotation.x = baseArmForward + lGestureX;
          b.leftUpperArm.rotation.y = 0.15 + lGestureY;
        }
        if (b.leftLowerArm) {
          b.leftLowerArm.rotation.y = -baseElbowBend - lElbowLift + breathSine * 0.02;
          b.leftLowerArm.rotation.z = -0.15;
        }
        if (b.leftHand) {
          b.leftHand.rotation.x = 0.12 + (this.isTalking ? Math.cos(gPhase * 1.6) * 0.15 * vol : 0);
          b.leftHand.rotation.z = 0.08;
        }

        // Right Arm application
        if (b.rightUpperArm) {
          b.rightUpperArm.rotation.z = baseArmDown - breathSine * 0.015 - (this.isTalking ? 0.24 * vol : 0) - rGestureZ;
          b.rightUpperArm.rotation.x = baseArmForward + (this.isTalking ? 0.30 * vol : 0) + rGestureX;
          b.rightUpperArm.rotation.y = -0.18 + rGestureY;
        }
        if (b.rightLowerArm) {
          b.rightLowerArm.rotation.y = baseElbowBend + rElbowLift;
          b.rightLowerArm.rotation.z = 0.18 + (this.isTalking ? Math.cos(gPhase) * 0.15 * vol : 0);
        }
        if (b.rightHand) {
          b.rightHand.rotation.x = 0.20 + (this.isTalking ? Math.sin(gPhase * 2.0) * 0.25 * vol : 0);
          b.rightHand.rotation.y = (this.isTalking ? Math.cos(gPhase * 1.5) * 0.20 * vol : 0);
          b.rightHand.rotation.z = -0.10;
        }
      }

      // --- E. Realistic Non-Linear Eyelid Blinking ---
      this.blinkTimer += delta;
      if (this.blinkTimer >= this.nextBlinkTime) {
        this.isBlinking = true;
        const blinkProgress = (this.blinkTimer - this.nextBlinkTime) / this.blinkDuration;
        if (blinkProgress <= 1.0) {
          const blinkWeight = Math.sin(blinkProgress * Math.PI);
          exp?.setValue('blink', blinkWeight);
        } else {
          exp?.setValue('blink', 0.0);
          this.isBlinking = false;
          this.blinkTimer = 0;
          // Random natural interval: 2.5 to 5.5s with 25% chance of realistic double-blink
          const isDoubleBlink = Math.random() < 0.25;
          this.nextBlinkTime = isDoubleBlink ? 0.35 : 2.5 + Math.random() * 3.2;
        }
      }

      // --- F. Real-time Multi-Vowel Dynamic Lip-Sync & Facial Expressions ---
      if (exp) {
        if (isReacting) {
          // Radiant gratitude smile during gift/greeting reaction
          exp.setValue('happy', 0.85 * rWeight);
          exp.setValue('surprised', 0.20 * rWeight);
        } else if (this.isTalking) {
          // Conversational multi-vowel articulation cycling with audio cadence
          const vowelCycle = elapsedTime * 14.5;
          const openA = Math.max(0, Math.sin(vowelCycle)) * vol * 2.2;
          const openO = Math.max(0, Math.sin(vowelCycle + 1.2)) * vol * 1.8;
          const openI = Math.max(0, Math.cos(vowelCycle * 0.8)) * vol * 1.3;
          const openU = Math.max(0, Math.sin(vowelCycle * 1.5 + 2.0)) * vol * 1.1;
          const openE = Math.max(0, Math.cos(vowelCycle * 1.2)) * vol * 1.1;

          exp.setValue('aa', Math.min(1.0, openA));
          exp.setValue('oh', Math.min(1.0, openO));
          exp.setValue('ih', Math.min(1.0, openI));
          exp.setValue('ou', Math.min(1.0, openU));
          exp.setValue('ee', Math.min(1.0, openE));

          // Friendly conversational smile while talking
          exp.setValue('happy', 0.25 + vol * 0.15);
        } else {
          // Smooth decay when silent
          exp.setValue('aa', THREE.MathUtils.lerp(exp.getValue('aa') || 0, 0, 0.25));
          exp.setValue('oh', THREE.MathUtils.lerp(exp.getValue('oh') || 0, 0, 0.25));
          exp.setValue('ih', THREE.MathUtils.lerp(exp.getValue('ih') || 0, 0, 0.25));
          exp.setValue('ou', THREE.MathUtils.lerp(exp.getValue('ou') || 0, 0, 0.25));
          exp.setValue('ee', THREE.MathUtils.lerp(exp.getValue('ee') || 0, 0, 0.25));

          // Gentle pleasant resting host expression
          exp.setValue('happy', THREE.MathUtils.lerp(exp.getValue('happy') || 0, 0.12, 0.1));
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
