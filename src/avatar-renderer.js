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
    this.currentVrm = null;
    this.cyberCoreGroup = null;
    this.particles = null;
    this.audioVolumeGetter = () => 0;

    // VRM Animation state
    this.blinkTimer = 0;
    this.blinkDuration = 0.15;
    this.nextBlinkTime = 3.0;

    this.initScene();
  }

  initScene() {
    // 1. Scene
    this.scene = new THREE.Scene();

    // 2. Camera
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 600;
    this.camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
    this.camera.position.set(0, 1.35, 1.5);

    // 3. Renderer with transparent background support for OBS
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);

    // 4. Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(1.0, 2.0, 1.5).normalize();
    this.scene.add(dirLight);

    const rimLight = new THREE.DirectionalLight(0x00f0ff, 1.5);
    rimLight.position.set(-1.5, 1.0, -1.0).normalize();
    this.scene.add(rimLight);

    const magentaLight = new THREE.DirectionalLight(0xff007f, 1.2);
    magentaLight.position.set(1.5, -0.5, 0.5).normalize();
    this.scene.add(magentaLight);

    // 5. Default Procedural Cyber Avatar
    this.createDefaultCyberAvatar();

    // 6. Handle Resize
    window.addEventListener('resize', () => this.onWindowResize());

    // 7. Start render loop
    this.animate();
  }

  createDefaultCyberAvatar() {
    this.cyberCoreGroup = new THREE.Group();
    this.cyberCoreGroup.position.set(0, 1.2, 0);

    // Central Glowing Holographic Sphere
    const coreGeo = new THREE.IcosahedronGeometry(0.35, 4);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x00ffff,
      emissive: 0x0088ff,
      emissiveIntensity: 0.6,
      wireframe: true,
      transparent: true,
      opacity: 0.85,
    });
    this.coreMesh = new THREE.Mesh(coreGeo, coreMat);
    this.cyberCoreGroup.add(this.coreMesh);

    // Inner Core Solid Glow
    const innerGeo = new THREE.SphereGeometry(0.22, 32, 32);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0x00ffff,
      transparent: true,
      opacity: 0.6,
    });
    this.innerCore = new THREE.Mesh(innerGeo, innerMat);
    this.cyberCoreGroup.add(this.innerCore);

    // Orbital Energy Rings
    this.rings = [];
    const ringRadii = [0.45, 0.52, 0.59];
    const ringColors = [0x00f0ff, 0xa855f7, 0xec4899];

    ringRadii.forEach((radius, i) => {
      const ringGeo = new THREE.TorusGeometry(radius, 0.008, 16, 100);
      const ringMat = new THREE.MeshBasicMaterial({
        color: ringColors[i],
        transparent: true,
        opacity: 0.8,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / (2 + i * 0.5);
      ring.rotation.y = (Math.PI / 4) * i;
      this.rings.push(ring);
      this.cyberCoreGroup.add(ring);
    });

    // Audio-reactive particle dust
    const particleCount = 200;
    const particleGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 1.8;
      positions[i + 1] = (Math.random() - 0.5) * 1.8;
      positions[i + 2] = (Math.random() - 0.5) * 1.8;
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const particleMat = new THREE.PointsMaterial({
      color: 0x38bdf8,
      size: 0.025,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
    });
    this.particles = new THREE.Points(particleGeo, particleMat);
    this.cyberCoreGroup.add(this.particles);

    this.scene.add(this.cyberCoreGroup);
  }

  setAudioVolumeGetter(getter) {
    this.audioVolumeGetter = getter;
  }

  /**
   * Load custom 3D VRM model (from File object or URL)
   */
  async loadVRM(fileOrUrl) {
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
          const vrm = gltf.userData.vrm;
          if (!vrm) {
            reject(new Error('Format file bukan VRM yang valid.'));
            return;
          }

          // Clean up old VRM
          if (this.currentVrm) {
            this.scene.remove(this.currentVrm.scene);
            VRMUtils.deepDispose(this.currentVrm.scene);
          }

          // Hide default cyber avatar
          if (this.cyberCoreGroup) {
            this.cyberCoreGroup.visible = false;
          }

          // Setup new VRM
          this.currentVrm = vrm;
          VRMUtils.rotateVRM0(vrm);
          this.scene.add(vrm.scene);

          // Adjust camera to frame avatar upper body / face nicely
          const headNode = vrm.humanoid?.getNormalizedBoneNode('head');
          if (headNode) {
            const headPos = new THREE.Vector3();
            headNode.getWorldPosition(headPos);
            this.camera.position.set(0, headPos.y - 0.05, 1.15);
            this.camera.lookAt(0, headPos.y - 0.05, 0);
          } else {
            this.camera.position.set(0, 1.35, 1.3);
            this.camera.lookAt(0, 1.3, 0);
          }

          console.log('VRM model loaded successfully!');
          resolve(vrm);
        },
        (progress) => {
          console.log('Loading VRM:', (progress.loaded / progress.total) * 100, '%');
        },
        (error) => {
          console.error('Error loading VRM:', error);
          reject(error);
        }
      );
    });
  }

  resetToCyberAvatar() {
    if (this.currentVrm) {
      this.scene.remove(this.currentVrm.scene);
      VRMUtils.deepDispose(this.currentVrm.scene);
      this.currentVrm = null;
    }
    if (this.cyberCoreGroup) {
      this.cyberCoreGroup.visible = true;
    }
    this.camera.position.set(0, 1.35, 1.5);
    this.camera.lookAt(0, 1.2, 0);
  }

  onWindowResize() {
    if (!this.container || !this.renderer || !this.camera) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    const delta = this.clock.getDelta();
    const elapsedTime = this.clock.getElapsedTime();
    const volume = this.audioVolumeGetter() || 0; // 0.0 - 1.0

    // 1. If VRM Model is Active:
    if (this.currentVrm) {
      // Natural idle breathing animation
      const spine = this.currentVrm.humanoid?.getNormalizedBoneNode('spine');
      if (spine) {
        spine.rotation.x = Math.sin(elapsedTime * 1.5) * 0.025;
      }
      const head = this.currentVrm.humanoid?.getNormalizedBoneNode('head');
      if (head) {
        head.rotation.y = Math.sin(elapsedTime * 0.8) * 0.05;
        // Head bobbing when speaking
        head.rotation.x = (Math.sin(elapsedTime * 8.0) * 0.03 * volume);
      }

      // Eye blinking
      this.blinkTimer += delta;
      if (this.blinkTimer >= this.nextBlinkTime) {
        this.currentVrm.expressionManager?.setValue('blink', 1.0);
        if (this.blinkTimer >= this.nextBlinkTime + this.blinkDuration) {
          this.currentVrm.expressionManager?.setValue('blink', 0.0);
          this.blinkTimer = 0;
          this.nextBlinkTime = 2.5 + Math.random() * 3.0;
        }
      }

      // Real-Time Lip-Sync from Gemini Live Audio Volume
      if (this.currentVrm.expressionManager) {
        const mouthOpen = Math.min(1.0, volume * 1.4);
        this.currentVrm.expressionManager.setValue('aa', mouthOpen);
        this.currentVrm.expressionManager.setValue('ih', mouthOpen * 0.4);
        this.currentVrm.expressionManager.setValue('ou', mouthOpen * 0.3);
      }

      this.currentVrm.update(delta);
    }

    // 2. If Procedural Cyber AI Avatar is Active:
    if (this.cyberCoreGroup && this.cyberCoreGroup.visible) {
      // Rotate core & rings
      this.coreMesh.rotation.y += 0.01 + volume * 0.05;
      this.coreMesh.rotation.x += 0.005;

      this.rings[0].rotation.z += 0.015 + volume * 0.04;
      this.rings[1].rotation.x += 0.02 + volume * 0.03;
      this.rings[2].rotation.y += 0.01 + volume * 0.05;

      // Pulse size with audio volume
      const scale = 1.0 + volume * 0.35 + Math.sin(elapsedTime * 2.0) * 0.04;
      this.coreMesh.scale.set(scale, scale, scale);
      this.innerCore.scale.set(scale, scale, scale);

      // Color shift when speaking
      if (volume > 0.05) {
        this.coreMesh.material.emissive.setHex(0xff007f); // Magenta pulse
        this.innerCore.material.color.setHex(0xff00aa);
      } else {
        this.coreMesh.material.emissive.setHex(0x0088ff); // Calm cyan
        this.innerCore.material.color.setHex(0x00ffff);
      }

      // Floating particles
      if (this.particles) {
        this.particles.rotation.y = elapsedTime * 0.05;
      }

      // Floating bobbing
      this.cyberCoreGroup.position.y = 1.2 + Math.sin(elapsedTime * 1.5) * 0.04;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
