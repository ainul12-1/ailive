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
    this.morphMeshes = [];
    this.audioVolumeGetter = () => 0;

    // Smoothed volume & speech articulation state
    this.smoothedVolume = 0;
    this.isTalking = false;
    this.talkGesturePhase = 0;

    // Head / Eye tracking target
    this.targetMouse = new THREE.Vector2(0, 0);
    this.currentMouse = new THREE.Vector2(0, 0);

    // Natural Eye Blinking system (non-linear smooth eyelid animation)
    this.blinkTimer = 0;
    this.blinkDuration = 0.18;
    this.nextBlinkTime = 2.8;
    this.isBlinking = false;

    // Micro-head saccades (subtle subconscious human eye/head shifts)
    this.saccadeTimer = 0;
    this.saccadeTarget = new THREE.Vector2(0, 0);
    this.saccadeCurrent = new THREE.Vector2(0, 0);

    // Base position for GLB model
    this.basePosY = 0;
    this._currentObjectUrl = null;

    // Loading callback
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
    const baseFov = 30;
    const fov = aspect < 0.75 ? baseFov + (0.75 - aspect) * 28 : baseFov;

    this.camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 100);
    this.camera.position.set(0, 1.25, 1.45);
    this.camera.lookAt(0, 1.15, 0);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.container.appendChild(this.renderer.domElement);

    this.setupLighting();
    this.setupFloatingParticles();
    this.setupInteractionListeners();

    window.addEventListener('resize', () => this.onWindowResize());
    this.animate();
  }

  setupLighting() {
    // Ambient light with soft warm fill
    const ambientLight = new THREE.AmbientLight(0xfff6ed, 1.1);
    this.scene.add(ambientLight);

    // Key Light (Main soft portrait studio light)
    const keyLight = new THREE.DirectionalLight(0xffeedb, 2.4);
    keyLight.position.set(0.7, 2.0, 1.6);
    this.scene.add(keyLight);

    // Fill Light (Cool complementary soft sky fill)
    const fillLight = new THREE.DirectionalLight(0xdbeafe, 1.1);
    fillLight.position.set(-1.0, 1.4, 1.2);
    this.scene.add(fillLight);

    // Dramatic Crimson / Rose Rim Light (Streamer hair & silhouette glow)
    const rimLight = new THREE.DirectionalLight(0xe11d48, 3.2);
    rimLight.position.set(-1.1, 1.7, -1.4);
    this.scene.add(rimLight);

    // Gold Secondary Rim Light
    const goldRim = new THREE.DirectionalLight(0xfbbf24, 1.6);
    goldRim.position.set(1.1, 1.1, -1.2);
    this.scene.add(goldRim);
  }

  setupFloatingParticles() {
    const particleCount = 90;
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
      size: 0.022,
      transparent: true,
      opacity: 0.4,
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
   * Load any 3D model (VRM, GLB, GLTF)
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
            // === 1. VRM MODEL (HUMANOID AVATAR) ===
            this.currentVrm = vrm;
            this.currentModel = vrm.scene;
            VRMUtils.rotateVRM0(vrm);
            this.scene.add(vrm.scene);

            // Cache humanoid skeleton bones for natural procedural animation
            this.cacheVrmBones(vrm);

            // Frame camera to comfortably show head, chest, and gesturing hands
            const headNode = this.vrmBones.head;
            if (headNode) {
              const headPos = new THREE.Vector3();
              headNode.getWorldPosition(headPos);
              const isMobile = window.innerWidth < 768;
              const camZ = isMobile ? 1.45 : 1.25;
              this.camera.position.set(0, headPos.y - 0.08, camZ);
              this.camera.lookAt(0, headPos.y - 0.16, 0);
            } else {
              this.camera.position.set(0, 1.25, 1.35);
              this.camera.lookAt(0, 1.15, 0);
            }
          } else {
            // === 2. GLB / GLTF MODEL ===
            const modelScene = gltf.scene;
            this.currentModel = modelScene;

            const box = new THREE.Box3().setFromObject(modelScene);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());

            const maxDim = Math.max(size.x, size.y, size.z);
            const scale = 1.65 / (maxDim || 1);
            modelScene.scale.set(scale, scale, scale);

            modelScene.position.x = -center.x * scale;
            modelScene.position.z = -center.z * scale;
            this.basePosY = -box.min.y * scale;
            modelScene.position.y = this.basePosY;

            this.scene.add(modelScene);

            const isMobile = this.container.clientWidth < 768;
            const camZ = isMobile ? 1.45 : 1.2;
            this.camera.position.set(0, 1.32, camZ);
            this.camera.lookAt(0, 1.22, 0);

            this.morphMeshes = [];
            modelScene.traverse((child) => {
              if (
                child.isMesh &&
                child.morphTargetInfluences &&
                child.morphTargetInfluences.length > 0
              ) {
                this.morphMeshes.push(child);
              }
            });
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
      this.currentModel.traverse((child) => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            for (const mat of materials) {
              for (const key of Object.keys(mat)) {
                const val = mat[key];
                if (val && val.isTexture) val.dispose();
              }
              mat.dispose();
            }
          }
        }
      });
      this.currentModel = null;
    }
    this.vrmBones = {};
    this.morphMeshes = [];
    this.basePosY = 0;
  }

  onWindowResize() {
    if (!this.container || !this.renderer || !this.camera) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const aspect = width / height;

    this.camera.aspect = aspect;
    const baseFov = 30;
    this.camera.fov = aspect < 0.75 ? baseFov + (0.75 - aspect) * 28 : baseFov;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const delta = this.clock.getDelta();
    const elapsedTime = this.clock.getElapsedTime();

    // 1. Audio volume smoothing with exponential attack & decay
    const rawVolume = this.audioVolumeGetter() || 0;
    if (rawVolume > this.smoothedVolume) {
      this.smoothedVolume += (rawVolume - this.smoothedVolume) * 0.45; // Fast attack
    } else {
      this.smoothedVolume += (rawVolume - this.smoothedVolume) * 0.18; // Smooth decay
    }
    const vol = this.smoothedVolume;
    this.isTalking = vol > 0.05;

    // Track speech gesture timing
    if (this.isTalking) {
      this.talkGesturePhase += delta * (3.0 + vol * 4.0);
    }

    // 2. Smooth mouse parallax
    this.currentMouse.x += (this.targetMouse.x - this.currentMouse.x) * 0.05;
    this.currentMouse.y += (this.targetMouse.y - this.currentMouse.y) * 0.05;

    // 3. Subconscious Micro Saccades (subtle eye/head shifts like living humans)
    this.saccadeTimer += delta;
    if (this.saccadeTimer > 2.2 + Math.random() * 2.5) {
      this.saccadeTarget.x = (Math.random() - 0.5) * 0.06;
      this.saccadeTarget.y = (Math.random() - 0.5) * 0.04;
      this.saccadeTimer = 0;
    }
    this.saccadeCurrent.lerp(this.saccadeTarget, 0.08);

    // 4. Subtle background particle float
    if (this.particles) {
      this.particles.rotation.y = elapsedTime * 0.025;
    }

    // =====================================================================
    // 🎭 VRM AVATAR: ADVANCED PROCEDURAL LIVING HUMAN MOTION ENGINE
    // =====================================================================
    if (this.currentVrm) {
      const b = this.vrmBones;
      const exp = this.currentVrm.expressionManager;

      // --- A. Living Idle Breath & Spine Sway ---
      const breathPhase = elapsedTime * 1.5;
      const breathSine = Math.sin(breathPhase);
      const breathCos = Math.cos(breathPhase * 0.5);

      // Spine & Chest natural respiration
      if (b.spine) {
        b.spine.rotation.x = breathSine * 0.018;
        b.spine.rotation.y = this.currentMouse.x * 0.06 + breathCos * 0.015;
        b.spine.rotation.z = -this.currentMouse.x * 0.02;
      }
      if (b.chest) {
        b.chest.rotation.x = breathSine * 0.025 + (this.isTalking ? Math.sin(this.talkGesturePhase * 0.8) * 0.015 : 0);
        b.chest.rotation.y = this.currentMouse.x * 0.08;
      }

      // --- B. Neck & Head Natural Looking + Conversational Gestures ---
      if (b.neck) {
        b.neck.rotation.y = this.currentMouse.x * 0.12 + this.saccadeCurrent.x;
        b.neck.rotation.x = -this.currentMouse.y * 0.08 + this.saccadeCurrent.y;
      }

      if (b.head) {
        // Conversational head nods and tilts when talking
        const talkNod = this.isTalking ? Math.sin(this.talkGesturePhase * 1.8) * 0.06 * vol : 0;
        const talkTilt = this.isTalking ? Math.cos(this.talkGesturePhase * 0.9) * 0.04 * vol : 0;

        b.head.rotation.y = this.currentMouse.x * 0.22 + Math.sin(elapsedTime * 0.6) * 0.025 + this.saccadeCurrent.x * 1.5;
        b.head.rotation.x = -this.currentMouse.y * 0.15 + talkNod + breathSine * 0.01;
        b.head.rotation.z = -this.currentMouse.x * 0.05 + talkTilt;
      }

      // --- C. Shoulders Living Breathing & Natural Host Relaxed Pose ---
      if (b.leftShoulder) {
        b.leftShoulder.rotation.z = -0.06 + breathSine * 0.015 + (this.isTalking ? vol * 0.03 : 0);
      }
      if (b.rightShoulder) {
        b.rightShoulder.rotation.z = 0.06 - breathSine * 0.015 - (this.isTalking ? vol * 0.03 : 0);
      }

      // --- D. Natural Arms & Hands Conversational Gestures ---
      // In VRM normalized bones, rest pose is T-Pose.
      // Base resting pose: Bring arms naturally down to the torso (streamer desk pose)
      const baseArmDown = 1.25; // ~72 degrees down
      const baseArmForward = 0.22; // slightly forward toward desk
      const baseElbowBend = 0.45; // elbow comfortably bent inward

      // Talking gesture dynamics (expressive hand motions while speaking)
      const gPhase = this.talkGesturePhase;
      const rightGestureX = this.isTalking ? Math.sin(gPhase * 1.1) * 0.18 * vol : 0;
      const rightGestureY = this.isTalking ? Math.cos(gPhase * 0.8) * 0.14 * vol : 0;
      const rightGestureZ = this.isTalking ? Math.sin(gPhase * 1.4) * 0.12 * vol : 0;

      const leftGestureX = this.isTalking ? Math.cos(gPhase * 0.9 + 1.2) * 0.12 * vol : 0;
      const leftGestureZ = this.isTalking ? Math.sin(gPhase * 0.7 + 0.5) * 0.08 * vol : 0;

      // Left Arm (Relaxed supportive arm)
      if (b.leftUpperArm) {
        b.leftUpperArm.rotation.z = -baseArmDown + breathSine * 0.015 + leftGestureZ;
        b.leftUpperArm.rotation.x = baseArmForward + leftGestureX;
        b.leftUpperArm.rotation.y = 0.15;
      }
      if (b.leftLowerArm) {
        b.leftLowerArm.rotation.y = -baseElbowBend + breathCos * 0.02;
        b.leftLowerArm.rotation.z = -0.15;
      }
      if (b.leftHand) {
        b.leftHand.rotation.x = 0.12;
        b.leftHand.rotation.z = 0.08;
      }

      // Right Arm (Dominant conversational gesturing arm)
      if (b.rightUpperArm) {
        b.rightUpperArm.rotation.z = baseArmDown - breathSine * 0.015 - (this.isTalking ? 0.15 * vol : 0) - rightGestureZ;
        b.rightUpperArm.rotation.x = baseArmForward + (this.isTalking ? 0.25 * vol : 0) + rightGestureX;
        b.rightUpperArm.rotation.y = -0.18 + rightGestureY;
      }
      if (b.rightLowerArm) {
        // Forearm lifts and gestures to emphasize points when speaking
        const speakElbowLift = this.isTalking ? (0.35 + Math.sin(gPhase * 1.3) * 0.2) * vol : 0;
        b.rightLowerArm.rotation.y = baseElbowBend + speakElbowLift;
        b.rightLowerArm.rotation.z = 0.18 + (this.isTalking ? Math.cos(gPhase) * 0.1 * vol : 0);
      }
      if (b.rightHand) {
        // Natural wrist movement following gestures
        b.rightHand.rotation.x = 0.15 + (this.isTalking ? Math.sin(gPhase * 1.8) * 0.15 * vol : 0);
        b.rightHand.rotation.y = (this.isTalking ? Math.cos(gPhase * 1.2) * 0.12 * vol : 0);
        b.rightHand.rotation.z = -0.1;
      }

      // --- E. Realistic Human Blinking (Smooth Non-Linear Curve) ---
      this.blinkTimer += delta;
      if (this.blinkTimer >= this.nextBlinkTime) {
        this.isBlinking = true;
        const blinkProgress = (this.blinkTimer - this.nextBlinkTime) / this.blinkDuration;
        if (blinkProgress <= 1.0) {
          // Sinusoidal blink envelope [0.0 -> 1.0 -> 0.0]
          const blinkWeight = Math.sin(blinkProgress * Math.PI);
          exp?.setValue('blink', blinkWeight);
        } else {
          exp?.setValue('blink', 0.0);
          this.isBlinking = false;
          this.blinkTimer = 0;
          // Random natural interval: 2.5 to 5.5 seconds, with 25% chance of realistic double-blink
          const isDoubleBlink = Math.random() < 0.25;
          this.nextBlinkTime = isDoubleBlink ? 0.35 : 2.5 + Math.random() * 3.2;
        }
      }

      // --- F. Real-time Multi-Vowel Dynamic Lip-Sync & Facial Expressions ---
      if (exp) {
        if (this.isTalking) {
          // Conversational multi-vowel articulation cycling with audio cadence
          const vowelCycle = elapsedTime * 14.0;
          const openA = Math.max(0, Math.sin(vowelCycle)) * vol * 1.6;
          const openO = Math.max(0, Math.sin(vowelCycle + 1.2)) * vol * 1.2;
          const openI = Math.max(0, Math.cos(vowelCycle * 0.8)) * vol * 0.9;
          const openU = Math.max(0, Math.sin(vowelCycle * 1.5 + 2.0)) * vol * 0.8;
          const openE = Math.max(0, Math.cos(vowelCycle * 1.2)) * vol * 0.7;

          exp.setValue('aa', Math.min(1.0, openA));
          exp.setValue('oh', Math.min(1.0, openO));
          exp.setValue('ih', Math.min(1.0, openI));
          exp.setValue('ou', Math.min(1.0, openU));
          exp.setValue('ee', Math.min(1.0, openE));

          // Friendly conversational smile while talking
          exp.setValue('happy', 0.25 + vol * 0.15);
        } else {
          // Smooth mouth closing decay
          exp.setValue('aa', THREE.MathUtils.lerp(exp.getValue('aa') || 0, 0, 0.25));
          exp.setValue('oh', THREE.MathUtils.lerp(exp.getValue('oh') || 0, 0, 0.25));
          exp.setValue('ih', THREE.MathUtils.lerp(exp.getValue('ih') || 0, 0, 0.25));
          exp.setValue('ou', THREE.MathUtils.lerp(exp.getValue('ou') || 0, 0, 0.25));
          exp.setValue('ee', THREE.MathUtils.lerp(exp.getValue('ee') || 0, 0, 0.25));

          // Gentle pleasant resting host expression
          exp.setValue('happy', THREE.MathUtils.lerp(exp.getValue('happy') || 0, 0.12, 0.1));
        }
      }

      this.currentVrm.update(delta);
    }

    // =====================================================================
    // 🗿 STANDARD GLB FALLBACK ANIMATION
    // =====================================================================
    else if (this.currentModel) {
      this.currentModel.rotation.y = this.currentMouse.x * 0.15 + Math.sin(elapsedTime * 0.8) * 0.04;
      this.currentModel.rotation.x = -this.currentMouse.y * 0.08;

      const breathOffset = Math.sin(elapsedTime * 1.8) * 0.005;
      const speakBounce = vol * 0.015;
      this.currentModel.position.y = this.basePosY + breathOffset + speakBounce;

      if (this.morphMeshes && this.morphMeshes.length > 0) {
        const mouthOpen = Math.min(1.0, vol * 1.5);
        this.morphMeshes.forEach((mesh) => {
          if (mesh.morphTargetInfluences && mesh.morphTargetInfluences.length > 0) {
            mesh.morphTargetInfluences[0] = mouthOpen;
          }
        });
      }
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
