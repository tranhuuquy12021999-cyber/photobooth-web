import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js';

/**
 * CatFurFilter3D - Standalone photorealistic 3D Cat Face Filter for Static Web Photobooths.
 * Zero React / Zero OrbitControls / Zero external textures.
 *
 * Usage:
 *   const filter = new CatFurFilter3D(canvas3d);
 *   // Inside MediaPipe FaceMesh / FaceLandmarker onResults:
 *   filter.update(landmarks, canvas3d.width, canvas3d.height, true);
 *   // When disabling filter:
 *   filter.clear();
 *   // On cleanup:
 *   filter.dispose();
 */

const FUR_PALETTES = {
  white: {
    baseHex: '#f6f2eb',
    midHex: '#eae3d7',
    rimDarkHex: '#9d8f82',
    tipShadeHex: '#8d7f73',
    tuftHex: '#fbf9f5',
    lynxTipHex: '#b9aba0',
    sheenHex: '#ffffff',
    whiskerHex: '#101114',
    follicleHex: '#5c4d49',
  },
  gray: {
    baseHex: '#9aa0aa',
    midHex: '#7d838e',
    rimDarkHex: '#424752',
    tipShadeHex: '#353942',
    tuftHex: '#dce0e6',
    lynxTipHex: '#404550',
    sheenHex: '#dde3ec',
    whiskerHex: '#0e0f12',
    follicleHex: '#3c3f47',
  },
  black: {
    baseHex: '#23252b',
    midHex: '#181a1f',
    rimDarkHex: '#0d0e11',
    tipShadeHex: '#121318',
    tuftHex: '#5a5f6b',
    lynxTipHex: '#17191f',
    sheenHex: '#7c8598',
    whiskerHex: '#17181d',
    follicleHex: '#0b0c0e',
  },
};

// Calibrated anatomical tracking constants
const FILTER_NOSE_LOCAL = new THREE.Vector3(0, -0.024, 0.448);
const CANONICAL_HEAD_SCALE = 0.8085;
const EAR_BACK_DEPTH_RATIO = 0.12;
const EAR_HALF_SPACING_RATIO = 0.32;

// Pre-allocated scratch helpers (zero per-frame GC allocations)
const _worldQuat = new THREE.Quaternion();
const _prevQuatInv = new THREE.Quaternion();
const _deltaQuat = new THREE.Quaternion();
const _deltaEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _worldPos = new THREE.Vector3();
const _angVel = new THREE.Vector3();
const _linVel = new THREE.Vector3();
const _dummyObj = new THREE.Object3D();
const _tmpColor = new THREE.Color();
const _cBase = new THREE.Color();
const _cMid = new THREE.Color();
const _cRim = new THREE.Color();
const _cTip = new THREE.Color();
const _cTuft = new THREE.Color();
const _cLynx = new THREE.Color();

const _p1 = new THREE.Vector3();
const _p10 = new THREE.Vector3();
const _p152 = new THREE.Vector3();
const _p234 = new THREE.Vector3();
const _p454 = new THREE.Vector3();
const _p127 = new THREE.Vector3();
const _p356 = new THREE.Vector3();

const _rightVec = new THREE.Vector3();
const _upVec = new THREE.Vector3();
const _forwardVec = new THREE.Vector3();
const _basisMat = new THREE.Matrix4();
const _headQuat = new THREE.Quaternion();
const _noseWorldOffset = new THREE.Vector3();
const _noseTargetPos = new THREE.Vector3();
const _foreheadWorld = new THREE.Vector3();
const _earsTargetPos = new THREE.Vector3();

function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Generates a lightweight zero-dependency procedural studio environment map
 * using PMREMGenerator so MeshPhysicalMaterial clearcoat & fur sheen reflect naturally.
 */
function createProceduralStudioEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x1e212a);

  const panelGeo = new THREE.PlaneGeometry(1, 1);
  const panels = [
    { color: 0xfff8f0, pos: [4, 5, 4], scale: [6, 6, 1], look: [0, 0, 0] },
    { color: 0xdceaff, pos: [-5, 4, -4], scale: [7, 5, 1], look: [0, 0, 0] },
    { color: 0xffeef2, pos: [-4, 0, 5], scale: [5, 4, 1], look: [0, 0, 0] },
    { color: 0xffffff, pos: [0, 7, 0], scale: [8, 8, 1], look: [0, 0, 0] },
    { color: 0x353947, pos: [0, -6, 0], scale: [10, 10, 1], look: [0, 0, 0] },
  ];

  const tempMaterials = [];
  for (let i = 0; i < panels.length; i++) {
    const p = panels[i];
    const mat = new THREE.MeshBasicMaterial({ color: p.color, side: THREE.DoubleSide });
    tempMaterials.push(mat);
    const mesh = new THREE.Mesh(panelGeo, mat);
    mesh.position.set(p.pos[0], p.pos[1], p.pos[2]);
    mesh.scale.set(p.scale[0], p.scale[1], p.scale[2]);
    mesh.lookAt(p.look[0], p.look[1], p.look[2]);
    envScene.add(mesh);
  }

  const envRT = pmrem.fromScene(envScene, 0.04);
  panelGeo.dispose();
  for (let i = 0; i < tempMaterials.length; i++) {
    tempMaterials[i].dispose();
  }
  pmrem.dispose();
  return envRT;
}

class CatFurFilter3D {
  /**
   * @param {HTMLCanvasElement} canvas - Target WebGL canvas overlaid on webcam / photobooth video.
   * @param {Object} [options]
   * @param {number} [options.earHeightRatio=0.26] - Ear height above forehead landmark #10 as ratio of faceHeight.
   * @param {number} [options.earScale=0.82] - Relative ear scale multiplier.
   * @param {number} [options.furDensity=1.0] - Fur strand density multiplier (0.3 - 1.5).
   * @param {number} [options.tuftLength=1.0] - Inner ear tuft length multiplier (0.4 - 1.8).
   * @param {'white'|'gray'|'black'} [options.furColor='white'] - Coat color preset.
   * @param {string} [options.innerEarColor='#f398a8'] - Inner ear & nose pastel pink hex.
   * @param {number} [options.pixelRatio] - Optional renderer pixel ratio override.
   */
  constructor(canvas, options = {}) {
    if (!canvas) {
      throw new Error('CatFurFilter3D requires a valid HTMLCanvasElement.');
    }

    this.canvas = canvas;
    this.earHeightRatio = options.earHeightRatio ?? 0.26;
    this.earScale = options.earScale ?? options.earSizeRatio ?? 0.82;
    this.furDensity = clamp(options.furDensity ?? 1.0, 0.3, 1.5);
    this.tuftLength = clamp(options.tuftLength ?? 1.0, 0.4, 1.8);
    this.furTone = FUR_PALETTES[options.furColor ?? options.furTone] ? (options.furColor ?? options.furTone) : 'white';
    this.innerEarColor = options.innerEarColor ?? '#f398a8';

    // Base capacities per ear (total across 2 ears = 2x)
    this.outerBaseCount = 720;
    this.outerMaxCount = 1080;
    this.tuftBaseCount = 260;
    this.tuftMaxCount = 390;
    this.lynxBaseCount = 54;
    this.lynxMaxCount = 81;

    this.disposableGeometries = [];
    this.disposableMaterials = [];
    this.ears = [];
    this.whiskers = [];

    this.outerAlbedoTex = null;
    this.outerBumpTex = null;
    this.outerRoughTex = null;
    this.innerAlbedoTex = null;
    this.innerBumpTex = null;
    this.noseAlbedoTex = null;
    this.noseBumpTex = null;
    this.follicleAlphaTex = null;

    // Renderer configured specifically for transparent photobooth capture (ctx.drawImage)
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    // Default pixelRatio = 1 so canvas.width/height matches update(..., width, height) 1:1 for ctx.drawImage(canvas3d, 0, 0)
    const dpr = options.pixelRatio ?? 1;
    this.renderer.setPixelRatio(dpr);

    const initW = canvas.width || canvas.clientWidth || 640;
    const initH = canvas.height || canvas.clientHeight || 480;
    this._width = initW;
    this._height = initH;
    this.renderer.setSize(initW, initH, false);

    this.maxAnisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

    // Scene & Camera
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, initW / Math.max(1, initH), 0.05, 30);
    this.camera.position.set(0, 0, 2.2);
    this.camera.lookAt(0, 0, 0);

    // Procedural Studio Environment & 3-Point Rim Lighting
    this._envRT = createProceduralStudioEnvironment(this.renderer);
    this.scene.environment = this._envRT.texture;
    this._setupLighting();

    // Filter hierarchy: independent earsGroup + noseWhiskersGroup under filterRoot
    this.filterRoot = new THREE.Group();
    this.filterRoot.name = 'CatFurFilter3D';
    this.filterRoot.visible = false;
    this.scene.add(this.filterRoot);

    this.earsGroup = new THREE.Group();
    this.earsGroup.name = 'CatEarsCluster';
    this.filterRoot.add(this.earsGroup);

    this.noseWhiskersGroup = new THREE.Group();
    this.noseWhiskersGroup.name = 'CatNoseWhiskersCluster';
    this.filterRoot.add(this.noseWhiskersGroup);

    // Build all 3D geometry, procedural textures & InstancedMesh fur
    this._initSharedGeometries();
    this._initMaterials();
    this._buildEars();
    this._buildNose();
    this._buildWhiskers();

    this._applyFurDensity();
    this._applyTuftLength();
    this._applyFurColors();

    // Tracking smoothing & spring physics state
    this._hasLock = false;
    this._smoothNosePos = new THREE.Vector3();
    this._smoothNoseQuat = new THREE.Quaternion();
    this._smoothNoseScale = 1.0;

