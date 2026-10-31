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
    this.morphMeshes = [];
    this.audioVolumeGetter = () => 0;

    // Head / Eye tracking target
    this.targetMouse = new THREE.Vector2(0, 0);
    this.currentMouse = new THREE.Vector2(0, 0);

    // Blinking
    this.blinkTimer = 0;
    this.blinkDuration = 0.15;
    this.nextBlinkTime = 3.0;

    // Loading callback
    this.onLoadingChange = () => {};

    this.initScene();
  }

  setLoadingCallback(cb) {
    this.onLoadingChange = cb;
  }

  initScene() {
    // 1. Scene
    this.scene = new THREE.Scene();

    // 2. Camera (Portrait bust framing)
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 600;
    this.camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 100);
    this.camera.position.set(0, 1.45, 1.25);
    this.camera.lookAt(0, 1.38, 0);

    // 3. WebGL Renderer with High Quality Color Management
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.container.appendChild(this.renderer.domElement);

    // 4. Dramatic Cinematic Studio Lighting (Matching the crimson & soft studio aesthetic)
    this.setupLighting();

    // 5. Procedural Studio Backdrop Particles
    this.setupFloatingParticles();

    // 6. Interactive Parallax (Mouse & Touch tracking)
    this.setupInteractionListeners();

    // 7. Handle Window Resize
    window.addEventListener('resize', () => this.onWindowResize());

    // 8. Render loop
    this.animate();
  }

  setupLighting() {
    // Ambient fill
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    this.scene.add(ambientLight);

    // Key Light (Warm soft frontal studio light)
    const keyLight = new THREE.DirectionalLight(0xfff3e0, 2.2);
    keyLight.position.set(0.8, 2.2, 1.8);
    this.scene.add(keyLight);

    // Fill Light (Cool soft blue-tinted)
    const fillLight = new THREE.DirectionalLight(0xe0f2fe, 1.0);
    fillLight.position.set(-1.2, 1.5, 1.2);
    this.scene.add(fillLight);

    // Dramatic Crimson / Rose Rim Light (Backlight for hair and silhouette)
    const rimLight = new THREE.DirectionalLight(0xe11d48, 3.5);
    rimLight.position.set(-1.0, 1.8, -1.5);
    this.scene.add(rimLight);

    // Gold Secondary Rim
    const goldRim = new THREE.DirectionalLight(0xfbbf24, 1.8);
    goldRim.position.set(1.2, 1.0, -1.2);
    this.scene.add(goldRim);
  }

  setupFloatingParticles() {
    const particleCount = 120;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i += 3) {
      pos[i] = (Math.random() - 0.5) * 3.0;
      pos[i + 1] = Math.random() * 2.5 + 0.5;
      pos[i + 2] = (Math.random() - 0.5) * 2.5;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xf43f5e,
      size: 0.02,
      transparent: true,
      opacity: 0.45,
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
    window.addEventListener('touchmove', (e) => {
      if (e.touches.length > 0) {
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });
  }

  setAudioVolumeGetter(getter) {
    this.audioVolumeGetter = getter;
  }

  /**
   * Load any 3D model (VRM, GLB, GLTF)
   */
  async loadModel(fileOrUrl, modelName = '3D Avatar') {
    this.onLoadingChange(true, `Memuat ${modelName}...`);

    let url;
    if (typeof fileOrUrl === 'string') {
      url = fileOrUrl;
    } else {
      url = URL.createObjectURL(fileOrUrl);
    }

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    return new Promise((resolve, reject) => {
      loader.load(
        url,
        (gltf) => {
          // Dispose previous models
          this.clearCurrentModel();

          const vrm = gltf.userData.vrm;
          if (vrm) {
            // === 1. VRM MODEL ===
            this.currentVrm = vrm;
            this.currentModel = vrm.scene;
            VRMUtils.rotateVRM0(vrm);
            this.scene.add(vrm.scene);

            // Focus on face
            const headNode = vrm.humanoid?.getNormalizedBoneNode('head');
            if (headNode) {
              const headPos = new THREE.Vector3();
              headNode.getWorldPosition(headPos);
              this.camera.position.set(0, headPos.y - 0.05, 1.05);
              this.camera.lookAt(0, headPos.y - 0.05, 0);
            } else {
              this.camera.position.set(0, 1.35, 1.25);
              this.camera.lookAt(0, 1.30, 0);
            }
          } else {
            // === 2. GLB / GLTF MODEL ===
            const modelScene = gltf.scene;
            this.currentModel = modelScene;

            // Auto-scale and center the character
            const box = new THREE.Box3().setFromObject(modelScene);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());

            const maxDim = Math.max(size.x, size.y, size.z);
            const scale = 1.65 / (maxDim || 1);
            modelScene.scale.set(scale, scale, scale);

            modelScene.position.x = -center.x * scale;
            modelScene.position.y = -box.min.y * scale;
            modelScene.position.z = -center.z * scale;

            this.scene.add(modelScene);

            // Frame camera on bust & face
            const isMobile = window.innerWidth < 768;
            const camZ = isMobile ? 1.45 : 1.15;
            this.camera.position.set(0, 1.32, camZ);
            this.camera.lookAt(0, 1.25, 0);

            // Collect morph target meshes for audio lip-sync
            this.morphMeshes = [];
            modelScene.traverse((child) => {
              if (child.isMesh && child.morphTargetInfluences && child.morphTargetInfluences.length > 0) {
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
    this.morphMeshes = [];
  }

  onWindowResize() {
    if (!this.container || !this.renderer || !this.camera) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);

    // Adjust camera distance for mobile portrait aspect
    const isMobile = width < 768;
    this.camera.position.z = isMobile ? 1.45 : 1.15;
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const delta = this.clock.getDelta();
    const elapsedTime = this.clock.getElapsedTime();
    const volume = this.audioVolumeGetter() || 0; // 0.0 - 1.0

    // Smooth mouse parallax interpolation
    this.currentMouse.x += (this.targetMouse.x - this.currentMouse.x) * 0.05;
    this.currentMouse.y += (this.targetMouse.y - this.currentMouse.y) * 0.05;

    // Float particles
    if (this.particles) {
      this.particles.rotation.y = elapsedTime * 0.03;
    }

    // === 1. ANIMATE VRM MODEL ===
    if (this.currentVrm) {
      // Natural idle breathing
      const spine = this.currentVrm.humanoid?.getNormalizedBoneNode('spine');
      if (spine) {
        spine.rotation.x = Math.sin(elapsedTime * 1.5) * 0.02;
        spine.rotation.y = this.currentMouse.x * 0.08;
      }

      // Head movement & subtle tracking towards user
      const head = this.currentVrm.humanoid?.getNormalizedBoneNode('head');
      if (head) {
        head.rotation.y = this.currentMouse.x * 0.18 + Math.sin(elapsedTime * 0.8) * 0.03;
        head.rotation.x = -this.currentMouse.y * 0.12 + Math.sin(elapsedTime * 7.0) * 0.04 * volume;
      }

      // Blinking
      this.blinkTimer += delta;
      if (this.blinkTimer >= this.nextBlinkTime) {
        this.currentVrm.expressionManager?.setValue('blink', 1.0);
        if (this.blinkTimer >= this.nextBlinkTime + this.blinkDuration) {
          this.currentVrm.expressionManager?.setValue('blink', 0.0);
          this.blinkTimer = 0;
          this.nextBlinkTime = 2.5 + Math.random() * 3.5;
        }
      }

      // Real-Time Lip-Sync
      if (this.currentVrm.expressionManager) {
        const mouthOpen = Math.min(1.0, volume * 1.5);
        this.currentVrm.expressionManager.setValue('aa', mouthOpen);
        this.currentVrm.expressionManager.setValue('ih', mouthOpen * 0.4);
        this.currentVrm.expressionManager.setValue('ou', mouthOpen * 0.3);
      }

      this.currentVrm.update(delta);
    }

    // === 2. ANIMATE STANDARD GLB MODEL ===
    else if (this.currentModel) {
      // Natural idle breathing & sway
      this.currentModel.rotation.y = this.currentMouse.x * 0.15 + Math.sin(elapsedTime * 0.8) * 0.04;
      this.currentModel.rotation.x = -this.currentMouse.y * 0.08;
      
      // Subtle rhythmic chest bobbing
      this.currentModel.position.y += (Math.sin(elapsedTime * 1.8) * 0.0005) + (volume * 0.003);

      // Morph targets (if model has shape keys)
      if (this.morphMeshes && this.morphMeshes.length > 0) {
        const mouthOpen = Math.min(1.0, volume * 1.5);
        this.morphMeshes.forEach((mesh) => {
          if (mesh.morphTargetInfluences && mesh.morphTargetInfluences.length > 0) {
            mesh.morphTargetInfluences[0] = mouthOpen;
          }
        });
      }
    }

    this.renderer.render(this.scene, this.camera);
  }
}
