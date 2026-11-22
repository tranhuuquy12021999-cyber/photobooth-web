import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js';

/**
 * RainbowEarsFilter3D — Standalone 3D Face Filter for Static HTML Photobooths (GitHub Pages)
 * Baked default parameters exported from Rainbow Ears 3D Filter Studio:
 *   earHeight    : 0.26 (* faceHeight)
 *   earScale     : 0.65 (65%)
 *   blushOpacity : 0.42 (42%)
 *   cheekHeight  : -0.02 (* faceHeight)
 *
 * Usage:
 *   import RainbowEarsFilter3D from './rainbow_ears_3d.js';
 *   const filter = new RainbowEarsFilter3D(canvasElement);
 *   // Inside your face tracking loop:
 *   filter.update(landmarks, canvasWidth, canvasHeight, true);
 */

const DEFAULT_OPTIONS = {
  earHeight: 0.26,
  earScale: 0.65,
  blushOpacity: 0.42,
  cheekHeight: -0.02,
  earSpacing: 0.32,
  earBackOffset: 0.12,
  cheekSpacing: 0.29,
  cheekBackOffset: 0.085,
};

function createPastelRainbowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    // Outer arc (top, v=1) -> Inner arc (bottom, v=0): violet -> blue -> green -> yellow -> orange -> pink
    grad.addColorStop(0.0, '#a682ff');
    grad.addColorStop(0.11, '#b695ff');
    grad.addColorStop(0.24, '#7acbff');
    grad.addColorStop(0.41, '#8beaa6');
    grad.addColorStop(0.58, '#fff085');
    grad.addColorStop(0.75, '#ffbe82');
    grad.addColorStop(0.9, '#ff94b2');
    grad.addColorStop(1.0, '#ff85a8');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function createDiffusedBlushTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    const cx = size * 0.5;
    const cy = size * 0.5;
    const radius = size * 0.46;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1.0, 0.82);

    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    grad.addColorStop(0.0, 'rgba(255, 112, 146, 1.0)');
    grad.addColorStop(0.22, 'rgba(255, 122, 152, 0.82)');
    grad.addColorStop(0.44, 'rgba(255, 134, 160, 0.44)');
    grad.addColorStop(0.66, 'rgba(255, 146, 168, 0.14)');
    grad.addColorStop(0.84, 'rgba(255, 154, 174, 0.02)');
    grad.addColorStop(1.0, 'rgba(255, 158, 178, 0.0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function createRainbowArchGeometry() {
  const uSteps = 56;
  const phiSteps = 28;
  const rx = 0.245;
  const ry = 0.248;
  const halfBandWidth = 0.092;
  const halfBandDepth = 0.044;

  const positions = [];
  const uvs = [];
  const indices = [];

  const spinePoint = new THREE.Vector3();
  const nextPoint = new THREE.Vector3();
  const prevPoint = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const radialOut = new THREE.Vector3();

  const evalSpine = (u, out) => {
    const theta = u * Math.PI;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    out.set(-cosT * rx, sinT * ry + 0.032 * sinT * sinT, -0.022 * sinT);
  };

  for (let i = 0; i <= uSteps; i++) {
    const u = i / uSteps;
    evalSpine(u, spinePoint);
    evalSpine(Math.min(1, u + 0.002), nextPoint);
    evalSpine(Math.max(0, u - 0.002), prevPoint);

    tangent.subVectors(nextPoint, prevPoint).normalize();
    radialOut.set(-tangent.y, tangent.x, 0).normalize();
    if (radialOut.y < -0.5 && u > 0.15 && u < 0.85) {
      radialOut.negate();
    }

    const endFactor = Math.sin(u * Math.PI);
    const widthScale = 0.9 + 0.12 * Math.pow(endFactor, 0.35);
    const depthScale = 0.86 + 0.16 * Math.pow(endFactor, 0.35);

    for (let j = 0; j <= phiSteps; j++) {
      const phi = (j / phiSteps) * Math.PI * 2;
      const cosP = Math.cos(phi);
      const sinP = Math.sin(phi);

      const rOff = cosP * halfBandWidth * widthScale;
      const zOff = sinP * halfBandDepth * depthScale;

      positions.push(
        spinePoint.x + radialOut.x * rOff,
        spinePoint.y + radialOut.y * rOff,
        spinePoint.z + zOff
      );
      uvs.push(u, cosP * 0.5 + 0.5);
    }
  }

  const stride = phiSteps + 1;
  for (let i = 0; i < uSteps; i++) {
    for (let j = 0; j < phiSteps; j++) {
      const a = i * stride + j;
      const b = (i + 1) * stride + j;
      const c = (i + 1) * stride + (j + 1);
      const d = i * stride + (j + 1);
      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createFluffyCloudGroup(cloudMat, outlineMat, curlMat, sphereGeo, mirrorCurl) {
  const cloud = new THREE.Group();
  const puffs = [
    { x: 0.0, y: 0.022, z: 0.0, sx: 0.074, sy: 0.068, sz: 0.064 },
    { x: -0.056, y: 0.005, z: 0.004, sx: 0.058, sy: 0.054, sz: 0.054 },
    { x: 0.058, y: 0.004, z: 0.004, sx: 0.056, sy: 0.052, sz: 0.054 },
    { x: -0.088, y: -0.024, z: -0.002, sx: 0.044, sy: 0.039, sz: 0.044 },
    { x: 0.086, y: -0.022, z: -0.002, sx: 0.045, sy: 0.04, sz: 0.044 },
    { x: -0.026, y: -0.028, z: 0.008, sx: 0.055, sy: 0.042, sz: 0.052 },
    { x: 0.03, y: -0.028, z: 0.008, sx: 0.054, sy: 0.042, sz: 0.052 },
  ];

  const outlineExpand = 0.0115;

  for (let i = 0; i < puffs.length; i++) {
    const p = puffs[i];
    const whiteMesh = new THREE.Mesh(sphereGeo, cloudMat);
    whiteMesh.position.set(p.x, p.y, p.z);
    whiteMesh.scale.set(p.sx, p.sy, p.sz);
    cloud.add(whiteMesh);

    const outlineMesh = new THREE.Mesh(sphereGeo, outlineMat);
    outlineMesh.position.set(p.x, p.y, p.z);
    outlineMesh.scale.set(p.sx + outlineExpand, p.sy + outlineExpand, p.sz + outlineExpand);
    cloud.add(outlineMesh);
  }

  const createCloudCurl = (cx, cy, cz, rScale, flipX) => {
    const pts = [];
    const steps = 18;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = t * Math.PI * 2.15 + 0.5;
      const r = (0.004 + 0.015 * t) * rScale;
      pts.push(
        new THREE.Vector3(
          cx + Math.cos(angle) * r * flipX,
          cy + Math.sin(angle) * r * 0.85,
          cz + Math.cos(t * Math.PI * 0.5) * 0.003
        )
      );
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tubeGeo = new THREE.TubeGeometry(curve, 20, 0.0034, 8, false);
    return new THREE.Mesh(tubeGeo, curlMat);
  };

  cloud.add(createCloudCurl(0.036 * mirrorCurl, 0.012, 0.056, 1.0, mirrorCurl));
  cloud.add(createCloudCurl(-0.044 * mirrorCurl, -0.014, 0.052, 0.78, -mirrorCurl));

  return cloud;
}

function createCurvedCheekBlushGeometry() {
  const geo = new THREE.PlaneGeometry(0.28, 0.22, 16, 16);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setZ(i, -(x * x * 1.15 + y * y * 0.75));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function createCheekSpiralGroup(side, spiralMat) {
  const group = new THREE.Group();
  const points = [];
  const totalSteps = 56;
  const totalTurns = 1.95;
  const maxRadius = 0.054;
  const tubeRadius = 0.0068;

  for (let i = 0; i <= totalSteps; i++) {
    const t = i / totalSteps;
    const angle = t * Math.PI * 2 * totalTurns + 0.35;
    const r = maxRadius * (0.08 + 0.92 * Math.pow(t, 0.92));

    const lx = Math.cos(angle) * r * 1.24 * side;
    const ly = Math.sin(angle) * r * 0.86;
    const lz = -(lx * lx * 1.15 + ly * ly * 0.75) + 0.018;
    points.push(new THREE.Vector3(lx, ly, lz));
  }

  const curve = new THREE.CatmullRomCurve3(points);
  const tubeGeo = new THREE.TubeGeometry(curve, 64, tubeRadius, 12, false);
  const tubeMesh = new THREE.Mesh(tubeGeo, spiralMat);
  tubeMesh.renderOrder = 12;
  group.add(tubeMesh);

  const capGeo = new THREE.SphereGeometry(tubeRadius, 12, 12);
  const startCap = new THREE.Mesh(capGeo, spiralMat);
  startCap.position.copy(points[0]);
  startCap.renderOrder = 12;
  group.add(startCap);

  const endCap = new THREE.Mesh(capGeo, spiralMat);
  endCap.position.copy(points[points.length - 1]);
  endCap.renderOrder = 12;
  group.add(endCap);

  return group;
}

class RainbowEarsFilter3D {
  constructor(canvas, options = {}) {
    if (!canvas) {
      throw new Error('RainbowEarsFilter3D requires a valid HTMLCanvasElement.');
    }

    this.options = Object.assign({}, DEFAULT_OPTIONS, options);
    this.canvas = canvas;
    this.currentWidth = 0;
    this.currentHeight = 0;

    // Renderer configured for transparent overlay & clean canvas snapshots
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
    this.renderer.toneMappingExposure = 1.06;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-320, 320, 240, -240, -3000, 3000);
    this.camera.position.set(0, 0, 1000);

    // Balanced soft lighting rig
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0xe8e4f5, 1.35);
    const keyLight = new THREE.DirectionalLight(0xfffaf2, 0.95);
    keyLight.position.set(220, 340, 480);
    const rimLight = new THREE.DirectionalLight(0xeef5ff, 0.55);
    rimLight.position.set(-260, 180, -220);
    this.scene.add(hemiLight, keyLight, rimLight);

    this.rootGroup = new THREE.Group();
    this.rootGroup.visible = false;
    this.scene.add(this.rootGroup);

    this._textures = [];
    this._geometries = [];
    this._materials = [];

    const rainbowTex = createPastelRainbowTexture();
    const blushTex = createDiffusedBlushTexture();
    this._textures.push(rainbowTex, blushTex);

    const rainbowMat = new THREE.MeshStandardMaterial({
      map: rainbowTex,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: rainbowTex,
      emissiveIntensity: 0.34,
      roughness: 0.42,
      metalness: 0.02,
      side: THREE.FrontSide,
    });

    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: new THREE.Color(0xf6f8ff),
      emissiveIntensity: 0.26,
      roughness: 0.62,
      metalness: 0.0,
    });

    const cloudOutlineMat = new THREE.MeshBasicMaterial({
      color: 0x1e1d24,
      side: THREE.BackSide,
    });

    const cloudCurlMat = new THREE.MeshBasicMaterial({
      color: 0x24222c,
    });

    this.blushMaterial = new THREE.MeshBasicMaterial({
      map: blushTex,
      transparent: true,
      opacity: this.options.blushOpacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    const spiralMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      toneMapped: false,
    });

    this._materials.push(
      rainbowMat,
      cloudMat,
      cloudOutlineMat,
      cloudCurlMat,
      this.blushMaterial,
      spiralMat
    );

    const rainbowGeo = createRainbowArchGeometry();
    const sphereGeo = new THREE.SphereGeometry(1, 22, 18);
    const blushGeo = createCurvedCheekBlushGeometry();
    this._geometries.push(rainbowGeo, sphereGeo, blushGeo);

    // Cluster 1: Forehead (Rainbow Ears & Clouds)
    this.foreheadCluster = new THREE.Group();
    const buildEarUnit = (side) => {
      const mount = new THREE.Group();
      const springNode = new THREE.Group();
      const earBody = new THREE.Group();
      earBody.position.y = -0.05;
      earBody.rotation.z = side * -0.46;
      earBody.rotation.y = side * -0.14;
      earBody.rotation.x = 0.06;

      const archMesh = new THREE.Mesh(rainbowGeo, rainbowMat);
      earBody.add(archMesh);

      const innerCloud = createFluffyCloudGroup(cloudMat, cloudOutlineMat, cloudCurlMat, sphereGeo, side);
      innerCloud.position.set(-side * 0.24, -0.015, 0.025);
      innerCloud.scale.setScalar(1.12);
      innerCloud.rotation.z = side * 0.22;
      earBody.add(innerCloud);

      const outerCloud = createFluffyCloudGroup(cloudMat, cloudOutlineMat, cloudCurlMat, sphereGeo, -side);
      outerCloud.position.set(side * 0.24, -0.02, 0.025);
      outerCloud.scale.setScalar(1.06);
      outerCloud.rotation.z = side * 0.36;
      earBody.add(outerCloud);

      springNode.add(earBody);
      mount.add(springNode);
      return { mount, springNode };
    };

    const leftEar = buildEarUnit(-1);
    const rightEar = buildEarUnit(1);
    this.leftEarMount = leftEar.mount;
    this.rightEarMount = rightEar.mount;
    this.leftEarSpringNode = leftEar.springNode;
    this.rightEarSpringNode = rightEar.springNode;
    this.foreheadCluster.add(this.leftEarMount, this.rightEarMount);
    this.rootGroup.add(this.foreheadCluster);

    // Cluster 2: Nose (Diffused Blush & White Spirals)
    this.noseCluster = new THREE.Group();
    const buildCheekUnit = (side) => {
      const mount = new THREE.Group();
      mount.rotation.y = side * 0.22;
      mount.rotation.x = 0.04;

      const blushMesh = new THREE.Mesh(blushGeo, this.blushMaterial);
      blushMesh.renderOrder = 6;
      mount.add(blushMesh);

      const spiralGroup = createCheekSpiralGroup(side, spiralMat);
      spiralGroup.position.set(0, -0.008, 0.004);
      mount.add(spiralGroup);

      return mount;
    };

    this.leftCheekMount = buildCheekUnit(-1);
    this.rightCheekMount = buildCheekUnit(1);
    this.noseCluster.add(this.leftCheekMount, this.rightCheekMount);
    this.rootGroup.add(this.noseCluster);

    this.rootGroup.traverse((obj) => {
      if (obj.isMesh && obj.geometry && this._geometries.indexOf(obj.geometry) === -1) {
        this._geometries.push(obj.geometry);
      }
    });

    // Spring physics states
    this._leftSpring = {
      roll: { pos: 0, vel: 0 },
      pitch: { pos: 0, vel: 0 },
      bounce: { pos: 0, vel: 0 },
    };
    this._rightSpring = {
      roll: { pos: 0, vel: 0 },
      pitch: { pos: 0, vel: 0 },
      bounce: { pos: 0, vel: 0 },
    };
    this._hasPrevPose = false;
    this._prevEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._prevHeadPos = new THREE.Vector3();
    this._lastTimestamp = 0;
    this._elapsedTime = 0;

    // Pre-allocated scratch math helpers
    this._p10 = new THREE.Vector3();
    this._p152 = new THREE.Vector3();
    this._p234 = new THREE.Vector3();
    this._p454 = new THREE.Vector3();
    this._p1 = new THREE.Vector3();
    this._rightVec = new THREE.Vector3();
    this._upVec = new THREE.Vector3();
    this._forwardVec = new THREE.Vector3();
    this._basisMat = new THREE.Matrix4();
    this._headQuat = new THREE.Quaternion();
    this._currEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._earPos = new THREE.Vector3();
    this._cheekPos = new THREE.Vector3();
  }

  setOptions(partial = {}) {
    Object.assign(this.options, partial);
    if (partial.blushOpacity !== undefined) {
      this.blushMaterial.opacity = this.options.blushOpacity;
    }
  }

  _stepSpring(spring, dt, stiffness, damping) {
    const force = -stiffness * spring.pos - damping * spring.vel;
    spring.vel += force * dt;
    spring.pos += spring.vel * dt;
    spring.pos = THREE.MathUtils.clamp(spring.pos, -0.32, 0.32);
    spring.vel = THREE.MathUtils.clamp(spring.vel, -4.5, 4.5);
  }

  _mapLandmark(lm, width, height, mirror, out) {
    const nx = mirror ? 1 - lm.x : lm.x;
    return out.set(nx * width - width * 0.5, (0.5 - lm.y) * height, -lm.z * width);
  }

  update(landmarks, width, height, mirror = true) {
    if (!this.renderer || !this.scene || !this.camera) return;

    if (width > 0 && height > 0 && (width !== this.currentWidth || height !== this.currentHeight)) {
      this.currentWidth = width;
      this.currentHeight = height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.renderer.setPixelRatio(dpr);
      this.renderer.setSize(width, height, false);

      this.camera.left = -width * 0.5;
      this.camera.right = width * 0.5;
      this.camera.top = height * 0.5;
      this.camera.bottom = -height * 0.5;
      this.camera.updateProjectionMatrix();
    }

    if (!landmarks || landmarks.length < 455) {
      this.clear();
      return;
    }

    const now = performance.now();
    const dt =
      this._lastTimestamp > 0
        ? Math.min(Math.max((now - this._lastTimestamp) / 1000, 0.001), 0.05)
        : 1 / 60;
    this._lastTimestamp = now;
    this._elapsedTime += dt;

    this._mapLandmark(landmarks[10], width, height, mirror, this._p10);
    this._mapLandmark(landmarks[152], width, height, mirror, this._p152);
    this._mapLandmark(landmarks[234], width, height, mirror, this._p234);
    this._mapLandmark(landmarks[454], width, height, mirror, this._p454);
    this._mapLandmark(landmarks[1], width, height, mirror, this._p1);

    const faceHeight = this._p10.distanceTo(this._p152);
    const faceWidth = this._p234.distanceTo(this._p454);
    if (faceHeight < 1e-4 || faceWidth < 1e-4) {
      this.clear();
      return;
    }
    const headScale = faceWidth * 0.55 + faceHeight * 0.45;

    if (mirror) {
      this._rightVec.subVectors(this._p234, this._p454);
    } else {
      this._rightVec.subVectors(this._p454, this._p234);
    }
    this._rightVec.normalize();
    this._upVec.subVectors(this._p10, this._p152).normalize();
    this._forwardVec.crossVectors(this._rightVec, this._upVec).normalize();
    this._upVec.crossVectors(this._forwardVec, this._rightVec).normalize();

    this._basisMat.makeBasis(this._rightVec, this._upVec, this._forwardVec);
    this._headQuat.setFromRotationMatrix(this._basisMat);
    this._currEuler.setFromQuaternion(this._headQuat, 'YXZ');

    if (this._hasPrevPose) {
      const dPitch = THREE.MathUtils.clamp(this._currEuler.x - this._prevEuler.x, -0.35, 0.35);
      const dYaw = THREE.MathUtils.clamp(this._currEuler.y - this._prevEuler.y, -0.35, 0.35);
      const dRoll = THREE.MathUtils.clamp(this._currEuler.z - this._prevEuler.z, -0.35, 0.35);
      const dyNorm = THREE.MathUtils.clamp((this._p10.y - this._prevHeadPos.y) / faceHeight, -0.25, 0.25);

      this._leftSpring.roll.vel += -dRoll * 9.5 + dYaw * 2.5;
      this._rightSpring.roll.vel += -dRoll * 9.5 - dYaw * 2.5;
      this._leftSpring.pitch.vel += -dPitch * 8.5 - dyNorm * 6.5;
      this._rightSpring.pitch.vel += -dPitch * 8.5 - dyNorm * 6.5;
      this._leftSpring.bounce.vel += -dyNorm * 4.5 + dRoll * 3.0;
      this._rightSpring.bounce.vel += -dyNorm * 4.5 - dRoll * 3.0;
    } else {
      this._hasPrevPose = true;
    }

    this._prevEuler.copy(this._currEuler);
    this._prevHeadPos.copy(this._p10);

    this._stepSpring(this._leftSpring.roll, dt, 130, 11.5);
    this._stepSpring(this._leftSpring.pitch, dt, 125, 11.5);
    this._stepSpring(this._leftSpring.bounce, dt, 145, 12.0);
    this._stepSpring(this._rightSpring.roll, dt, 122, 11.2);
    this._stepSpring(this._rightSpring.pitch, dt, 120, 11.2);
    this._stepSpring(this._rightSpring.bounce, dt, 140, 11.8);

    const idleL = Math.sin(this._elapsedTime * 2.3) * 0.014;
    const idleR = Math.sin(this._elapsedTime * 2.3 + 0.55) * 0.014;

    this.leftEarSpringNode.rotation.set(
      this._leftSpring.pitch.pos,
      0,
      this._leftSpring.roll.pos + idleL
    );
    this.leftEarSpringNode.position.y = this._leftSpring.bounce.pos * 0.08;

    this.rightEarSpringNode.rotation.set(
      this._rightSpring.pitch.pos,
      0,
      this._rightSpring.roll.pos - idleR
    );
    this.rightEarSpringNode.position.y = this._rightSpring.bounce.pos * 0.08;

    // Forehead cluster placement
    this._earPos
      .copy(this._p10)
      .addScaledVector(this._upVec, this.options.earHeight * faceHeight)
      .addScaledVector(this._forwardVec, -this.options.earBackOffset * faceHeight);

    this.foreheadCluster.position.copy(this._earPos);
    this.foreheadCluster.quaternion.copy(this._headQuat);

    const earUnitScale = headScale * this.options.earScale;
    const earOffsetX = this.options.earSpacing * faceWidth;
    this.leftEarMount.position.set(-earOffsetX, 0, 0);
    this.leftEarMount.scale.setScalar(earUnitScale);
    this.rightEarMount.position.set(earOffsetX, 0, 0);
    this.rightEarMount.scale.setScalar(earUnitScale);

    // Nose cluster placement
    this._cheekPos
      .copy(this._p1)
      .addScaledVector(this._upVec, this.options.cheekHeight * faceHeight)
      .addScaledVector(this._forwardVec, -this.options.cheekBackOffset * faceHeight);

    this.noseCluster.position.copy(this._cheekPos);
    this.noseCluster.quaternion.copy(this._headQuat);

    const cheekOffsetX = this.options.cheekSpacing * faceWidth;
    this.leftCheekMount.position.set(-cheekOffsetX, 0, 0);
    this.leftCheekMount.scale.setScalar(headScale);
    this.rightCheekMount.position.set(cheekOffsetX, 0, 0);
    this.rightCheekMount.scale.setScalar(headScale);

    this.blushMaterial.opacity = this.options.blushOpacity;
    this.rootGroup.visible = true;

    this.renderer.render(this.scene, this.camera);
  }

  clear() {
    this.rootGroup.visible = false;
    this._hasPrevPose = false;
    if (this.renderer) {
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear(true, true, true);
    }
  }

  dispose() {
    this.clear();
    for (let i = 0; i < this._geometries.length; i++) {
      this._geometries[i].dispose();
    }
    for (let i = 0; i < this._materials.length; i++) {
      this._materials[i].dispose();
    }
    for (let i = 0; i < this._textures.length; i++) {
      this._textures[i].dispose();
    }
    this._geometries = [];
    this._materials = [];
    this._textures = [];
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
    this.scene = null;
    this.camera = null;
  }
}

if (typeof window !== 'undefined') {
  window.RainbowEarsFilter3D = RainbowEarsFilter3D;
}

export default RainbowEarsFilter3D;