    this._smoothEarsPos = new THREE.Vector3();
    this._smoothEarsQuat = new THREE.Quaternion();
    this._smoothEarHalfSpacing = 0.238;
    this._smoothEarScale = this.earScale;

    this._hasPrevEarPose = false;
    this._prevEarWorldQuat = new THREE.Quaternion();
    this._prevEarWorldPos = new THREE.Vector3();
    this._hasPrevNosePose = false;
    this._prevNoseWorldQuat = new THREE.Quaternion();
    this._prevNoseWorldPos = new THREE.Vector3();
    this._twitchTimer = 2.4;
    this._ambientPhase = 0;
    this._lastFrameTime = performance.now();
    this._disposed = false;

    this.renderer.clear();
  }

  // ---------------------------------------------------------------------------
  // Public Photobooth API
  // ---------------------------------------------------------------------------

  /**
   * Updates face tracking pose, spring physics, and renders the 3D cat filter onto the canvas.
   * Accepts an array of 468/478 normalized landmarks from MediaPipe FaceMesh or FaceLandmarker.
   * Automatically hides the filter and clears the canvas when no face is present.
   *
   * @param {Array<{x:number,y:number,z:number}>|null|undefined} landmarks
   * @param {number} width - Target viewport / video width in pixels.
   * @param {number} height - Target viewport / video height in pixels.
   * @param {boolean} [mirror=true] - True for mirrored selfie webcam view.
   */
  update(landmarks, width, height, mirror = true) {
    if (this._disposed) return;

    const safeW = Math.max(1, Math.round(width || this.canvas.width || this.canvas.clientWidth || 640));
    const safeH = Math.max(1, Math.round(height || this.canvas.height || this.canvas.clientHeight || 480));
    if (safeW !== this._width || safeH !== this._height) {
      this._width = safeW;
      this._height = safeH;
      this.camera.aspect = safeW / safeH;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(safeW, safeH, false);
    }

    if (!landmarks || landmarks.length < 455) {
      this.clear();
      return;
    }

    const now = performance.now();
    const dt = clamp((now - this._lastFrameTime) * 0.001, 0.001, 0.05);
    this._lastFrameTime = now;

    // Project normalized MediaPipe landmarks into isotropic Three.js world space
    const camZ = this.camera.position.z;
    const halfH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5)) * camZ;
    const halfW = halfH * this.camera.aspect;
    const worldScaleX = 2 * halfW;
    const worldScaleY = 2 * halfH;
    const xSign = mirror ? -1 : 1;

    const toWorld3D = (idx, out) => {
      const pt = landmarks[idx];
      out.set(
        xSign * ((pt.x - 0.5) * worldScaleX),
        -((pt.y - 0.5) * worldScaleY),
        -(pt.z || 0) * worldScaleX
      );
      return out;
    };

    toWorld3D(1, _p1);     // Nose tip
    toWorld3D(10, _p10);   // Forehead top
    toWorld3D(152, _p152); // Chin bottom
    toWorld3D(234, _p234); // Cheek/ear outer edge (anatomical right)
    toWorld3D(454, _p454); // Cheek/ear outer edge (anatomical left)
    toWorld3D(127, _p127); // Temple left
    toWorld3D(356, _p356); // Temple right

    // Orthonormal right-handed 3D local coordinate basis of the head
    if (mirror) {
      _rightVec.subVectors(_p234, _p454).normalize();
    } else {
      _rightVec.subVectors(_p454, _p234).normalize();
    }
    _upVec.subVectors(_p10, _p152).normalize();
    _forwardVec.crossVectors(_rightVec, _upVec).normalize();

    if (_forwardVec.lengthSq() > 0.0001) {
      _upVec.crossVectors(_forwardVec, _rightVec).normalize();
      _rightVec.crossVectors(_upVec, _forwardVec).normalize();
      _basisMat.makeBasis(_rightVec, _upVec, _forwardVec);
      _headQuat.setFromRotationMatrix(_basisMat);
    }

    // 1. Nose & Whiskers cluster anchored directly to nose tip (landmark #1)
    const templeWidth2D = Math.hypot(_p356.x - _p127.x, _p356.y - _p127.y);
    const faceHeight2D = Math.hypot(_p10.x - _p152.x, _p10.y - _p152.y);
    const targetNoseScale = clamp(
      (templeWidth2D / 0.72) * 0.65 + (faceHeight2D / 0.88) * 0.35,
      0.32,
      2.8
    );

    _noseWorldOffset
      .copy(FILTER_NOSE_LOCAL)
      .multiplyScalar(targetNoseScale)
      .applyQuaternion(_headQuat);

    _noseTargetPos.set(
      _p1.x - _noseWorldOffset.x,
      _p1.y - _noseWorldOffset.y,
      -_noseWorldOffset.z
    );

    // 2. Cat Ears cluster anchored proportionally to forehead (#10) & faceHeight / faceWidth
    const faceHeight = _p10.distanceTo(_p152);
    const faceWidth = _p234.distanceTo(_p454);
    const headScale = faceWidth * 0.55 + faceHeight * 0.45;

    const relForeheadZ = _p10.z - _p1.z;
    const perspFactor = (camZ - relForeheadZ) / camZ;
    _foreheadWorld.set(_p10.x * perspFactor, _p10.y * perspFactor, relForeheadZ);

    _earsTargetPos
      .copy(_foreheadWorld)
      .addScaledVector(_upVec, this.earHeightRatio * faceHeight)
      .addScaledVector(_forwardVec, -EAR_BACK_DEPTH_RATIO * faceHeight);

    const targetEarScale = clamp((headScale / CANONICAL_HEAD_SCALE) * this.earScale, 0.18, 3.2);
    const targetEarHalfSpacing = EAR_HALF_SPACING_RATIO * faceWidth;

    if (!this._hasLock) {
      this._smoothNosePos.copy(_noseTargetPos);
      this._smoothNoseQuat.copy(_headQuat);
      this._smoothNoseScale = targetNoseScale;

      this._smoothEarsPos.copy(_earsTargetPos);
      this._smoothEarsQuat.copy(_headQuat);
      this._smoothEarHalfSpacing = targetEarHalfSpacing;
      this._smoothEarScale = targetEarScale;

      this._hasLock = true;
      this._hasPrevEarPose = false;
      this._hasPrevNosePose = false;
    } else {
      const alpha = 1 - Math.exp(-22 * dt);
      this._smoothNosePos.lerp(_noseTargetPos, alpha);
      this._smoothNoseQuat.slerp(_headQuat, alpha);
      this._smoothNoseScale = THREE.MathUtils.lerp(this._smoothNoseScale, targetNoseScale, alpha);

      this._smoothEarsPos.lerp(_earsTargetPos, alpha);
      this._smoothEarsQuat.slerp(_headQuat, alpha);
      this._smoothEarHalfSpacing = THREE.MathUtils.lerp(
        this._smoothEarHalfSpacing,
        targetEarHalfSpacing,
        alpha
      );
      this._smoothEarScale = THREE.MathUtils.lerp(this._smoothEarScale, targetEarScale, alpha);
    }

    // Apply dual-anchor transforms
    this.filterRoot.visible = true;

    this.noseWhiskersGroup.position.copy(this._smoothNosePos);
    this.noseWhiskersGroup.quaternion.copy(this._smoothNoseQuat);
    this.noseWhiskersGroup.scale.setScalar(this._smoothNoseScale);

    this.earsGroup.position.copy(this._smoothEarsPos);
    this.earsGroup.quaternion.copy(this._smoothEarsQuat);
    this.earsGroup.scale.setScalar(1);

    for (let i = 0; i < this.ears.length; i++) {
      const ear = this.ears[i];
      ear.pivot.position.set(ear.side * this._smoothEarHalfSpacing, 0, 0);
      ear.pivot.scale.setScalar(this._smoothEarScale);
    }

    // Step spring physics & organic ear twitch
    this.filterRoot.updateMatrixWorld(true);
    this._updatePhysics(dt);

    // Render onto transparent WebGL buffer
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Hides the 3D filter and clears the WebGL canvas to full transparency.
   */
  clear() {
    if (this._disposed) return;
    this.filterRoot.visible = false;
    this._hasLock = false;
    this._hasPrevEarPose = false;
    this._hasPrevNosePose = false;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, true, true);
  }

  /**
   * Releases all GPU buffers, textures, materials, and WebGL renderer resources.
   */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    this.outerAlbedoTex?.dispose();
    this.outerBumpTex?.dispose();
    this.outerRoughTex?.dispose();
    this.innerAlbedoTex?.dispose();
    this.innerBumpTex?.dispose();
    this.noseAlbedoTex?.dispose();
    this.noseBumpTex?.dispose();
    this.follicleAlphaTex?.dispose();

    for (let i = 0; i < this.disposableGeometries.length; i++) {
      this.disposableGeometries[i].dispose();
    }
    for (let i = 0; i < this.disposableMaterials.length; i++) {
      this.disposableMaterials[i].dispose();
    }
    this.disposableGeometries = [];
    this.disposableMaterials = [];

    this._envRT?.dispose();
    this.renderer.dispose();
  }

  // Optional runtime customization helpers
  setFurDensity(density) {
    this.furDensity = clamp(density, 0.3, 1.5);
    this._applyFurDensity();
  }

  setTuftLength(length) {
    this.tuftLength = clamp(length, 0.4, 1.8);
    this._applyTuftLength();
  }

  setFurTone(tone) {
    if (!FUR_PALETTES[tone] || this.furTone === tone) return;
    this.furTone = tone;
    this._rebuildOuterTextures();
    this._rebuildInnerTextures();
    this._applyFurColors();
  }

  setInnerEarColor(hexColor) {
    if (this.innerEarColor === hexColor) return;
    this.innerEarColor = hexColor;
    this._rebuildInnerTextures();
    this._rebuildNoseTextures();
  }

  triggerEarTwitch(side) {
    const chosenSide = side ?? (Math.random() < 0.5 ? -1 : 1);
    const rig = this.ears.find((e) => e.side === chosenSide) ?? this.ears[0];
    if (!rig) return;
    rig.spring.twitchTime = 0.0001;
    rig.spring.twitchDuration = 0.34 + Math.random() * 0.12;
    rig.spring.twitchAmp = 0.24 + Math.random() * 0.1;
    rig.spring.twitchDouble = Math.random() < 0.38;
  }

  // ---------------------------------------------------------------------------
  // Studio Lighting Setup
  // ---------------------------------------------------------------------------

  _setupLighting() {
    const hemiLight = new THREE.HemisphereLight(0xd2e2ff, 0x262933, 0.95);
    this.scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff5e8, 2.25);
    keyLight.position.set(1.85, 2.35, 2.4);
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xe4f0ff, 1.95);
    rimLight.position.set(-1.6, 1.9, -2.1);
    this.scene.add(rimLight);

    const fillLight = new THREE.DirectionalLight(0xffe9ee, 0.65);
    fillLight.position.set(-1.9, -0.2, 1.7);
    this.scene.add(fillLight);
  }

  // ---------------------------------------------------------------------------
  // Spring Physics & Ear Twitch
  // ---------------------------------------------------------------------------

  _updatePhysics(dt) {
    this._ambientPhase += dt;

    // 1. Ear cluster spring velocity
    this.earsGroup.getWorldQuaternion(_worldQuat);
    this.earsGroup.getWorldPosition(_worldPos);

    _angVel.set(0, 0, 0);
    _linVel.set(0, 0, 0);

    if (this._hasPrevEarPose) {
      _prevQuatInv.copy(this._prevEarWorldQuat).invert();
      _deltaQuat.copy(_worldQuat).multiply(_prevQuatInv);
      _deltaEuler.setFromQuaternion(_deltaQuat, 'YXZ');

      _angVel.set(
        clamp(_deltaEuler.x / dt, -10, 10),
        clamp(_deltaEuler.y / dt, -10, 10),
        clamp(_deltaEuler.z / dt, -10, 10)
      );
      _linVel
        .subVectors(_worldPos, this._prevEarWorldPos)
        .divideScalar(dt)
        .clampLength(0, 6);
    } else {
      this._hasPrevEarPose = true;
    }

    this._prevEarWorldQuat.copy(_worldQuat);
    this._prevEarWorldPos.copy(_worldPos);

    // Periodic random ear twitch
    this._twitchTimer -= dt;
    if (this._twitchTimer <= 0) {
      this.triggerEarTwitch();
      this._twitchTimer = 2.8 + Math.random() * 3.8;
    }

    const earK = 128;
    const earDamping = 11.8;

    for (let i = 0; i < this.ears.length; i++) {
      const ear = this.ears[i];
      const s = ear.spring;

      const targetPitch = clamp(-_angVel.x * 0.042 - _linVel.y * 0.055, -0.24, 0.24);
      const targetRoll = clamp(-_angVel.z * 0.048 + _linVel.x * 0.045, -0.26, 0.26);
      const targetYaw = clamp(-_angVel.y * 0.044, -0.22, 0.22);
      const breathe = Math.sin(this._ambientPhase * 1.45 + ear.side * 0.7) * 0.014;

      s.pitchVel += ((targetPitch + breathe - s.pitch) * earK - s.pitchVel * earDamping) * dt;
      s.rollVel += ((targetRoll - s.roll) * earK - s.rollVel * earDamping) * dt;
      s.yawVel += ((targetYaw - s.yaw) * earK - s.yawVel * earDamping) * dt;

      s.pitch += s.pitchVel * dt;
      s.roll += s.rollVel * dt;
      s.yaw += s.yawVel * dt;

      let twitchPitch = 0;
      let twitchRoll = 0;
      let twitchYaw = 0;
      if (s.twitchTime > 0) {
        s.twitchTime += dt;
        const u = s.twitchTime / s.twitchDuration;
        if (u >= 1) {
          s.twitchTime = 0;
        } else {
          const freq = s.twitchDouble ? Math.PI * 3.0 : Math.PI * 1.5;
          const wave = Math.sin(u * freq) * Math.exp(-u * 4.2);
          const env = Math.sin(Math.min(1, u * 5.0) * (Math.PI * 0.5)) * wave;
          twitchPitch = -s.twitchAmp * 0.72 * env;
          twitchRoll = -ear.side * s.twitchAmp * 0.95 * env;
          twitchYaw = -ear.side * s.twitchAmp * 0.55 * env;
        }
      }

      ear.pivot.rotation.set(
        ear.baseRot.x + s.pitch + twitchPitch,
        ear.baseRot.y + s.yaw + twitchYaw,
        ear.baseRot.z + s.roll + twitchRoll
      );
    }

    // 2. Nose & whiskers cluster spring velocity
    this.noseWhiskersGroup.getWorldQuaternion(_worldQuat);
    this.noseWhiskersGroup.getWorldPosition(_worldPos);

    _angVel.set(0, 0, 0);
    _linVel.set(0, 0, 0);

    if (this._hasPrevNosePose) {
      _prevQuatInv.copy(this._prevNoseWorldQuat).invert();
      _deltaQuat.copy(_worldQuat).multiply(_prevQuatInv);
      _deltaEuler.setFromQuaternion(_deltaQuat, 'YXZ');

      _angVel.set(
        clamp(_deltaEuler.x / dt, -10, 10),
        clamp(_deltaEuler.y / dt, -10, 10),
        clamp(_deltaEuler.z / dt, -10, 10)
      );
      _linVel
        .subVectors(_worldPos, this._prevNoseWorldPos)
        .divideScalar(dt)
        .clampLength(0, 6);
    } else {
      this._hasPrevNosePose = true;
    }

    this._prevNoseWorldQuat.copy(_worldQuat);
    this._prevNoseWorldPos.copy(_worldPos);

    const whiskK = 195;
    const whiskDamping = 10.2;

    for (let wi = 0; wi < this.whiskers.length; wi++) {
      const w = this.whiskers[wi];
      const targetFlexY = clamp(
        -_angVel.x * 0.032 - _linVel.y * 0.055 + _angVel.z * w.side * 0.025,
        -0.22,
        0.22
      );
      const targetFlexZ = clamp(-_angVel.y * 0.042 + _linVel.x * 0.035, -0.24, 0.24);

      w.flexYVel += ((targetFlexY - w.flexY) * whiskK - w.flexYVel * whiskDamping) * dt;
      w.flexZVel += ((targetFlexZ - w.flexZ) * whiskK - w.flexZVel * whiskDamping) * dt;

      w.flexY += w.flexYVel * dt;
      w.flexZ += w.flexZVel * dt;

      for (let i = 0; i < w.pivots.length; i++) {
        const pivot = w.pivots[i];
        const base = w.baseRots[i];
        const microQuiver = Math.sin(this._ambientPhase * 4.2 + i * 1.7 + w.side) * 0.008;
        const rowWeight = 0.85 + i * 0.14;
        pivot.rotation.set(
          base.x + w.flexY * 0.45 * rowWeight,
          base.y + w.flexZ * rowWeight,
          base.z + (w.flexY * w.side * 0.85 + microQuiver) * rowWeight
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Shared Procedural Geometries for Micro-Fur Strands
  // ---------------------------------------------------------------------------

  _initSharedGeometries() {
    this.outerStrandGeo = this._createFurStrandGeometry({
      length: 0.036,
      baseWidth: 0.0064,
      spineDepth: 0.0018,
      curveForward: 0.0045,
      segments: 4,
    });

    this.tuftStrandGeo = this._createFurStrandGeometry({
      length: 0.088,
      baseWidth: 0.0044,
      spineDepth: 0.0011,
      curveForward: 0.022,
      sCurveWave: 0.0045,
      segments: 6,
    });

    this.lynxStrandGeo = this._createFurStrandGeometry({
      length: 0.062,
      baseWidth: 0.0042,
      spineDepth: 0.0012,
      curveForward: 0.0075,
      segments: 5,
    });

    this.disposableGeometries.push(this.outerStrandGeo, this.tuftStrandGeo, this.lynxStrandGeo);
  }

  _createFurStrandGeometry(cfg) {
    const { length, baseWidth, spineDepth, curveForward, sCurveWave = 0, segments } = cfg;
    const positions = [];
    const uvs = [];
    const indices = [];

    for (let i = 0; i < segments; i++) {
      const t = i / segments;
      const y = t * length;
      const taper = Math.pow(1 - t, 0.85);
      const halfW = baseWidth * 0.5 * taper;
      const ridgeZ = spineDepth * taper;
      const zCurve = curveForward * t * t + Math.sin(t * Math.PI * 1.4) * sCurveWave;
      const xWave = Math.sin(t * Math.PI * 1.1) * sCurveWave * 0.45;

      positions.push(-halfW + xWave, y, zCurve);
      uvs.push(0, t);
      positions.push(xWave, y, zCurve + ridgeZ);
      uvs.push(0.5, t);
      positions.push(halfW + xWave, y, zCurve);
      uvs.push(1, t);
    }

    const tipZ = curveForward + Math.sin(Math.PI * 1.4) * sCurveWave;
    const tipX = Math.sin(Math.PI * 1.1) * sCurveWave * 0.45;
    const tipIndex = segments * 3;
    positions.push(tipX, length, tipZ);
    uvs.push(0.5, 1);

    for (let i = 0; i < segments - 1; i++) {
      const r0 = i * 3;
      const r1 = (i + 1) * 3;
      indices.push(r0, r0 + 1, r1 + 1);
      indices.push(r0, r1 + 1, r1);
      indices.push(r0 + 1, r0 + 2, r1 + 2);
      indices.push(r0 + 1, r1 + 2, r1 + 1);
    }

    const lastRing = (segments - 1) * 3;
    indices.push(lastRing, lastRing + 1, tipIndex);
    indices.push(lastRing + 1, lastRing + 2, tipIndex);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  // ---------------------------------------------------------------------------
  // Procedural Canvas Textures & PBR Materials
  // ---------------------------------------------------------------------------

  _initMaterials() {
    const palette = FUR_PALETTES[this.furTone];

    this.outerShellMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.86,
      metalness: 0.0,
      bumpScale: 0.0085,
      sheen: 0.55,
      sheenRoughness: 0.72,
      sheenColor: new THREE.Color(palette.sheenHex),
    });

    this.innerBowlMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.68,
      metalness: 0.0,
      bumpScale: 0.0032,
      sheen: 0.35,
      sheenRoughness: 0.65,
      sheenColor: new THREE.Color('#ffd8df'),
    });

    this.outerFurMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.78,
      metalness: 0.0,
      sheen: 0.65,
      sheenRoughness: 0.62,
      sheenColor: new THREE.Color(palette.sheenHex),
      side: THREE.DoubleSide,
    });

    this.innerTuftMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.72,
      metalness: 0.0,
      sheen: 0.8,
      sheenRoughness: 0.52,
      sheenColor: new THREE.Color('#ffffff'),
      side: THREE.DoubleSide,
    });

    this.lynxTipMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.74,
      metalness: 0.0,
      sheen: 0.65,
      sheenRoughness: 0.58,
      sheenColor: new THREE.Color(palette.sheenHex),
      side: THREE.DoubleSide,
    });

    this.noseMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.35,
      metalness: 0.0,
      clearcoat: 0.4,
      clearcoatRoughness: 0.24,
      bumpScale: 0.0032,
      sheen: 0.12,
      sheenColor: new THREE.Color('#ffdce3'),
    });

    this.whiskerMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(palette.whiskerHex),
      roughness: 0.16,
      metalness: 0.08,
      clearcoat: 0.75,
      clearcoatRoughness: 0.14,
    });

    this.follicleAlphaTex = this._createFollicleAlphaTexture();
    this.follicleMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color(palette.follicleHex),
      alphaMap: this.follicleAlphaTex,
      transparent: true,
      opacity: 0.52,
      roughness: 0.85,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    this.disposableMaterials.push(
      this.outerShellMaterial,
      this.innerBowlMaterial,
      this.outerFurMaterial,
      this.innerTuftMaterial,
      this.lynxTipMaterial,
      this.noseMaterial,
      this.whiskerMaterial,
      this.follicleMaterial
    );

    this._rebuildOuterTextures();
    this._rebuildInnerTextures();
    this._rebuildNoseTextures();
  }

  _rebuildOuterTextures() {
    const palette = FUR_PALETTES[this.furTone];
    const size = 512;

    const albedoCanvas = document.createElement('canvas');
    albedoCanvas.width = size;
    albedoCanvas.height = size;
    const actx = albedoCanvas.getContext('2d');

    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = size;
    bumpCanvas.height = size;
    const bctx = bumpCanvas.getContext('2d');

    const roughCanvas = document.createElement('canvas');
    roughCanvas.width = size;
    roughCanvas.height = size;
    const rctx = roughCanvas.getContext('2d');

    const grad = actx.createLinearGradient(0, size, 0, 0);
    grad.addColorStop(0.0, palette.baseHex);
    grad.addColorStop(0.55, palette.baseHex);
    grad.addColorStop(0.86, palette.midHex);
    grad.addColorStop(1.0, palette.rimDarkHex);
    actx.fillStyle = grad;
    actx.fillRect(0, 0, size, size);

    const leftRim = actx.createLinearGradient(0, 0, size * 0.24, 0);
    leftRim.addColorStop(0, palette.rimDarkHex);
    leftRim.addColorStop(1, 'rgba(0,0,0,0)');
    actx.globalAlpha = this.furTone === 'white' ? 0.42 : 0.52;
    actx.fillStyle = leftRim;
    actx.fillRect(0, 0, size * 0.28, size);

    const rightRim = actx.createLinearGradient(size, 0, size * 0.72, 0);
    rightRim.addColorStop(0, palette.rimDarkHex);
    rightRim.addColorStop(1, 'rgba(0,0,0,0)');
    actx.globalAlpha = this.furTone === 'white' ? 0.52 : 0.62;
    actx.fillStyle = rightRim;
    actx.fillRect(size * 0.7, 0, size * 0.3, size);
    actx.globalAlpha = 1.0;

    bctx.fillStyle = '#787878';
    bctx.fillRect(0, 0, size, size);
    rctx.fillStyle = '#d4d4d4';
    rctx.fillRect(0, 0, size, size);

    const rand = seededRandom(4219);
    const baseColor = new THREE.Color(palette.baseHex);
    const rimColor = new THREE.Color(palette.rimDarkHex);
    const strokeCol = new THREE.Color();

    for (let i = 0; i < 6200; i++) {
      const u = rand();
      const v = rand();
      const x = u * size;
      const y = (1 - v) * size;

      const inwardLean = (0.5 - u) * 0.35 * (0.3 + v * 0.7);
      const jitter = (rand() - 0.5) * 0.22;
      const angle = -Math.PI * 0.5 + inwardLean + jitter;
      const len = (14 + rand() * 24) * (1.12 - v * 0.42);
      const dx = Math.cos(angle) * len;
      const dy = Math.sin(angle) * len;

      const edgeWeight = Math.pow(Math.abs(u - 0.5) * 2, 2.2) * 0.65 + Math.pow(v, 2.6) * 0.45;
      strokeCol.copy(baseColor).lerp(rimColor, clamp(edgeWeight * (0.45 + rand() * 0.45), 0, 0.9));
      strokeCol.offsetHSL(0, 0, (rand() - 0.5) * 0.09);

      actx.strokeStyle = `rgba(${Math.round(strokeCol.r * 255)},${Math.round(strokeCol.g * 255)},${Math.round(strokeCol.b * 255)},${0.32 + rand() * 0.35})`;
      actx.lineWidth = 0.75 + rand() * 1.15;
      actx.beginPath();
      actx.moveTo(x, y);
      actx.lineTo(x + dx, y + dy);
      actx.stroke();

      const bVal = Math.round(135 + rand() * 108);
      bctx.strokeStyle = `rgba(${bVal},${bVal},${bVal},0.48)`;
      bctx.lineWidth = 0.8 + rand() * 1.1;
      bctx.beginPath();
      bctx.moveTo(x, y);
      bctx.lineTo(x + dx, y + dy);
      bctx.stroke();

      const darkB = Math.round(42 + rand() * 48);
      bctx.strokeStyle = `rgba(${darkB},${darkB},${darkB},0.28)`;
      bctx.beginPath();
      bctx.moveTo(x + 1.1, y);
      bctx.lineTo(x + dx + 1.1, y + dy);
      bctx.stroke();

      const rVal = Math.round(185 + rand() * 58);
      rctx.strokeStyle = `rgba(${rVal},${rVal},${rVal},0.35)`;
      rctx.lineWidth = 1.0;
      rctx.beginPath();
      rctx.moveTo(x, y);
      rctx.lineTo(x + dx, y + dy);
      rctx.stroke();
    }

    this.outerAlbedoTex?.dispose();
    this.outerBumpTex?.dispose();
    this.outerRoughTex?.dispose();

    this.outerAlbedoTex = new THREE.CanvasTexture(albedoCanvas);
    this.outerAlbedoTex.colorSpace = THREE.SRGBColorSpace;
    this.outerAlbedoTex.anisotropy = this.maxAnisotropy;

    this.outerBumpTex = new THREE.CanvasTexture(bumpCanvas);
    this.outerBumpTex.anisotropy = this.maxAnisotropy;

    this.outerRoughTex = new THREE.CanvasTexture(roughCanvas);
    this.outerRoughTex.anisotropy = this.maxAnisotropy;

    this.outerShellMaterial.map = this.outerAlbedoTex;
    this.outerShellMaterial.bumpMap = this.outerBumpTex;
    this.outerShellMaterial.roughnessMap = this.outerRoughTex;
    this.outerShellMaterial.sheenColor.set(palette.sheenHex);
    this.outerShellMaterial.needsUpdate = true;

    this.outerFurMaterial.sheenColor.set(palette.sheenHex);
    this.lynxTipMaterial.sheenColor.set(palette.sheenHex);
    this.whiskerMaterial.color.set(palette.whiskerHex);
    this.follicleMaterial.color.set(palette.follicleHex);
  }

  _rebuildInnerTextures() {
    const size = 512;
    const basePink = new THREE.Color(this.innerEarColor);
    const furBase = new THREE.Color(FUR_PALETTES[this.furTone].baseHex);

    const deepPink = basePink.clone().offsetHSL(-0.015, 0.14, -0.17);
    const softTopPink = basePink.clone().lerp(new THREE.Color('#fdebf0'), 0.42);
    const edgeBlend = basePink.clone().lerp(furBase, this.furTone === 'black' ? 0.25 : 0.45);

    const albedoCanvas = document.createElement('canvas');
    albedoCanvas.width = size;
    albedoCanvas.height = size;
    const actx = albedoCanvas.getContext('2d');

    const vGrad = actx.createLinearGradient(0, size, 0, 0);
    vGrad.addColorStop(0.0, `#${deepPink.getHexString()}`);
    vGrad.addColorStop(0.32, `#${basePink.getHexString()}`);
    vGrad.addColorStop(0.78, `#${softTopPink.getHexString()}`);
    vGrad.addColorStop(1.0, `#${edgeBlend.getHexString()}`);
    actx.fillStyle = vGrad;
    actx.fillRect(0, 0, size, size);

    const rad = actx.createRadialGradient(
      size * 0.5,
      size * 0.84,
      size * 0.04,
      size * 0.5,
      size * 0.78,
      size * 0.52
    );
    const canalDark = deepPink.clone().offsetHSL(0, 0.06, -0.1);
    rad.addColorStop(0, `rgba(${Math.round(canalDark.r * 255)},${Math.round(canalDark.g * 255)},${Math.round(canalDark.b * 255)},0.78)`);
    rad.addColorStop(0.55, `rgba(${Math.round(deepPink.r * 255)},${Math.round(deepPink.g * 255)},${Math.round(deepPink.b * 255)},0.25)`);
    rad.addColorStop(1, 'rgba(0,0,0,0)');
    actx.fillStyle = rad;
    actx.fillRect(0, 0, size, size);

    const rimGrad = actx.createRadialGradient(
      size * 0.5,
      size * 0.56,
      size * 0.22,
      size * 0.5,
      size * 0.52,
      size * 0.54
    );
    rimGrad.addColorStop(0, 'rgba(0,0,0,0)');
    rimGrad.addColorStop(0.78, 'rgba(0,0,0,0)');
    rimGrad.addColorStop(1, `rgba(${Math.round(edgeBlend.r * 255)},${Math.round(edgeBlend.g * 255)},${Math.round(edgeBlend.b * 255)},0.62)`);
    actx.fillStyle = rimGrad;
    actx.fillRect(0, 0, size, size);

    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = size;
    bumpCanvas.height = size;
    const bctx = bumpCanvas.getContext('2d');
    bctx.fillStyle = '#808080';
    bctx.fillRect(0, 0, size, size);

    const rand = seededRandom(8831);
    for (let i = 0; i < 16; i++) {
      const startX = size * (0.28 + rand() * 0.44);
      const startY = size * (0.72 + rand() * 0.24);
      const endX = startX + (rand() - 0.5) * size * 0.28;
      const endY = startY - size * (0.22 + rand() * 0.34);
      actx.strokeStyle = `rgba(${Math.round(deepPink.r * 255)},${Math.round(deepPink.g * 255)},${Math.round(deepPink.b * 255)},0.12)`;
      actx.lineWidth = 1.2 + rand() * 1.4;
      actx.beginPath();
      actx.moveTo(startX, startY);
      actx.quadraticCurveTo(
        (startX + endX) * 0.5 + (rand() - 0.5) * 32,
        (startY + endY) * 0.5,
        endX,
        endY
      );
      actx.stroke();
    }

    for (let i = 0; i < 2400; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const len = 6 + rand() * 10;
      const ang = -Math.PI * 0.5 + (rand() - 0.5) * 0.4;
      const v = Math.round(112 + rand() * 44);
      bctx.strokeStyle = `rgba(${v},${v},${v},0.28)`;
      bctx.lineWidth = 0.7;
      bctx.beginPath();
      bctx.moveTo(x, y);
      bctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      bctx.stroke();

      if (rand() < 0.35) {
        actx.fillStyle = `rgba(255,245,248,${0.05 + rand() * 0.06})`;
        actx.fillRect(x, y, 1.5, 3);
      }
    }

    this.innerAlbedoTex?.dispose();
    this.innerBumpTex?.dispose();

    this.innerAlbedoTex = new THREE.CanvasTexture(albedoCanvas);
    this.innerAlbedoTex.colorSpace = THREE.SRGBColorSpace;
    this.innerAlbedoTex.anisotropy = this.maxAnisotropy;

    this.innerBumpTex = new THREE.CanvasTexture(bumpCanvas);
    this.innerBumpTex.anisotropy = this.maxAnisotropy;

    this.innerBowlMaterial.map = this.innerAlbedoTex;
    this.innerBowlMaterial.bumpMap = this.innerBumpTex;
    this.innerBowlMaterial.sheenColor.copy(softTopPink);
    this.innerBowlMaterial.needsUpdate = true;
  }

  _rebuildNoseTextures() {
    const size = 256;
    const basePink = new THREE.Color(this.innerEarColor);
    const nosePink = basePink.clone().offsetHSL(-0.008, 0.06, -0.02);
    const noseEdge = nosePink.clone().offsetHSL(0, 0.1, -0.14);
    const grooveDark = nosePink.clone().offsetHSL(0, 0.12, -0.26);

    const albedoCanvas = document.createElement('canvas');
    albedoCanvas.width = size;
    albedoCanvas.height = size;
    const actx = albedoCanvas.getContext('2d');

    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = size;
    bumpCanvas.height = size;
    const bctx = bumpCanvas.getContext('2d');

    const grad = actx.createRadialGradient(size * 0.5, size * 0.42, size * 0.08, size * 0.5, size * 0.5, size * 0.56);
    grad.addColorStop(0.0, `#${nosePink.clone().offsetHSL(0, -0.04, 0.06).getHexString()}`);
    grad.addColorStop(0.62, `#${nosePink.getHexString()}`);
    grad.addColorStop(1.0, `#${noseEdge.getHexString()}`);
    actx.fillStyle = grad;
    actx.fillRect(0, 0, size, size);

    const cleftGrad = actx.createLinearGradient(size * 0.5, size * 0.62, size * 0.5, size * 0.98);
    cleftGrad.addColorStop(0, 'rgba(0,0,0,0)');
    cleftGrad.addColorStop(1, `rgba(${Math.round(grooveDark.r * 255)},${Math.round(grooveDark.g * 255)},${Math.round(grooveDark.b * 255)},0.65)`);
    actx.fillStyle = cleftGrad;
    actx.fillRect(size * 0.45, size * 0.62, size * 0.1, size * 0.36);

    bctx.fillStyle = '#6e6e6e';
    bctx.fillRect(0, 0, size, size);
    const rand = seededRandom(5512);
    for (let i = 0; i < 1600; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 1.6 + rand() * 2.4;
      const lum = Math.round(145 + rand() * 88);
      const cell = bctx.createRadialGradient(x, y, 0, x, y, r);
      cell.addColorStop(0, `rgba(${lum},${lum},${lum},0.65)`);
      cell.addColorStop(0.7, `rgba(${Math.round(lum * 0.72)},${Math.round(lum * 0.72)},${Math.round(lum * 0.72)},0.3)`);
      cell.addColorStop(1, 'rgba(55,55,55,0)');
      bctx.fillStyle = cell;
      bctx.beginPath();
      bctx.arc(x, y, r, 0, Math.PI * 2);
      bctx.fill();

      if (rand() < 0.45) {
        actx.fillStyle = `rgba(255,240,244,${0.03 + rand() * 0.04})`;
        actx.beginPath();
        actx.arc(x, y, r * 0.7, 0, Math.PI * 2);
        actx.fill();
      }
    }

    this.noseAlbedoTex?.dispose();
    this.noseBumpTex?.dispose();

    this.noseAlbedoTex = new THREE.CanvasTexture(albedoCanvas);
    this.noseAlbedoTex.colorSpace = THREE.SRGBColorSpace;
    this.noseAlbedoTex.anisotropy = this.maxAnisotropy;

    this.noseBumpTex = new THREE.CanvasTexture(bumpCanvas);
    this.noseBumpTex.anisotropy = this.maxAnisotropy;

    this.noseMaterial.map = this.noseAlbedoTex;
    this.noseMaterial.bumpMap = this.noseBumpTex;
    this.noseMaterial.needsUpdate = true;
  }

  _createFollicleAlphaTexture() {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
    g.addColorStop(0.0, 'rgba(255,255,255,1.0)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.65)');
    g.addColorStop(0.8, 'rgba(255,255,255,0.16)');
    g.addColorStop(1.0, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
  }

  // ---------------------------------------------------------------------------
  // Parametric Sculpted 3D Cat Ears + 3 InstancedMesh Micro-Fur Layers
  // ---------------------------------------------------------------------------

  _evalEarFrame(u, v, side) {
    const earHeight = 0.375;
    const apexShiftX = 0.048 * Math.pow(v, 1.38);
    const xMed = -0.158 * Math.pow(1 - v, 0.78) + apexShiftX;
    const xLat = 0.172 * Math.pow(1 - v, 0.6) + 0.056 * Math.sin(v * Math.PI * 0.88) + apexShiftX;

    const t = (u + 1) * 0.5;
    const rawX = xMed + (xLat - xMed) * t;
    const x = rawX * side;
    const y = v * earHeight - 0.018 * (u * u) * (1 - v);

    const radialCenter = Math.max(0, 1 - u * u);
    const baseThick = 1 - 0.72 * Math.pow(v, 0.9);
    const rimArch = Math.pow(Math.abs(u), 1.45) * 0.026 * (1 - 0.65 * v);
    const tipForwardLean = 0.022 * Math.sin(v * Math.PI * 0.75);

    const pocketU = smoothstep(0.45, 0.88, u) * (1 - smoothstep(0.88, 1.0, u));
    const pocketV = smoothstep(0.04, 0.18, v) * (1 - smoothstep(0.24, 0.42, v));
    const pocketFold = pocketU * pocketV * 0.016;

    const zFrontRim = rimArch + tipForwardLean + pocketFold;
    const bowlV = Math.sin(clamp((v - 0.02) / 0.88, 0, 1) * Math.PI);
    const lowerBias = 1.25 - 0.55 * v;
    const zInnerBowl = zFrontRim - 0.068 * Math.pow(radialCenter, 0.88) * Math.pow(bowlV, 0.78) * lowerBias;

    const wallThickness = (0.046 * Math.sqrt(Math.max(0.03, radialCenter)) + 0.013) * baseThick + 0.008;
    const zOuterBack = zInnerBowl - wallThickness - 0.018 * radialCenter * (1 - v);

    return { x, y, zFrontRim, zInnerBowl, zOuterBack };
  }

  _buildEars() {
    const sides = [-1, 1];
    for (let si = 0; si < sides.length; si++) {
      const side = sides[si];
      const pivot = new THREE.Group();
      pivot.name = side === -1 ? 'LeftCatEar' : 'RightCatEar';
      pivot.position.set(side * 0.238, 0, 0);
      const baseRot = new THREE.Euler(0.1, side * -0.22, side * -0.45, 'YXZ');
      pivot.rotation.copy(baseRot);

      const outerGeo = this._createOuterEarShellGeometry(side);
      const outerShellMesh = new THREE.Mesh(outerGeo, this.outerShellMaterial);
      pivot.add(outerShellMesh);
      this.disposableGeometries.push(outerGeo);

      const innerGeo = this._createInnerEarBowlGeometry(side);
      const innerBowlMesh = new THREE.Mesh(innerGeo, this.innerBowlMaterial);
      pivot.add(innerBowlMesh);
      this.disposableGeometries.push(innerGeo);

      const outerMeta = this._generateOuterFurInstances(side, this.outerMaxCount);
      const outerFurMesh = new THREE.InstancedMesh(this.outerStrandGeo, this.outerFurMaterial, this.outerMaxCount);
      outerFurMesh.frustumCulled = false;
      this._uploadStrandMatrices(outerFurMesh, outerMeta, 1.0);
      pivot.add(outerFurMesh);

      const tuftMeta = this._generateInnerTuftInstances(side, this.tuftMaxCount);
      const innerTuftsMesh = new THREE.InstancedMesh(this.tuftStrandGeo, this.innerTuftMaterial, this.tuftMaxCount);
      innerTuftsMesh.frustumCulled = false;
      this._uploadStrandMatrices(innerTuftsMesh, tuftMeta, this.tuftLength);
      pivot.add(innerTuftsMesh);

      const lynxMeta = this._generateLynxTipInstances(side, this.lynxMaxCount);
      const lynxTipsMesh = new THREE.InstancedMesh(this.lynxStrandGeo, this.lynxTipMaterial, this.lynxMaxCount);
      lynxTipsMesh.frustumCulled = false;
      this._uploadStrandMatrices(lynxTipsMesh, lynxMeta, 1.0);
      pivot.add(lynxTipsMesh);

      this.earsGroup.add(pivot);

      this.ears.push({
        side,
        pivot,
        baseRot,
        outerShellMesh,
        innerBowlMesh,
        outerFurMesh,
        innerTuftsMesh,
        lynxTipsMesh,
        outerMeta,
        tuftMeta,
        lynxMeta,
        spring: {
          pitch: 0,
          pitchVel: 0,
          roll: 0,
          rollVel: 0,
          yaw: 0,
          yawVel: 0,
          twitchTime: 0,
          twitchDuration: 0.35,
          twitchAmp: 0.25,
          twitchDouble: false,
        },
      });
    }
  }

  _createOuterEarShellGeometry(side) {
    const segU = 36;
    const segV = 28;
    const positions = [];
    const uvs = [];
    const indices = [];

    for (let iv = 0; iv <= segV; iv++) {
      const v = iv / segV;
      for (let iu = 0; iu <= segU; iu++) {
        const s = iu / segU;
        let u;
        let z;

        if (s < 0.14) {
          const k = s / 0.14;
          const rimWidth = 0.22 + 0.1 * (1 - v);
          u = -1 + rimWidth * (1 - k);
          const f = this._evalEarFrame(u, v, side);
          const rimLift = Math.sin(k * Math.PI * 0.5) * 0.011 * (1 - 0.5 * v);
          z = THREE.MathUtils.lerp(f.zInnerBowl, f.zFrontRim, Math.pow(k, 0.7)) + rimLift;
        } else if (s <= 0.86) {
          const k = (s - 0.14) / 0.72;
          u = -1 + 2 * k;
          const f = this._evalEarFrame(u, v, side);
          const edgeBlend = Math.sin(k * Math.PI);
          z = THREE.MathUtils.lerp(f.zFrontRim - 0.004, f.zOuterBack, Math.pow(edgeBlend, 0.62));
        } else {
          const k = (s - 0.86) / 0.14;
          const rimWidth = 0.24 + 0.1 * (1 - v);
          u = 1 - rimWidth * k;
          const f = this._evalEarFrame(u, v, side);
          const rimLift = Math.sin((1 - k) * Math.PI * 0.5) * 0.012 * (1 - 0.5 * v);
          z = THREE.MathUtils.lerp(f.zFrontRim, f.zInnerBowl, Math.pow(k, 1.2)) + rimLift;
        }

        const f = this._evalEarFrame(u, v, side);
        const apexPin = v === 1 ? 0 : 1;
        const px = apexPin ? f.x : this._evalEarFrame(0, 1, side).x;
        const py = apexPin ? f.y : this._evalEarFrame(0, 1, side).y;
        const pz = apexPin ? z : this._evalEarFrame(0, 1, side).zFrontRim - 0.006;

        positions.push(px, py, pz);
        uvs.push(s, v);
      }
    }

    const row = segU + 1;
    for (let iv = 0; iv < segV; iv++) {
      for (let iu = 0; iu < segU; iu++) {
        const a = iv * row + iu;
        const b = a + 1;
        const c = a + row;
        const d = c + 1;

        if (side === 1) {
          indices.push(a, c, b);
          indices.push(b, c, d);
        } else {
          indices.push(a, b, c);
          indices.push(b, d, c);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  _createInnerEarBowlGeometry(side) {
    const segU = 22;
    const segV = 22;
    const positions = [];
    const uvs = [];
    const indices = [];

    for (let iv = 0; iv <= segV; iv++) {
      const vn = iv / segV;
      const v = 0.03 + vn * 0.87;
      const uMin = -1 + (0.21 + 0.095 * (1 - v));
      const uMax = 1 - (0.23 + 0.095 * (1 - v));

      for (let iu = 0; iu <= segU; iu++) {
        const un = iu / segU;
        const u = uMin + (uMax - uMin) * un;
        const f = this._evalEarFrame(u, v, side);

        const centerU = (un - 0.5) * 2;
        const scaphaRidge = Math.sin(vn * Math.PI * 2.1) * 0.004 * (1 - centerU * centerU);
        const z = f.zInnerBowl + scaphaRidge;

        positions.push(f.x, f.y, z);
        uvs.push(un, vn);
      }
    }

    const row = segU + 1;
    for (let iv = 0; iv < segV; iv++) {
      for (let iu = 0; iu < segU; iu++) {
        const a = iv * row + iu;
        const b = a + 1;
        const c = a + row;
        const d = c + 1;

        if (side === 1) {
          indices.push(a, b, c);
          indices.push(b, d, c);
        } else {
          indices.push(a, c, b);
          indices.push(b, c, d);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  _generateOuterFurInstances(side, count) {
    const rand = seededRandom(side === -1 ? 104729 : 224737);
    const meta = [];

    const p = new THREE.Vector3();
    const pUp = new THREE.Vector3();
    const pSide = new THREE.Vector3();
    const tangentUp = new THREE.Vector3();
    const tangentSide = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const upAxis = new THREE.Vector3(0, 1, 0);
    const qAlign = new THREE.Quaternion();
    const qSpin = new THREE.Quaternion();
    const rotMat = new THREE.Matrix4();

    const sampleShell = (s, v, out) => {
      let u;
      let z;
      let isFrontRim = false;

      if (s < 0.16) {
        isFrontRim = true;
        const k = s / 0.16;
        const rimWidth = 0.22 + 0.1 * (1 - v);
        u = -1 + rimWidth * (1 - k);
        const f = this._evalEarFrame(u, v, side);
        z = THREE.MathUtils.lerp(f.zInnerBowl, f.zFrontRim, Math.pow(k, 0.7)) + Math.sin(k * Math.PI * 0.5) * 0.011 * (1 - 0.5 * v);
      } else if (s <= 0.84) {
        const k = (s - 0.16) / 0.68;
        u = -1 + 2 * k;
        const f = this._evalEarFrame(u, v, side);
        const edgeBlend = Math.sin(k * Math.PI);
        z = THREE.MathUtils.lerp(f.zFrontRim - 0.004, f.zOuterBack, Math.pow(edgeBlend, 0.62));
      } else {
        isFrontRim = true;
        const k = (s - 0.84) / 0.16;
        const rimWidth = 0.24 + 0.1 * (1 - v);
        u = 1 - rimWidth * k;
        const f = this._evalEarFrame(u, v, side);
        z = THREE.MathUtils.lerp(f.zFrontRim, f.zInnerBowl, Math.pow(k, 1.2)) + Math.sin((1 - k) * Math.PI * 0.5) * 0.012 * (1 - 0.5 * v);
      }

      const f = this._evalEarFrame(u, v, side);
      out.set(f.x, f.y, z);
      return { u, isFrontRim };
    };

    const phi = 0.61803398875;
    for (let i = 0; i < count; i++) {
      const h1 = (i * 0.7548776662 + rand() * 0.04) % 1;
      const h2 = (i * 0.5698402909 + rand() * 0.04) % 1;

      let s = h1;
      if (i % 5 === 0) {
        s = rand() < 0.5 ? rand() * 0.22 : 0.78 + rand() * 0.22;
      }
      const v = clamp(0.02 + Math.pow(h2, 0.82) * 0.94, 0.02, 0.96);

      const { u, isFrontRim } = sampleShell(s, v, p);
      sampleShell(s, Math.min(0.99, v + 0.015), pUp);
      sampleShell(Math.min(0.995, s + 0.012), v, pSide);

      tangentUp.subVectors(pUp, p).normalize();
      tangentSide.subVectors(pSide, p).normalize();
      if (side === 1) {
        normal.crossVectors(tangentUp, tangentSide).normalize();
      } else {
        normal.crossVectors(tangentSide, tangentUp).normalize();
      }

      const liftAngle = isFrontRim ? 0.34 + rand() * 0.18 : 0.24 + rand() * 0.22;
      dir
        .copy(tangentUp)
        .multiplyScalar(Math.cos(liftAngle))
        .addScaledVector(normal, Math.sin(liftAngle))
        .addScaledVector(tangentSide, (rand() - 0.5) * 0.22)
        .normalize();

      const xAxis = new THREE.Vector3().crossVectors(dir, normal).normalize();
      if (xAxis.lengthSq() < 0.001) xAxis.set(1, 0, 0);
      const zAxis = new THREE.Vector3().crossVectors(xAxis, dir).normalize();
      rotMat.makeBasis(xAxis, dir, zAxis);
      qAlign.setFromRotationMatrix(rotMat);
      qSpin.setFromAxisAngle(upAxis, (rand() - 0.5) * 0.45);
      qAlign.multiply(qSpin);

      const edgeFactor = clamp(Math.pow(Math.abs(u), 1.8) * 0.75 + (isFrontRim ? 0.35 : 0) + Math.pow(v, 2.5) * 0.35, 0, 1);
      const lengthMult = (0.76 + rand() * 0.52) * (1.16 - 0.42 * v) * (isFrontRim ? 1.15 : 1.0);
      const widthMult = (0.78 + rand() * 0.44) * (1.08 - 0.28 * v);
      const pos = p.clone().addScaledVector(normal, -0.0025);

      meta.push({
        pos,
        quat: qAlign.clone(),
        scaleX: widthMult,
        scaleY: lengthMult,
        scaleZ: widthMult,
        u,
        v,
        edgeFactor,
        seed: (i * phi) % 1,
      });
    }

    return meta;
  }

  _generateInnerTuftInstances(side, count) {
    const rand = seededRandom(side === -1 ? 331991 : 449117);
    const meta = [];

    const dir = new THREE.Vector3();
    const xAxis = new THREE.Vector3();
    const zAxis = new THREE.Vector3();
    const rotMat = new THREE.Matrix4();
    const qAlign = new THREE.Quaternion();

    for (let i = 0; i < count; i++) {
      const h1 = (i * 0.7548776662 + rand() * 0.05) % 1;
      const h2 = (i * 0.5698402909 + rand() * 0.05) % 1;

      let u;
      let v;
      let sweepX;
      let sweepY;
      let sweepZ;
      let tuftScale;

      if (h1 < 0.65) {
        const k = h1 / 0.65;
        v = 0.05 + k * 0.56 + (rand() - 0.5) * 0.04;
        u = -0.82 + h2 * 0.26;
        sweepX = side * (0.76 + rand() * 0.34);
        sweepY = 0.42 + rand() * 0.38 - k * 0.14;
        sweepZ = 0.22 + rand() * 0.25;
        tuftScale = (0.78 + rand() * 0.55) * (1.12 - k * 0.42);
      } else if (h1 < 0.9) {
        const k = (h1 - 0.65) / 0.25;
        v = 0.03 + h2 * 0.18;
        u = -0.68 + k * 1.28;
        sweepX = side * (-u * 0.35 + (rand() - 0.5) * 0.35);
        sweepY = 0.85 + rand() * 0.32;
        sweepZ = 0.26 + rand() * 0.26;
        tuftScale = 0.75 + rand() * 0.48;
      } else {
        const k = (h1 - 0.9) / 0.1;
        v = 0.08 + k * 0.36;
        u = 0.58 + h2 * 0.24;
        sweepX = -side * (0.65 + rand() * 0.32);
        sweepY = 0.55 + rand() * 0.32;
        sweepZ = 0.25 + rand() * 0.22;
        tuftScale = 0.58 + rand() * 0.36;
      }

      const f = this._evalEarFrame(u, v, side);
      const pos = new THREE.Vector3(f.x, f.y, f.zInnerBowl + 0.002 + rand() * 0.006);

      dir.set(sweepX, sweepY, sweepZ).normalize();
      const refHint = new THREE.Vector3(0, 0.25, -1).normalize();
      xAxis.crossVectors(dir, refHint).normalize();
      if (xAxis.lengthSq() < 0.001) xAxis.set(1, 0, 0);
      zAxis.crossVectors(xAxis, dir).normalize();
      rotMat.makeBasis(xAxis, dir, zAxis);
      qAlign.setFromRotationMatrix(rotMat);

      const widthMult = 0.72 + rand() * 0.45;
      meta.push({
        pos,
        quat: qAlign.clone(),
        scaleX: widthMult,
        scaleY: tuftScale,
        scaleZ: widthMult,
        u,
        v,
        edgeFactor: 0,
        seed: rand(),
      });
    }

    return meta;
  }

  _generateLynxTipInstances(side, count) {
    const rand = seededRandom(side === -1 ? 77101 : 88213);
    const meta = [];

    const apex = this._evalEarFrame(0, 1, side);
    const apexTarget = new THREE.Vector3(apex.x + side * 0.015, apex.y + 0.068, apex.zFrontRim + 0.008);
    const dir = new THREE.Vector3();
    const xAxis = new THREE.Vector3();
    const zAxis = new THREE.Vector3();
    const rotMat = new THREE.Matrix4();
    const qAlign = new THREE.Quaternion();

    for (let i = 0; i < count; i++) {
      const h1 = (i * 0.7548776662 + rand() * 0.04) % 1;
      const h2 = (i * 0.5698402909 + rand() * 0.04) % 1;

      const v = 0.87 + h1 * 0.13;
      const u = (h2 - 0.5) * 1.15 * (1 - (v - 0.87) * 4.5);
      const f = this._evalEarFrame(clamp(u, -0.92, 0.92), v, side);

      const zBackMix = rand();
      const zPos = THREE.MathUtils.lerp(f.zFrontRim - 0.004, f.zOuterBack + 0.003, zBackMix);
      const pos = new THREE.Vector3(f.x, f.y, zPos);

      dir
        .subVectors(apexTarget, pos)
        .add(new THREE.Vector3((rand() - 0.5) * 0.018, rand() * 0.014, (rand() - 0.5) * 0.016))
        .normalize();

      const hint = new THREE.Vector3(0, 0, 1);
      xAxis.crossVectors(dir, hint).normalize();
      if (xAxis.lengthSq() < 0.001) xAxis.set(1, 0, 0);
      zAxis.crossVectors(xAxis, dir).normalize();
      rotMat.makeBasis(xAxis, dir, zAxis);
      qAlign.setFromRotationMatrix(rotMat);

      const centerFactor = 1 - Math.min(1, Math.abs(u) * 1.1);
      const lengthMult = (0.62 + centerFactor * 0.65) * (0.82 + rand() * 0.38);
      const widthMult = 0.75 + rand() * 0.35;

      meta.push({
        pos,
        quat: qAlign.clone(),
        scaleX: widthMult,
        scaleY: lengthMult,
        scaleZ: widthMult,
        u,
        v,
        edgeFactor: 1,
        seed: rand(),
      });
    }

    return meta;
  }

  _uploadStrandMatrices(mesh, meta, lengthMultiplier) {
    for (let i = 0; i < meta.length; i++) {
      const m = meta[i];
      _dummyObj.position.copy(m.pos);
      _dummyObj.quaternion.copy(m.quat);
      _dummyObj.scale.set(m.scaleX, m.scaleY * lengthMultiplier, m.scaleZ * (0.82 + 0.18 * lengthMultiplier));
      _dummyObj.updateMatrix();
      mesh.setMatrixAt(i, _dummyObj.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }

  _applyFurDensity() {
    const outerCount = Math.min(this.outerMaxCount, Math.round(this.outerBaseCount * this.furDensity));
    const tuftCount = Math.min(this.tuftMaxCount, Math.round(this.tuftBaseCount * this.furDensity));
    const lynxCount = Math.min(this.lynxMaxCount, Math.round(this.lynxBaseCount * this.furDensity));

    for (let i = 0; i < this.ears.length; i++) {
      const ear = this.ears[i];
      ear.outerFurMesh.count = outerCount;
      ear.innerTuftsMesh.count = tuftCount;
      ear.lynxTipsMesh.count = lynxCount;
    }
  }

  _applyTuftLength() {
    for (let i = 0; i < this.ears.length; i++) {
      const ear = this.ears[i];
      this._uploadStrandMatrices(ear.innerTuftsMesh, ear.tuftMeta, this.tuftLength);
    }
  }

  _applyFurColors() {
    const palette = FUR_PALETTES[this.furTone];
    _cBase.set(palette.baseHex);
    _cMid.set(palette.midHex);
    _cRim.set(palette.rimDarkHex);
    _cTip.set(palette.tipShadeHex);
    _cTuft.set(palette.tuftHex);
    _cLynx.set(palette.lynxTipHex);

    for (let ei = 0; ei < this.ears.length; ei++) {
      const ear = this.ears[ei];

      for (let i = 0; i < ear.outerMeta.length; i++) {
        const m = ear.outerMeta[i];
        _tmpColor.copy(_cBase);
        const rimBlend = clamp(m.edgeFactor * 0.62 + Math.pow(m.v, 2.2) * 0.35, 0, 0.85);
        _tmpColor.lerp(_cMid, m.v * 0.45);
        _tmpColor.lerp(_cRim, rimBlend * (0.55 + m.seed * 0.35));
        _tmpColor.offsetHSL(0, 0, (m.seed - 0.5) * 0.065);
        ear.outerFurMesh.setColorAt(i, _tmpColor);
      }
      if (ear.outerFurMesh.instanceColor) {
        ear.outerFurMesh.instanceColor.needsUpdate = true;
      }

      for (let i = 0; i < ear.tuftMeta.length; i++) {
        const m = ear.tuftMeta[i];
        _tmpColor.copy(_cTuft);
        _tmpColor.offsetHSL(0, 0, (m.seed - 0.5) * 0.05);
        ear.innerTuftsMesh.setColorAt(i, _tmpColor);
      }
      if (ear.innerTuftsMesh.instanceColor) {
        ear.innerTuftsMesh.instanceColor.needsUpdate = true;
      }

      for (let i = 0; i < ear.lynxMeta.length; i++) {
        const m = ear.lynxMeta[i];
        _tmpColor.copy(_cLynx).lerp(_cTip, m.seed * 0.45);
        _tmpColor.offsetHSL(0, 0, (m.seed - 0.5) * 0.05);
        ear.lynxTipsMesh.setColorAt(i, _tmpColor);
      }
      if (ear.lynxTipsMesh.instanceColor) {
        ear.lynxTipsMesh.instanceColor.needsUpdate = true;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Sculpted 3D Cat Nose (Clearcoat 0.4, Roughness 0.35, Philtrum Groove)
  // ---------------------------------------------------------------------------

  _buildNose() {
    this.noseGroup = new THREE.Group();
    this.noseGroup.name = 'CatNose';
    this.noseGroup.position.copy(FILTER_NOSE_LOCAL);

    const noseGeo = this._createSculptedCatNoseGeometry();
    const noseMesh = new THREE.Mesh(noseGeo, this.noseMaterial);
    this.noseGroup.add(noseMesh);
    this.disposableGeometries.push(noseGeo);

    const nostrilMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#6b2d3b'),
      roughness: 0.72,
      metalness: 0.0,
    });
    this.disposableMaterials.push(nostrilMat);

    const nostrilGeo = new THREE.SphereGeometry(0.011, 14, 10);
    this.disposableGeometries.push(nostrilGeo);

    const sides = [-1, 1];
    for (let i = 0; i < sides.length; i++) {
      const side = sides[i];
      const nostril = new THREE.Mesh(nostrilGeo, nostrilMat);
      nostril.scale.set(1.15, 0.52, 0.65);
      nostril.position.set(side * 0.025, -0.005, 0.023);
      nostril.rotation.set(0.18, side * 0.48, side * -0.42);
      this.noseGroup.add(nostril);
    }

    this.noseWhiskersGroup.add(this.noseGroup);
  }

  _createSculptedCatNoseGeometry() {
    const geo = new THREE.SphereGeometry(1, 44, 32);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const v = new THREE.Vector3();

    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const nx = v.x;
      const ny = v.y;
      const nz = v.z;

      const topWide = 0.062;
      const bottomNarrow = 0.017;
      const yNorm = clamp((ny + 1) * 0.5, 0, 1);
      const widthAtY = THREE.MathUtils.lerp(bottomNarrow, topWide, Math.pow(yNorm, 0.58));

      const topDip = Math.max(0, ny) * Math.exp(-nx * nx * 6.5) * 0.005;
      const x = nx * widthAtY;
      let y = ny * 0.042 - topDip;
      let z = nz * 0.032;

      if (nz < 0) {
        z *= 0.62;
      }

      if (nz > 0) {
        const centerBand = Math.exp(-nx * nx * 36.0);
        const lowerBand = smoothstep(0.18, -0.82, ny);
        const grooveDepth = 0.0085 * centerBand * lowerBand * nz;
        z -= grooveDepth;
        y += grooveDepth * 0.25;

        const nostrilDistL = Math.hypot((nx + 0.44) * 1.4, (ny + 0.14) * 2.2);
        const nostrilDistR = Math.hypot((nx - 0.44) * 1.4, (ny + 0.14) * 2.2);
        const nostrilIndent =
          (Math.exp(-nostrilDistL * nostrilDistL * 6.5) + Math.exp(-nostrilDistR * nostrilDistR * 6.5)) *
          0.0075 *
          nz;
        z -= nostrilIndent;
      }

      z += 0.005 * (1 - nx * nx) * Math.max(0, nz);

      pos.setXYZ(i, x, y, z);
      uv.setXY(i, clamp(x / (topWide * 2) + 0.5, 0, 1), clamp(y / 0.088 + 0.5, 0, 1));
    }

    geo.computeVertexNormals();
    return geo;
  }

  // ---------------------------------------------------------------------------
  // 6 Tapered 3D Whiskers + Soft Follicle Dots
  // ---------------------------------------------------------------------------

  _buildWhiskers() {
    const follicleGeo = new THREE.CircleGeometry(0.011, 16);
    this.disposableGeometries.push(follicleGeo);

    const rowConfigs = [
      {
        rootOffset: new THREE.Vector3(0.098, -0.022, 0.408),
        length: 0.41,
        angleY: 0.21,
        backSweep: -0.175,
        droop: -0.025,
        rStart: 0.0046,
        rEnd: 0.00065,
      },
      {
        rootOffset: new THREE.Vector3(0.106, -0.047, 0.412),
        length: 0.47,
        angleY: -0.02,
        backSweep: -0.205,
        droop: -0.032,
        rStart: 0.0052,
        rEnd: 0.0007,
      },
      {
        rootOffset: new THREE.Vector3(0.098, -0.072, 0.404),
        length: 0.44,
        angleY: -0.26,
        backSweep: -0.185,
        droop: -0.038,
        rStart: 0.0048,
        rEnd: 0.00065,
      },
    ];

    const sides = [-1, 1];
    for (let si = 0; si < sides.length; si++) {
      const side = sides[si];
      const sideGroup = new THREE.Group();
      sideGroup.name = side === -1 ? 'LeftWhiskers' : 'RightWhiskers';
      const pivots = [];
      const baseRots = [];

      for (let i = 0; i < rowConfigs.length; i++) {
        const cfg = rowConfigs[i];
        const rootPos = new THREE.Vector3(side * cfg.rootOffset.x, cfg.rootOffset.y, cfg.rootOffset.z);

        const dot = new THREE.Mesh(follicleGeo, this.follicleMaterial);
        dot.position.copy(rootPos).add(new THREE.Vector3(side * -0.002, 0, -0.002));
        dot.rotation.set(0.05, side * 0.38, 0);
        sideGroup.add(dot);

        if (i < 2) {
          const microDot = new THREE.Mesh(follicleGeo, this.follicleMaterial);
          microDot.scale.setScalar(0.62);
          microDot.position.set(
            side * (cfg.rootOffset.x - 0.022),
            cfg.rootOffset.y - 0.012,
            cfg.rootOffset.z + 0.008
          );
          microDot.rotation.set(0.04, side * 0.28, 0);
          sideGroup.add(microDot);
        }

        const wPivot = new THREE.Group();
        wPivot.position.copy(rootPos);
        const baseRot = new THREE.Euler(0, 0, 0, 'YXZ');
        wPivot.rotation.copy(baseRot);

        const cosA = Math.cos(cfg.angleY);
        const sinA = Math.sin(cfg.angleY);
        const L = cfg.length;

        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(side * L * 0.34 * cosA, L * 0.34 * sinA + 0.004, cfg.backSweep * 0.22),
          new THREE.Vector3(side * L * 0.7 * cosA, L * 0.7 * sinA + cfg.droop * 0.42, cfg.backSweep * 0.62),
          new THREE.Vector3(side * L * cosA, L * sinA + cfg.droop, cfg.backSweep),
        ]);

        const tubeGeo = this._createTaperedTubeGeometry(curve, 26, 8, cfg.rStart, cfg.rEnd);
        const whiskerMesh = new THREE.Mesh(tubeGeo, this.whiskerMaterial);
        wPivot.add(whiskerMesh);
        this.disposableGeometries.push(tubeGeo);

        sideGroup.add(wPivot);
        pivots.push(wPivot);
        baseRots.push(baseRot);
      }

      this.noseWhiskersGroup.add(sideGroup);
      this.whiskers.push({
        side,
        group: sideGroup,
        pivots,
        baseRots,
        flexY: 0,
        flexYVel: 0,
        flexZ: 0,
        flexZVel: 0,
      });
    }
  }

  _createTaperedTubeGeometry(curve, tubularSegments, radialSegments, radiusStart, radiusEnd) {
    const frames = curve.computeFrenetFrames(tubularSegments, false);
    const positions = [];
    const normals = [];
    const uvs = [];
    const indices = [];

    const P = new THREE.Vector3();
    const N = new THREE.Vector3();
    const vertex = new THREE.Vector3();

    for (let i = 0; i <= tubularSegments; i++) {
      const t = i / tubularSegments;
      curve.getPointAt(t, P);

      const radius = THREE.MathUtils.lerp(radiusStart, radiusEnd, Math.pow(t, 0.72));
      const normal = frames.normals[i];
      const binormal = frames.binormals[i];

      for (let j = 0; j <= radialSegments; j++) {
        const v = (j / radialSegments) * Math.PI * 2;
        const sin = Math.sin(v);
        const cos = -Math.cos(v);

        N.x = cos * normal.x + sin * binormal.x;
        N.y = cos * normal.y + sin * binormal.y;
        N.z = cos * normal.z + sin * binormal.z;
        N.normalize();

        vertex.x = P.x + radius * N.x;
        vertex.y = P.y + radius * N.y;
        vertex.z = P.z + radius * N.z;

        positions.push(vertex.x, vertex.y, vertex.z);
        normals.push(N.x, N.y, N.z);
        uvs.push(t, j / radialSegments);
      }
    }

    const ringStride = radialSegments + 1;
    for (let i = 0; i < tubularSegments; i++) {
      for (let j = 0; j < radialSegments; j++) {
        const a = i * ringStride + j;
        const b = (i + 1) * ringStride + j;
        const c = (i + 1) * ringStride + (j + 1);
        const d = i * ringStride + (j + 1);
        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    return geo;
  }
}

if (typeof window !== 'undefined') {
  window.CatFurFilter3D = CatFurFilter3D;
}

export { CatFurFilter3D };
export default CatFurFilter3D;
