import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js';

/* FLUFFY_EARS_DEFAULT_CONFIG_START */
const DEFAULT_CONFIG = {
  earHeight: 0.11,      // Độ cao tai (-0.05 - +0.35 * faceHeight)
  earScale: 0.6,       // Cỡ tai (30% - 100%)
  earSpacing: 0.46,     // Khoảng cách 2 tai (0.25 - 0.65 * faceWidth)
  fluffiness: 1,      // Độ xù & mật độ lông tai (50% - 130%)
  blushOpacity: 0.38,   // Độ đậm má hồng zic-zac (10% - 75%)
  sparkleOpacity: 0.35, // Độ thưa & trong suốt hạt sáng (10% - 80%)
  earDepthBack: 0.10,   // Lùi ra sau theo -forwardVec (0.10 * faceHeight)
};
/* FLUFFY_EARS_DEFAULT_CONFIG_END */

// Deterministic PRNG so procedural fur and sparkle distributions stay consistent
function createSeededRandom(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Evaluate a point on the sculpted 3D fox/cat ear shell.
// theta in [0, 2*PI]: [0, PI] = front concave cavity + plush rim, [PI, 2*PI] = convex furry back
// v in [0, 1]: 0 = skull-hugging base, 1 = soft pointed apex
// side: +1 = right ear (+X outward), -1 = left ear (-X outward)
function evaluateEarSurface(theta, v, side, target) {
  const cosT = Math.cos(theta); // -1 = inner/medial edge, +1 = outer/lateral edge
  const sinT = Math.sin(theta); // >= 0 front face, < 0 back face

  // Broad, softly tapering fox/cat silhouette with gently rounded tip (matches reference photo)
  const baseExpand = 0.92 + 0.18 * Math.sin(clamp(v * 2.5, 0, Math.PI));
  const taper = Math.pow(Math.max(0.0001, 1.0 - v), 0.70);
  const softTipWidth = 0.042 * (1.0 - smoothstep(0.90, 1.0, v));
  const halfWidth = 0.50 * (taper * baseExpand * 0.94 + softTipWidth);

  // Subtle organic asymmetry: outer edge curves slightly fuller, apex leans gently outward
  const outerFullness = cosT > 0 ? 1.0 + 0.08 * Math.sin(v * Math.PI) : 1.0 - 0.02 * Math.sin(v * Math.PI);
  const tipLean = 0.065 * Math.pow(v, 1.45);
  const localX = (cosT * halfWidth * outerFullness + tipLean) * side;

  // Compact tucked base without any protruding lower rim skirt
  const baseSkullCurve = 0.032 * (cosT * cosT) * Math.pow(1.0 - v, 1.8);
  const localY = v * 0.98 - baseSkullCurve;

  // Depth profile: scooped concave inner ear cavity on front, plump rounded dome on back
  const uSq = cosT * cosT;
  const centerMask = Math.pow(Math.max(0, 1.0 - uSq), 1.15);
  const vCavityEnv = Math.sin(Math.pow(clamp(v, 0, 1), 0.78) * Math.PI);

  let localZ = 0;
  if (sinT >= 0) {
    // Front face: soft rounded furry rim along edges, deep warm scoop in the middle
    const rimDist = Math.abs(cosT) - 0.78;
    const rimRidge = 0.056 * Math.exp(-(rimDist * rimDist) / 0.065) * (1.0 - 0.56 * v);
    const frontDome = 0.026 * sinT * (1.0 - 0.5 * v);
    const cavityScoop = 0.185 * centerMask * vCavityEnv;
    localZ = rimRidge + frontDome - cavityScoop;
  } else {
    // Convex plush back of ear
    const backSin = Math.abs(sinT);
    const backThickness = 0.175 * Math.pow(backSin, 0.84) * (1.0 - 0.72 * Math.pow(v, 1.15));
    const backBaseArch = 0.036 * centerMask * (1.0 - v);
    localZ = -0.038 - backThickness - backBaseArch;
  }

  // Gentle forward cup & subtle skull wrap backward at outer base
  const skullWrapZ = -0.075 * uSq * Math.pow(1.0 - v, 1.5);
  const tipForwardCurl = 0.035 * Math.pow(v, 2.2);
  localZ += skullWrapZ + tipForwardCurl;

  target.set(localX, localY, localZ);
  return target;
}

function createSculptedEarGeometry(side, radialSegs = 40, heightSegs = 28) {
  const geo = new THREE.BufferGeometry();
  const vertCount = (radialSegs + 1) * (heightSegs + 1);
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices = [];
  const tmp = new THREE.Vector3();

  let ptr = 0;
  let uvPtr = 0;
  for (let iy = 0; iy <= heightSegs; iy++) {
    const v = iy / heightSegs;
    for (let ix = 0; ix <= radialSegs; ix++) {
      const tNorm = ix / radialSegs;
      const theta = tNorm * Math.PI * 2;
      evaluateEarSurface(theta, v, side, tmp);

      positions[ptr++] = tmp.x;
      positions[ptr++] = tmp.y;
      positions[ptr++] = tmp.z;

      // Split UV atlas cleanly: [0..0.5] = front cavity + inner rim, [0.5..1.0] = outer furry back
      const cosT = Math.cos(theta);
      let uTex;
      if (theta <= Math.PI) {
        uTex = 0.02 + 0.46 * (0.5 + 0.5 * cosT);
      } else {
        uTex = 0.52 + 0.46 * (0.5 + 0.5 * cosT);
      }
      uvs[uvPtr++] = uTex;
      uvs[uvPtr++] = v;
    }
  }

  const stride = radialSegs + 1;
  for (let iy = 0; iy < heightSegs; iy++) {
    for (let ix = 0; ix < radialSegs; ix++) {
      const a = iy * stride + ix;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      // Preserve outward-facing winding order for both left (side = -1) and right (side = +1) ears
      if (side > 0) {
        indices.push(a, c, b);
        indices.push(b, c, d);
      } else {
        indices.push(a, b, c);
        indices.push(b, d, c);
      }
    }
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// Procedural high-resolution fur albedo, bump, matte roughness, and soft-base alphaMap for the ear shell
function createEarShellTextures(maxAnisotropy) {
  const size = 1024;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const cCtx = colorCanvas.getContext('2d');

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bCtx = bumpCanvas.getContext('2d');

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d');

  const alphaCanvas = document.createElement('canvas');
  alphaCanvas.width = size;
  alphaCanvas.height = size;
  const aCtx = alphaCanvas.getContext('2d');

  const rng = createSeededRandom(481516);
  const half = size / 2;

  // --- Base Fill: Soft powdery dusty rose-taupe outer/rim (#c2988d) ---
  const outerGrad = cCtx.createLinearGradient(0, size, 0, 0);
  outerGrad.addColorStop(0.0, '#b58d83');
  outerGrad.addColorStop(0.35, '#c2988d');
  outerGrad.addColorStop(0.78, '#caa398');
  outerGrad.addColorStop(1.0, '#d2aea3');
  cCtx.fillStyle = outerGrad;
  cCtx.fillRect(0, 0, size, size);

  // Neutral matte base for bump and roughness (soft velvety fur, zero plastic shine)
  bCtx.fillStyle = '#7c7c7c';
  bCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = '#e8e8e8';
  rCtx.fillRect(0, 0, size, size);

  // Soft feathered alphaMap: fades ear base cleanly to transparent so no hard curved rim shows against hair
  const baseAlphaGrad = aCtx.createLinearGradient(0, size, 0, 0);
  baseAlphaGrad.addColorStop(0.0, '#000000');
  baseAlphaGrad.addColorStop(0.08, '#2a2a2a');
  baseAlphaGrad.addColorStop(0.20, '#dcdcdc');
  baseAlphaGrad.addColorStop(0.28, '#ffffff');
  baseAlphaGrad.addColorStop(0.95, '#ffffff');
  baseAlphaGrad.addColorStop(1.0, '#c8c8c8');
  aCtx.fillStyle = baseAlphaGrad;
  aCtx.fillRect(0, 0, size, size);

  // Add feathery vertical fur strokes along the bottom alpha fade so base blends organically into hair
  aCtx.lineCap = 'round';
  for (let i = 0; i < 420; i++) {
    const bx = rng() * size;
    const by = size * (0.76 + rng() * 0.22);
    const blen = 28 + rng() * 68;
    const vFade = clamp((size - by) / (size * 0.26), 0, 1);
    const tone = Math.floor(vFade * 235);
    aCtx.strokeStyle = `rgba(${tone},${tone},${tone},0.45)`;
    aCtx.lineWidth = 2 + rng() * 5;
    aCtx.beginPath();
    aCtx.moveTo(bx, by);
    aCtx.lineTo(bx + (rng() - 0.5) * 14, by - blen);
    aCtx.stroke();
  }

  // --- Front Half [0..half]: Warm chocolate inner ear cavity (#4e2f24 -> #754e3f) ---
  cCtx.save();
  cCtx.beginPath();
  cCtx.rect(0, 0, half, size);
  cCtx.clip();

  const cavCx = half * 0.49;
  const cavCy = size * 0.53;
  cCtx.save();
  cCtx.translate(cavCx, cavCy);
  cCtx.scale(0.66, 0.96);
  const cavGrad = cCtx.createRadialGradient(0, size * 0.04, size * 0.03, 0, 0, size * 0.43);
  cavGrad.addColorStop(0.0, '#44281e');
  cavGrad.addColorStop(0.30, '#4e2f24');
  cavGrad.addColorStop(0.58, '#664134');
  cavGrad.addColorStop(0.76, '#754e3f');
  cavGrad.addColorStop(0.90, '#b38b80');
  cavGrad.addColorStop(1.0, 'rgba(194, 152, 141, 0)');
  cCtx.fillStyle = cavGrad;
  cCtx.beginPath();
  cCtx.arc(0, 0, size * 0.45, 0, Math.PI * 2);
  cCtx.fill();
  cCtx.restore();
  cCtx.restore();

  // --- Back Half [half..size]: Soft tonal shading ---
  cCtx.save();
  cCtx.beginPath();
  cCtx.rect(half, 0, half, size);
  cCtx.clip();

  const backShade = cCtx.createRadialGradient(half * 1.5, size * 0.54, 30, half * 1.5, size * 0.52, size * 0.48);
  backShade.addColorStop(0.0, 'rgba(155, 114, 104, 0.22)');
  backShade.addColorStop(0.7, 'rgba(194, 152, 141, 0.08)');
  backShade.addColorStop(1.0, 'rgba(222, 190, 180, 0.18)');
  cCtx.fillStyle = backShade;
  cCtx.fillRect(half, 0, half, size);
  cCtx.restore();

  // --- Layer 11,000 fine directional micro fur strands across Albedo, Bump, and Roughness ---
  cCtx.lineCap = 'round';
  bCtx.lineCap = 'round';
  rCtx.lineCap = 'round';

  const outerPalette = ['#a98177', '#b88f84', '#c2988d', '#cda69c', '#d7b6ac', '#b1877d'];
  const innerPalette = ['#42261c', '#4e2f24', '#603c2f', '#754e3f', '#896152'];

  for (let i = 0; i < 11000; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const isFront = x < half;
    const localU = isFront ? x / half : (x - half) / half;
    const localV = 1.0 - y / size;

    const flowAngle = -Math.PI * 0.5 + (0.5 - localU) * 0.30 + (rng() - 0.5) * 0.22;
    const len = 10 + rng() * 22;
    const dx = Math.cos(flowAngle) * len;
    const dy = Math.sin(flowAngle) * len;

    const distFromCav = Math.hypot((localU - 0.49) / 0.34, (localV - 0.46) / 0.40);

    let strokeColor;
    let alpha = 0.20 + rng() * 0.25;
    if (isFront && distFromCav < 0.94) {
      strokeColor = innerPalette[Math.floor(rng() * innerPalette.length)];
      alpha = 0.22 + rng() * 0.28;
    } else {
      strokeColor = outerPalette[Math.floor(rng() * outerPalette.length)];
    }

    const w = 0.7 + rng() * 1.5;
    cCtx.strokeStyle = strokeColor;
    cCtx.globalAlpha = alpha;
    cCtx.lineWidth = w;
    cCtx.beginPath();
    cCtx.moveTo(x, y);
    cCtx.quadraticCurveTo(x + dx * 0.5 + (rng() - 0.5) * 2.5, y + dy * 0.5, x + dx, y + dy);
    cCtx.stroke();

    const bVal = Math.floor(96 + rng() * 124);
    bCtx.strokeStyle = `rgb(${bVal},${bVal},${bVal})`;
    bCtx.globalAlpha = 0.30;
    bCtx.lineWidth = w;
    bCtx.beginPath();
    bCtx.moveTo(x, y);
    bCtx.lineTo(x + dx, y + dy);
    bCtx.stroke();

    const rVal = Math.floor(220 + rng() * 32);
    rCtx.strokeStyle = `rgb(${rVal},${rVal},${rVal})`;
    rCtx.globalAlpha = 0.30;
    rCtx.lineWidth = w * 1.2;
    rCtx.beginPath();
    rCtx.moveTo(x, y);
    rCtx.lineTo(x + dx, y + dy);
    rCtx.stroke();
  }

  cCtx.globalAlpha = 1;
  bCtx.globalAlpha = 1;
  rCtx.globalAlpha = 1;

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAnisotropy;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.anisotropy = maxAnisotropy;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.anisotropy = maxAnisotropy;

  const alphaMap = new THREE.CanvasTexture(alphaCanvas);
  alphaMap.anisotropy = maxAnisotropy;

  return { map, bumpMap, roughnessMap, alphaMap };
}

// Procedural soft feathered fur strand color + dedicated misty alphaMap (zero spiky polygon edges!)
function createSoftFurTextures(maxAnisotropy) {
  const w = 128;
  const h = 256;
  const rng = createSeededRandom(99231);

  // 1. Color texture: subtle hair fiber luminance variation (root slightly deeper, soft luminous tip)
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = w;
  colorCanvas.height = h;
  const cCtx = colorCanvas.getContext('2d');

  const cGrad = cCtx.createLinearGradient(0, h, 0, 0);
  cGrad.addColorStop(0.0, '#c8bebc');
  cGrad.addColorStop(0.28, '#e8e2e0');
  cGrad.addColorStop(0.72, '#faf7f5');
  cGrad.addColorStop(1.0, '#ffffff');
  cCtx.fillStyle = cGrad;
  cCtx.fillRect(0, 0, w, h);

  cCtx.lineCap = 'round';
  for (let i = 0; i < 40; i++) {
    const x0 = w * (0.15 + rng() * 0.70);
    const x1 = w * (0.28 + rng() * 0.44);
    const shade = Math.floor(215 + rng() * 40);
    cCtx.strokeStyle = `rgba(${shade},${shade},${shade},0.35)`;
    cCtx.lineWidth = 1.5 + rng() * 2.5;
    cCtx.beginPath();
    cCtx.moveTo(x0, h);
    cCtx.quadraticCurveTo((x0 + x1) * 0.5 + (rng() - 0.5) * 14, h * 0.5, x1, 0);
    cCtx.stroke();
  }

  // 2. Soft feathered strand alphaMap: misty radial-feathered multi-hair lock fading smoothly to 0 at tip & sides
  const alphaCanvas = document.createElement('canvas');
  alphaCanvas.width = w;
  alphaCanvas.height = h;
  const aCtx = alphaCanvas.getContext('2d');
  aCtx.fillStyle = '#000000';
  aCtx.fillRect(0, 0, w, h);

  // Soft blurry feathered body core
  const bodySteps = 34;
  for (let i = 0; i < bodySteps; i++) {
    const t = i / (bodySteps - 1); // 0 = root, 1 = tip
    const py = h * (0.96 - t * 0.88);
    const radiusX = w * (0.36 * Math.sin(Math.pow(1 - t, 0.72) * Math.PI * 0.85) + 0.04);
    const radiusY = h * 0.095;
    const rootFade = smoothstep(0.0, 0.14, t);
    const tipFade = Math.pow(Math.max(0, 1.0 - t), 1.35);
    const alpha = 0.24 * rootFade * tipFade;

    aCtx.save();
    aCtx.translate(w * 0.5, py);
    aCtx.scale(1.0, radiusY / Math.max(1, radiusX));
    const rg = aCtx.createRadialGradient(0, 0, 0, 0, 0, Math.max(4, radiusX));
    rg.addColorStop(0.0, `rgba(255,255,255,${alpha})`);
    rg.addColorStop(0.55, `rgba(255,255,255,${alpha * 0.42})`);
    rg.addColorStop(1.0, 'rgba(255,255,255,0)');
    aCtx.fillStyle = rg;
    aCtx.beginPath();
    aCtx.arc(0, 0, Math.max(4, radiusX), 0, Math.PI * 2);
    aCtx.fill();
    aCtx.restore();
  }

  // Ultra-fine wispy hair strands fading softly at tips so edges look plush & cotton-soft
  aCtx.lineCap = 'round';
  for (let i = 0; i < 46; i++) {
    const startX = w * (0.22 + rng() * 0.56);
    const tipX = w * (0.30 + rng() * 0.40);
    const tipY = h * (0.04 + rng() * 0.34);
    const ctrlX = (startX + tipX) * 0.5 + (rng() - 0.5) * w * 0.24;
    const ctrlY = h * (0.45 + rng() * 0.22);

    const sg = aCtx.createLinearGradient(startX, h * 0.96, tipX, tipY);
    sg.addColorStop(0.0, 'rgba(255,255,255,0.0)');
    sg.addColorStop(0.16, 'rgba(255,255,255,0.42)');
    sg.addColorStop(0.55, 'rgba(255,255,255,0.34)');
    sg.addColorStop(0.84, 'rgba(255,255,255,0.12)');
    sg.addColorStop(1.0, 'rgba(255,255,255,0.0)');

    aCtx.strokeStyle = sg;
    aCtx.lineWidth = 1.6 + rng() * 3.2;
    aCtx.beginPath();
    aCtx.moveTo(startX, h * 0.96);
    aCtx.quadraticCurveTo(ctrlX, ctrlY, tipX, tipY);
    aCtx.stroke();
  }

  // 3. Soft cotton-puff alphaMap specifically for Tier 3 honey-cream corner tuft
  const puffCanvas = document.createElement('canvas');
  puffCanvas.width = 128;
  puffCanvas.height = 128;
  const pCtx = puffCanvas.getContext('2d');
  pCtx.fillStyle = '#000000';
  pCtx.fillRect(0, 0, 128, 128);

  const puffBase = pCtx.createRadialGradient(64, 68, 4, 64, 64, 56);
  puffBase.addColorStop(0.0, 'rgba(255,255,255,0.88)');
  puffBase.addColorStop(0.45, 'rgba(255,255,255,0.48)');
  puffBase.addColorStop(0.78, 'rgba(255,255,255,0.14)');
  puffBase.addColorStop(1.0, 'rgba(255,255,255,0.0)');
  pCtx.fillStyle = puffBase;
  pCtx.fillRect(0, 0, 128, 128);

  for (let i = 0; i < 24; i++) {
    const ang = rng() * Math.PI * 2;
    const dist = 10 + rng() * 34;
    const px = 64 + Math.cos(ang) * dist;
    const py = 64 + Math.sin(ang) * dist;
    const pr = 12 + rng() * 18;
    const fg = pCtx.createRadialGradient(px, py, 0, px, py, pr);
    fg.addColorStop(0.0, 'rgba(255,255,255,0.24)');
    fg.addColorStop(1.0, 'rgba(255,255,255,0.0)');
    pCtx.fillStyle = fg;
    pCtx.beginPath();
    pCtx.arc(px, py, pr, 0, Math.PI * 2);
    pCtx.fill();
  }

  const colorMap = new THREE.CanvasTexture(colorCanvas);
  colorMap.colorSpace = THREE.SRGBColorSpace;
  colorMap.anisotropy = maxAnisotropy;

  const alphaMap = new THREE.CanvasTexture(alphaCanvas);
  alphaMap.anisotropy = maxAnisotropy;

  const puffAlphaMap = new THREE.CanvasTexture(puffCanvas);
  puffAlphaMap.anisotropy = maxAnisotropy;

  return { colorMap, alphaMap, puffAlphaMap };
}

// 3D curved, gently V-creased tapered fur blade geometry (pivot at root y = 0, grows along +Y)
function createCurvedFurBladeGeometry(width, length, curveBend, segments = 4) {
  const geo = new THREE.BufferGeometry();
  const cols = 3; // left edge, central ridge, right edge (V-crease catches soft fur light)
  const vertCount = (segments + 1) * cols;
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const indices = [];

  let p = 0;
  let u = 0;
  for (let iy = 0; iy <= segments; iy++) {
    const t = iy / segments;
    // Smooth tapered profile: slightly plumper above root, sharp needle tip at t=1
    const widthProfile = Math.sin(Math.pow(1.0 - t, 0.65) * Math.PI * 0.78) * (1.0 - t * 0.15);
    const halfW = width * 0.5 * Math.max(0.02, widthProfile);
    const y = t * length;
    const zBend = curveBend * t * t * length;
    const ridgeZ = width * 0.16 * (1.0 - t);

    for (let ix = 0; ix < cols; ix++) {
      const fx = ix === 0 ? -1 : ix === 1 ? 0 : 1;
      positions[p++] = fx * halfW;
      positions[p++] = y;
      positions[p++] = zBend + (ix === 1 ? ridgeZ : 0);

      uvs[u++] = ix * 0.5;
      uvs[u++] = t;
    }
  }

  for (let iy = 0; iy < segments; iy++) {
    for (let ix = 0; ix < cols - 1; ix++) {
      const a = iy * cols + ix;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// High-resolution soft chalk watercolor zig-zag cheek blush CanvasTexture (#d86d67)
function createZigZagBlushTexture(maxAnisotropy) {
  const w = 512;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const rng = createSeededRandom(7331);

  ctx.clearRect(0, 0, w, h);

  // 3-beat soft zig-zag polyline (tilted M/W contour across cheek, matching reference photo)
  const pts = [
    [w * 0.12, h * 0.68],
    [w * 0.30, h * 0.30],
    [w * 0.48, h * 0.66],
    [w * 0.67, h * 0.28],
    [w * 0.87, h * 0.62],
  ];

  // Underlying ultra-soft watercolor blush wash around the zig-zag
  for (let s = 0; s < pts.length - 1; s++) {
    const [x0, y0] = pts[s];
    const [x1, y1] = pts[s + 1];
    const steps = 22;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = x0 + (x1 - x0) * t;
      const py = y0 + (y1 - y0) * t;
      const r = 46 + rng() * 16;
      const grad = ctx.createRadialGradient(px, py, 2, px, py, r);
      grad.addColorStop(0.0, 'rgba(216, 109, 103, 0.055)');
      grad.addColorStop(0.5, 'rgba(220, 118, 111, 0.028)');
      grad.addColorStop(1.0, 'rgba(216, 109, 103, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Layered soft chalk pastel brush dabs along the 3-beat zig-zag path
  for (let s = 0; s < pts.length - 1; s++) {
    const [x0, y0] = pts[s];
    const [x1, y1] = pts[s + 1];
    const steps = 48;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      // Taper slightly at the start and end tips of the entire zig-zag
      const globalT = (s + t) / (pts.length - 1);
      const endFade = smoothstep(0.0, 0.14, globalT) * smoothstep(1.0, 0.86, globalT);

      const cx = x0 + (x1 - x0) * t;
      const cy = y0 + (y1 - y0) * t;

      // Soft chalk grain scatter
      for (let d = 0; d < 6; d++) {
        const jx = (rng() - 0.5) * 26;
        const jy = (rng() - 0.5) * 22;
        const r = (12 + rng() * 19) * (0.65 + 0.35 * endFade);
        const alpha = (0.045 + rng() * 0.055) * (0.45 + 0.55 * endFade);
        const grad = ctx.createRadialGradient(cx + jx, cy + jy, 0, cx + jx, cy + jy, r);
        grad.addColorStop(0.0, `rgba(216, 109, 103, ${alpha})`);
        grad.addColorStop(0.45, `rgba(219, 116, 109, ${alpha * 0.58})`);
        grad.addColorStop(1.0, 'rgba(216, 109, 103, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx + jx, cy + jy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Soft edge feather vignette mask so texture never clips against UV boundary
  ctx.globalCompositeOperation = 'destination-in';
  const maskGrad = ctx.createRadialGradient(w * 0.5, h * 0.5, h * 0.25, w * 0.5, h * 0.5, w * 0.52);
  maskGrad.addColorStop(0.0, 'rgba(255, 255, 255, 1)');
  maskGrad.addColorStop(0.78, 'rgba(255, 255, 255, 0.88)');
  maskGrad.addColorStop(1.0, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = maskGrad;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

// Curved 3D cheek-hugging patch geometry
function createCurvedCheekGeometry(width = 0.28, height = 0.145, bendDepth = 0.065) {
  const geo = new THREE.PlaneGeometry(width, height, 14, 7);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const nx = x / (width * 0.5);
    const ny = y / (height * 0.5);
    // Curve naturally backward around the cheek contour
    const z = -bendDepth * (nx * nx * 0.85 + ny * ny * 0.25);
    pos.setZ(i, z);
  }
  geo.computeVertexNormals();
  return geo;
}

// Soft pearl-white bokeh glow dot CanvasTexture (alpha cleanly fades to 0)
function createBokehDotTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;

  const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0.0, 'rgba(255, 253, 250, 0.95)');
  grad.addColorStop(0.18, 'rgba(255, 250, 246, 0.72)');
  grad.addColorStop(0.45, 'rgba(252, 244, 240, 0.22)');
  grad.addColorStop(0.78, 'rgba(248, 238, 234, 0.04)');
  grad.addColorStop(1.0, 'rgba(255, 255, 255, 0)');

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Tiny delicate 4-point pearl star CanvasTexture (soft halo fading to alpha = 0)
function createFourPointStarTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = size / 2;

  // Soft outer aura
  const halo = ctx.createRadialGradient(c, c, 0, c, c, c * 0.78);
  halo.addColorStop(0.0, 'rgba(255, 253, 250, 0.85)');
  halo.addColorStop(0.24, 'rgba(255, 249, 244, 0.34)');
  halo.addColorStop(0.60, 'rgba(252, 242, 238, 0.06)');
  halo.addColorStop(1.0, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);

  // Delicate 4-point needle star rays
  ctx.save();
  ctx.translate(c, c);
  for (let r = 0; r < 2; r++) {
    ctx.rotate((r * Math.PI) / 2);
    const rayGrad = ctx.createLinearGradient(0, -c * 0.88, 0, c * 0.88);
    rayGrad.addColorStop(0.0, 'rgba(255, 255, 255, 0)');
    rayGrad.addColorStop(0.35, 'rgba(255, 252, 248, 0.55)');
    rayGrad.addColorStop(0.5, 'rgba(255, 255, 255, 0.98)');
    rayGrad.addColorStop(0.65, 'rgba(255, 252, 248, 0.55)');
    rayGrad.addColorStop(1.0, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = rayGrad;
    ctx.beginPath();
    ctx.moveTo(0, -c * 0.88);
    ctx.quadraticCurveTo(3.2, 0, 0, c * 0.88);
    ctx.quadraticCurveTo(-3.2, 0, 0, -c * 0.88);
    ctx.fill();
  }
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function detectSoftwareWebGL() {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

export class FluffyEarsFilter3D {
  constructor(canvas, options = {}) {
    if (!canvas) {
      throw new Error('FluffyEarsFilter3D requires a valid HTMLCanvasElement.');
    }

    this.canvas = canvas;
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.isSoftwareGl = detectSoftwareWebGL();
    this._disposed = false;
    this._width = canvas.width || 640;
    this._height = canvas.height || 480;
    this._lastTime = performance.now();
    this._elapsed = 0;

    // Reusable scratch math objects (zero per-frame GC allocation)
    this._p1 = new THREE.Vector3();
    this._p10 = new THREE.Vector3();
    this._p152 = new THREE.Vector3();
    this._p234 = new THREE.Vector3();
    this._p454 = new THREE.Vector3();
    this._rightVec = new THREE.Vector3();
    this._upVec = new THREE.Vector3();
    this._forwardVec = new THREE.Vector3();
    this._earCenter = new THREE.Vector3();
    this._basisMat = new THREE.Matrix4();
    this._headQuat = new THREE.Quaternion();
    this._headEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._prevHeadEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._prevHeadPos = new THREE.Vector3();
    this._hasPrevPose = false;
    this._dummy = new THREE.Object3D();
    this._tmpQuat = new THREE.Quaternion();
    this._tmpVecA = new THREE.Vector3();
    this._tmpVecB = new THREE.Vector3();
    this._tmpColor = new THREE.Color();

    // Spring physics state for each ear (+1 right, -1 left)
    this._springs = {
      right: { angleZ: 0, velZ: 0, angleX: 0, velX: 0, twitch: 0, twitchVel: 0 },
      left: { angleZ: 0, velZ: 0, angleX: 0, velX: 0, twitch: 0, twitchVel: 0 },
    };
    this._nextTwitchTime = 2.6 + Math.random() * 3.5;

    // Resource tracking for clean dispose()
    this._geometries = [];
    this._materials = [];
    this._textures = [];
    this._furInstancedSystems = [];
    this._sparkleItems = [];

    // --- Renderer Setup (preserveDrawingBuffer + alpha mandatory for photobooth capture) ---
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: !this.isSoftwareGl,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setSize(this._width, this._height, false);

    // --- Scene & Camera ---
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, this._width / Math.max(1, this._height), 0.05, 100);
    this.camera.position.set(0, 0, 3.2);
    this.camera.lookAt(0, 0, 0);

    // --- 3-Point Studio Lighting Rig (warm key, cool hemisphere fill, soft rim) ---
    const hemiLight = new THREE.HemisphereLight(0xeef2fa, 0x3b2d29, 0.95);
    this.scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff4ea, 1.45);
    keyLight.position.set(1.8, 2.6, 3.4);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xdce6f5, 0.55);
    fillLight.position.set(-2.2, 0.8, 2.2);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xf6dfd4, 0.78);
    rimLight.position.set(0.0, 2.2, -2.8);
    this.scene.add(rimLight);

    // --- Root Filter Hierarchy ---
    this.rootGroup = new THREE.Group();
    this.rootGroup.visible = false;
    this.scene.add(this.rootGroup);

    // Cluster 1: Fluffy Ears Group (anchored relative to forehead landmark[10])
    this.earsAnchor = new THREE.Group();
    this.rootGroup.add(this.earsAnchor);

    // Cluster 2: Delicate Face Effects Group (anchored at nose tip landmark[1])
    this.faceAnchor = new THREE.Group();
    this.rootGroup.add(this.faceAnchor);

    this._buildEarsCluster();
    this._buildFaceEffectsCluster();
    this.setOptions(this.config);
  }

  _trackGeo(geo) {
    this._geometries.push(geo);
    return geo;
  }

  _trackMat(mat) {
    this._materials.push(mat);
    return mat;
  }

  _trackTex(tex) {
    this._textures.push(tex);
    return tex;
  }

  _buildEarsCluster() {
    const maxAniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const shellTex = createEarShellTextures(maxAniso);
    this._trackTex(shellTex.map);
    this._trackTex(shellTex.bumpMap);
    this._trackTex(shellTex.roughnessMap);
    this._trackTex(shellTex.alphaMap);

    const furTex = createSoftFurTextures(maxAniso);
    this._trackTex(furTex.colorMap);
    this._trackTex(furTex.alphaMap);
    this._trackTex(furTex.puffAlphaMap);

    // Ear shell with soft alpha-faded bottom base so no rigid curved rim cuts across the hair
    const earShellMat = this._trackMat(
      new THREE.MeshPhysicalMaterial({
        map: shellTex.map,
        bumpMap: shellTex.bumpMap,
        bumpScale: 0.012,
        roughnessMap: shellTex.roughnessMap,
        alphaMap: shellTex.alphaMap,
        transparent: true,
        depthWrite: true,
        alphaTest: 0.02,
        roughness: 0.94,
        metalness: 0.0,
        sheen: 0.50,
        sheenRoughness: 0.84,
        sheenColor: new THREE.Color('#ead4cc'),
        emissive: new THREE.Color('#2a1d1a'),
        emissiveIntensity: 0.24,
      })
    );

    // Tier 1 & 4: Soft feathered translucent plush fur (zero jagged alphaTest spikes!)
    const outerFurMat = this._trackMat(
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map: furTex.colorMap,
        alphaMap: furTex.alphaMap,
        transparent: true,
        depthWrite: false,
        opacity: 0.78,
        side: THREE.DoubleSide,
        roughness: 0.95,
        metalness: 0.0,
        sheen: 0.55,
        sheenRoughness: 0.85,
        sheenColor: new THREE.Color('#f4e2da'),
        emissive: new THREE.Color('#3e2d28'),
        emissiveIntensity: 0.28,
      })
    );

    // Tier 2: Silky fine cream-pink inner ear furnishings (warm & luminous, never muddy gray)
    const furnishingMat = this._trackMat(
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map: furTex.colorMap,
        alphaMap: furTex.alphaMap,
        transparent: true,
        depthWrite: false,
        opacity: 0.66,
        side: THREE.DoubleSide,
        roughness: 0.95,
        metalness: 0.0,
        sheen: 0.45,
        sheenColor: new THREE.Color('#fff2eb'),
        emissive: new THREE.Color('#5a463d'),
        emissiveIntensity: 0.36,
      })
    );

    // Tier 3: Cotton-soft honey-cream corner puff blending ear base naturally into hair
    const honeyTuftMat = this._trackMat(
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map: furTex.colorMap,
        alphaMap: furTex.puffAlphaMap,
        transparent: true,
        depthWrite: false,
        opacity: 0.76,
        side: THREE.DoubleSide,
        roughness: 0.96,
        metalness: 0.0,
        sheen: 0.40,
        sheenColor: new THREE.Color('#fae4be'),
        emissive: new THREE.Color('#4f3c22'),
        emissiveIntensity: 0.34,
      })
    );

    // Finer, softer, more delicate curved fur blade geometries
    const tier1BladeGeo = this._trackGeo(createCurvedFurBladeGeometry(0.078, 0.195, -0.10, 4));
    const tier2BladeGeo = this._trackGeo(createCurvedFurBladeGeometry(0.044, 0.30, 0.16, 5));
    const tier3BladeGeo = this._trackGeo(createCurvedFurBladeGeometry(0.115, 0.145, -0.06, 3));
    const tier4BladeGeo = this._trackGeo(createCurvedFurBladeGeometry(0.046, 0.145, -0.09, 4));

    const furMats = { outerFurMat, furnishingMat, honeyTuftMat };
    const bladeGeos = { tier1BladeGeo, tier2BladeGeo, tier3BladeGeo, tier4BladeGeo };

    this.rightEarPivot = this._createSingleEar(+1, earShellMat, furMats, bladeGeos);
    this.leftEarPivot = this._createSingleEar(-1, earShellMat, furMats, bladeGeos);

    this.earsAnchor.add(this.rightEarPivot);
    this.earsAnchor.add(this.leftEarPivot);
  }

  _createSingleEar(side, earShellMat, furMats, bladeGeos) {
    const pivot = new THREE.Group();
    const earBody = new THREE.Group();
    pivot.add(earBody);

    // Natural outward diagonal tilt ~38 degrees (within 36 - 40 deg spec, hugging side of head)
    pivot.userData.baseRotZ = -THREE.MathUtils.degToRad(38) * side;
    pivot.userData.baseRotY = -0.14 * side;
    pivot.userData.baseRotX = 0.06;
    pivot.rotation.set(pivot.userData.baseRotX, pivot.userData.baseRotY, pivot.userData.baseRotZ);

    // 1. Sculpted 3D Ear Shell (slightly inset so soft feathered fur completely softens silhouette)
    const shellGeo = this._trackGeo(createSculptedEarGeometry(side, 40, 28));
    const shellMesh = new THREE.Mesh(shellGeo, earShellMat);
    shellMesh.renderOrder = 1;
    earBody.add(shellMesh);

    const rng = createSeededRandom(side > 0 ? 104729 : 209441);
    const p0 = new THREE.Vector3();
    const pUp = new THREE.Vector3();
    const pSide = new THREE.Vector3();
    const tangentUp = new THREE.Vector3();
    const tangentSide = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const growthDir = new THREE.Vector3();
    const upAxis = new THREE.Vector3(0, 1, 0);
    const quat = new THREE.Quaternion();
    const twistQuat = new THREE.Quaternion();
    const color = new THREE.Color();

    // Helper to compute exact surface position, upward flow tangent, and outward surface normal
    const sampleSurfaceFrame = (theta, v) => {
      evaluateEarSurface(theta, v, side, p0);
      const dv = 0.015;
      const dt = 0.025;
      evaluateEarSurface(theta, Math.min(1, v + dv), side, pUp);
      evaluateEarSurface(theta + dt, v, side, pSide);

      tangentUp.subVectors(pUp, p0).normalize();
      tangentSide.subVectors(pSide, p0).normalize();
      normal.crossVectors(tangentUp, tangentSide);
      if (side < 0) normal.negate();
      if (normal.lengthSq() < 1e-6) normal.set(0, 0, 1);
      else normal.normalize();
    };

    // Helper to build an InstancedMesh fur tier with dynamic fluffiness metadata
    const buildFurTier = (bladeGeo, material, renderOrder, maxCount, baseCount100, generatorFn) => {
      const mesh = new THREE.InstancedMesh(bladeGeo, material, maxCount);
      mesh.frustumCulled = false;
      mesh.renderOrder = renderOrder;
      const records = [];

      for (let i = 0; i < maxCount; i++) {
        const rec = generatorFn(i, maxCount);
        records.push(rec);
        mesh.setColorAt(i, rec.color);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      earBody.add(mesh);

      const sys = { mesh, records, maxCount, baseCount100 };
      this._furInstancedSystems.push(sys);
      return sys;
    };

    // --- TIER 1: Plush Surface, Soft Feathered Rim & Hair-Blending Base Collar ---
    // 520 strands per ear at 100% (= 1,040 total across both ears, max 676 at 130%)
    const tier1Palette = ['#b78d82', '#c2988d', '#caa297', '#d2ada2', '#d9b7ad', '#ba9085', '#cfa79c'];
    buildFurTier(bladeGeos.tier1BladeGeo, furMats.outerFurMat, 2, 676, 520, () => {
      const rZone = rng();
      let theta;
      let v;
      let isEdgeRim = false;
      let isBaseCollar = false;

      if (rZone < 0.44) {
        // Soft, plush contour-hugging rim halo (feathers the outline gently like reference image 2)
        isEdgeRim = true;
        const onOuterEdge = rng() < 0.54;
        const rimCenter = onOuterEdge ? 0.0 : Math.PI;
        theta = (rimCenter + (rng() - 0.5) * 0.85 + Math.PI * 2) % (Math.PI * 2);
        v = 0.04 + Math.pow(rng(), 0.84) * 0.91;
      } else if (rZone < 0.64) {
        // Plush lower base collar covering the entire bottom transition seamlessly into hair
        isBaseCollar = true;
        theta = rng() * Math.PI * 2;
        v = 0.02 + rng() * 0.20;
      } else if (rZone < 0.88) {
        // Soft convex back shell coat
        theta = Math.PI + 0.14 + rng() * (Math.PI - 0.28);
        v = 0.06 + Math.pow(rng(), 0.90) * 0.88;
      } else {
        // Front inner border transition
        const sideBand = rng() < 0.5 ? rng() * 0.36 : Math.PI - rng() * 0.36;
        theta = sideBand;
        v = 0.06 + rng() * 0.84;
      }

      sampleSurfaceFrame(theta, v);

      // Gentle sleek flow upward along silhouette — soft plush halo instead of spiky needles
      const splayOut = isEdgeRim ? 0.16 + rng() * 0.18 : isBaseCollar ? 0.22 + rng() * 0.18 : 0.10 + rng() * 0.12;
      const radialOutX = Math.cos(theta) * side * (isEdgeRim ? 0.20 : 0.08);
      growthDir
        .copy(tangentUp)
        .multiplyScalar(1.0)
        .addScaledVector(normal, splayOut)
        .add(new THREE.Vector3(radialOutX, 0.10, (rng() - 0.5) * 0.12))
        .normalize();

      quat.setFromUnitVectors(upAxis, growthDir);
      twistQuat.setFromAxisAngle(upAxis, (rng() - 0.5) * 0.85);
      quat.multiply(twistQuat);

      const sizeFade = 1.0 - 0.36 * Math.pow(v, 1.3);
      const scaleW = (0.85 + rng() * 0.50) * sizeFade * (isEdgeRim || isBaseCollar ? 1.12 : 0.96);
      const scaleL = (0.76 + rng() * 0.44) * sizeFade * (isEdgeRim ? 1.06 : 0.92);

      const pos = p0.clone().addScaledVector(normal, -0.008);

      color.set(tier1Palette[Math.floor(rng() * tier1Palette.length)]);
      if (v > 0.70) color.lerp(this._tmpColor.set('#dec1b8'), 0.24);
      if (isBaseCollar) color.lerp(this._tmpColor.set('#b88f84'), 0.20);

      return {
        pos,
        normal: normal.clone(),
        quat: quat.clone(),
        scaleW,
        scaleL,
        isEdge: isEdgeRim,
        color: color.clone(),
      };
    });

    // --- TIER 2: Fine Delicate Inner Ear Furnishings (Warm Cream-Pink #e8d1c5) ---
    // 140 strands per ear at 100% (= 280 total across both ears, max 182 at 130%)
    const tier2Palette = ['#ecd6ca', '#f3e3da', '#e6ccc0', '#eedad0', '#e8d1c5'];
    buildFurTier(bladeGeos.tier2BladeGeo, furMats.furnishingMat, 3, 182, 140, () => {
      // Fan softly from the lower inner base upward and gently diagonally across the lower chocolate cavity
      const fromMedial = rng() < 0.60;
      const theta = fromMedial
        ? Math.PI * (0.62 + rng() * 0.34)
        : Math.PI * (0.04 + rng() * 0.30);
      const v = 0.04 + Math.pow(rng(), 1.35) * 0.34;

      sampleSurfaceFrame(theta, v);

      const acrossX = (fromMedial ? 0.52 + rng() * 0.38 : -(0.36 + rng() * 0.32)) * side;
      const upFlow = 0.78 + rng() * 0.52;
      const forwardArch = 0.18 + rng() * 0.22;
      growthDir.set(acrossX, upFlow, forwardArch).normalize();

      quat.setFromUnitVectors(upAxis, growthDir);
      twistQuat.setFromAxisAngle(upAxis, (rng() - 0.5) * 0.65);
      quat.multiply(twistQuat);

      const scaleW = 0.70 + rng() * 0.48;
      const scaleL = (0.72 + rng() * 0.48) * (1.0 - 0.30 * v);
      const pos = p0.clone().add(new THREE.Vector3(0, 0.01, 0.015));

      color.set(tier2Palette[Math.floor(rng() * tier2Palette.length)]);

      return {
        pos,
        normal: normal.clone(),
        quat: quat.clone(),
        scaleW,
        scaleL,
        isEdge: false,
        color: color.clone(),
      };
    });

    // --- TIER 3: Soft Fluffy Honey-Cream Outer Base Corner Tuft (#d9b47a) ---
    // 80 cotton-soft tufts per ear at 100% (= 160 total across both ears, max 104 at 130%)
    const tier3Palette = ['#d9b47a', '#e3c38e', '#d2aa6f', '#e9cfa0', '#dcba82'];
    buildFurTier(bladeGeos.tier3BladeGeo, furMats.honeyTuftMat, 4, 104, 80, () => {
      // Soft fuzzy cloud localized strictly at the outer lower base corner (matches reference photo)
      const theta = ((rng() - 0.5) * 0.95 + Math.PI * 2) % (Math.PI * 2);
      const v = 0.01 + rng() * 0.19;
      sampleSurfaceFrame(theta, v);

      growthDir
        .set((0.46 + rng() * 0.36) * side, 0.34 + (rng() - 0.45) * 0.48, 0.28 + (rng() - 0.45) * 0.36)
        .normalize();

      quat.setFromUnitVectors(upAxis, growthDir);
      twistQuat.setFromAxisAngle(upAxis, (rng() - 0.5) * 1.6);
      quat.multiply(twistQuat);

      const scaleW = 0.78 + rng() * 0.52;
      const scaleL = 0.72 + rng() * 0.46;
      const pos = p0.clone().add(new THREE.Vector3(0.02 * side, -0.01, 0.012));

      color.set(tier3Palette[Math.floor(rng() * tier3Palette.length)]);

      return {
        pos,
        normal: normal.clone(),
        quat: quat.clone(),
        scaleW,
        scaleL,
        isEdge: true,
        color: color.clone(),
      };
    });

    // --- TIER 4: Soft Feathered Apex Tip Wisps ---
    // 26 strands per ear at 100% (= 52 total across both ears, max 34 at 130%)
    const tier4Palette = ['#d6b5ab', '#e2c5bc', '#cca499', '#ead3cb'];
    buildFurTier(bladeGeos.tier4BladeGeo, furMats.outerFurMat, 2, 34, 26, () => {
      const theta = rng() * Math.PI * 2;
      const v = 0.84 + rng() * 0.14;
      sampleSurfaceFrame(theta, v);

      growthDir
        .set((0.12 + (rng() - 0.45) * 0.32) * side, 0.96, (rng() - 0.48) * 0.22)
        .normalize();

      quat.setFromUnitVectors(upAxis, growthDir);
      twistQuat.setFromAxisAngle(upAxis, (rng() - 0.5) * 1.0);
      quat.multiply(twistQuat);

      const scaleW = 0.72 + rng() * 0.42;
      const scaleL = 0.70 + rng() * 0.42;
      const pos = p0.clone();

      color.set(tier4Palette[Math.floor(rng() * tier4Palette.length)]);

      return {
        pos,
        normal: normal.clone(),
        quat: quat.clone(),
        scaleW,
        scaleL,
        isEdge: true,
        color: color.clone(),
      };
    });

    return pivot;
  }

  _updateFurFluffiness() {
    const fluff = clamp(this.config.fluffiness, 0.5, 1.3);
    // Smoothly adjust active instance count and blade plumpness/splay
    const widthMul = 0.72 + (fluff - 0.5) * 0.68;  // ~0.72 at 50%, 1.06 at 100%, 1.26 at 130%
    const lengthMul = 0.76 + (fluff - 0.5) * 0.56; // ~0.76 at 50%, 1.04 at 100%, 1.21 at 130%
    const edgeOutPush = (fluff - 1.0) * 0.025;

    for (let s = 0; s < this._furInstancedSystems.length; s++) {
      const sys = this._furInstancedSystems[s];
      const activeCount = clamp(Math.round(sys.baseCount100 * fluff), Math.floor(sys.baseCount100 * 0.45), sys.maxCount);
      sys.mesh.count = activeCount;

      for (let i = 0; i < activeCount; i++) {
        const rec = sys.records[i];
        this._dummy.position.copy(rec.pos);
        if (rec.isEdge && edgeOutPush !== 0) {
          this._dummy.position.addScaledVector(rec.normal, edgeOutPush);
        }
        this._dummy.quaternion.copy(rec.quat);
        const wS = rec.scaleW * widthMul * (rec.isEdge ? 1.0 + (fluff - 1.0) * 0.22 : 1.0);
        const lS = rec.scaleL * lengthMul;
        this._dummy.scale.set(wS, lS, wS);
        this._dummy.updateMatrix();
        sys.mesh.setMatrixAt(i, this._dummy.matrix);
      }
      sys.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  _buildFaceEffectsCluster() {
    const maxAniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

    // --- Zig-Zag Soft Chalk Blush on Both Cheeks ---
    const blushTex = this._trackTex(createZigZagBlushTexture(maxAniso));
    const blushGeo = this._trackGeo(createCurvedCheekGeometry(0.32, 0.165, 0.068));

    this.blushMaterial = this._trackMat(
      new THREE.MeshBasicMaterial({
        map: blushTex,
        transparent: true,
        opacity: this.config.blushOpacity,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );

    this.rightBlushMesh = new THREE.Mesh(blushGeo, this.blushMaterial);
    this.rightBlushMesh.renderOrder = 5;
    this.rightBlushMesh.rotation.set(0.06, 0.34, 0.10);

    this.leftBlushMesh = new THREE.Mesh(blushGeo, this.blushMaterial);
    this.leftBlushMesh.renderOrder = 5;
    this.leftBlushMesh.rotation.set(0.06, -0.34, -0.10);
    // Flip horizontal scale subtly on UV or keep zig-zag symmetrically mirrored across cheeks
    this.leftBlushMesh.scale.x = -1;

    this.faceAnchor.add(this.rightBlushMesh);
    this.faceAnchor.add(this.leftBlushMesh);

    // --- Sparse Translucent Sparkle & 4-Point Star Halo (58 particles total) ---
    const bokehTex = this._trackTex(createBokehDotTexture());
    const starTex = this._trackTex(createFourPointStarTexture());
    const rng = createSeededRandom(314159);

    // Exclusion check: strictly avoid eyes, eyelashes, lips, and central nostrils
    const isExcludedZone = (nx, ny) => {
      // Left & right eye + eyelash exclusion ovals
      const eRight = Math.pow((nx - 0.20) / 0.155, 2) + Math.pow((ny - 0.21) / 0.105, 2);
      const eLeft = Math.pow((nx + 0.20) / 0.155, 2) + Math.pow((ny - 0.21) / 0.105, 2);
      if (eRight < 1.0 || eLeft < 1.0) return true;

      // Mouth & lips exclusion oval
      const mouth = Math.pow(nx / 0.21, 2) + Math.pow((ny + 0.22) / 0.115, 2);
      if (mouth < 1.0) return true;

      // Nose tip / nostrils exclusion
      const noseTip = Math.pow(nx / 0.085, 2) + Math.pow((ny + 0.015) / 0.075, 2);
      if (noseTip < 1.0) return true;

      return false;
    };

    const targetCounts = [
      { zone: 'cheeksTemples', count: 32 },
      { zone: 'foreheadArc', count: 12 },
      { zone: 'noseBridge', count: 8 },
      { zone: 'jawPerimeter', count: 16 },
    ];

    this.sparklesGroup = new THREE.Group();
    this.faceAnchor.add(this.sparklesGroup);

    const sampleZone = (zone) => {
      for (let attempt = 0; attempt < 60; attempt++) {
        let nx = 0;
        let ny = 0;
        if (zone === 'cheeksTemples') {
          const s = rng() < 0.5 ? -1 : 1;
          nx = s * (0.31 + rng() * 0.25);
          ny = -0.20 + rng() * 0.46;
        } else if (zone === 'foreheadArc') {
          const s = rng() < 0.5 ? -1 : 1;
          nx = s * (0.14 + rng() * 0.34);
          ny = 0.34 + rng() * 0.17;
        } else if (zone === 'noseBridge') {
          nx = (rng() - 0.5) * 0.16;
          ny = 0.07 + rng() * 0.12;
        } else {
          // Outer jawline / lower perimeter
          const s = rng() < 0.5 ? -1 : 1;
          nx = s * (0.24 + rng() * 0.24);
          ny = -0.40 + rng() * 0.18;
        }

        if (!isExcludedZone(nx, ny)) {
          // Follow curved 3D oval depth of the face around nose tip
          const nz =
            (zone === 'noseBridge' ? 0.03 : 0.02 - 0.56 * nx * nx - 0.20 * ny * ny) +
            (rng() - 0.5) * 0.06;
          return { nx, ny, nz };
        }
      }
      return { nx: 0.42, ny: 0.02, nz: -0.10 };
    };

    for (let z = 0; z < targetCounts.length; z++) {
      const { zone, count } = targetCounts[z];
      for (let i = 0; i < count; i++) {
        const pt = sampleZone(zone);
        const isStar = rng() < 0.28; // ~28% tiny 4-point pearl stars, ~72% ultra-fine bokeh dots

        const mat = this._trackMat(
          new THREE.SpriteMaterial({
            map: isStar ? starTex : bokehTex,
            color: new THREE.Color('#fffdf9'),
            transparent: true,
            opacity: 0.32,
            depthWrite: false,
            blending: THREE.NormalBlending,
          })
        );

        const sprite = new THREE.Sprite(mat);
        sprite.renderOrder = 6;
        this.sparklesGroup.add(sprite);

        const baseSize = isStar ? 0.028 + rng() * 0.026 : 0.015 + rng() * 0.022;
        const baseAlphaMin = 0.20 + rng() * 0.08;
        const baseAlphaMax = 0.36 + rng() * 0.16; // within [0.20 .. 0.52]

        this._sparkleItems.push({
          sprite,
          mat,
          nx: pt.nx,
          ny: pt.ny,
          nz: pt.nz,
          baseSize,
          alphaMin: baseAlphaMin,
          alphaMax: baseAlphaMax,
          phase: rng() * Math.PI * 2,
          speed: 0.75 + rng() * 1.15,
          driftFreq: 0.45 + rng() * 0.65,
          driftAmp: 0.008 + rng() * 0.010,
        });
      }
    }
  }

  setOptions(partial = {}) {
    Object.assign(this.config, partial);
    if (this.blushMaterial) {
      this.blushMaterial.opacity = clamp(this.config.blushOpacity, 0.05, 0.9);
    }
    this._updateFurFluffiness();
  }

  triggerEarTwitch(side) {
    const target = side === 'left' ? this._springs.left : side === 'right' ? this._springs.right : Math.random() < 0.5 ? this._springs.left : this._springs.right;
    target.twitchVel += 4.6;
  }

  triggerHeadBounce(impulseX = 2.4, impulseY = 2.0) {
    this._springs.left.velZ += impulseX;
    this._springs.right.velZ += impulseX;
    this._springs.left.velX += impulseY;
    this._springs.right.velX += impulseY;
  }

  _stepPhysicsAndEffects(dt, faceWidth, faceHeight, headScale) {
    const safeDt = Math.min(0.05, Math.max(0.001, dt));
    this._elapsed += safeDt;

    // Occasional natural single-ear twitch
    if (this._elapsed >= this._nextTwitchTime) {
      this._nextTwitchTime = this._elapsed + 3.4 + Math.random() * 4.4;
      const target = Math.random() < 0.5 ? this._springs.left : this._springs.right;
      target.twitchVel += 3.2 + Math.random() * 1.6;
    }

    // Damped spring integration for left & right ears
    const stiffness = 138;
    const damping = 12.2;
    const twitchStiff = 240;
    const twitchDamp = 16.5;

    const stepEar = (st, pivot, side) => {
      st.velZ += (-stiffness * st.angleZ - damping * st.velZ) * safeDt;
      st.angleZ = clamp(st.angleZ + st.velZ * safeDt, -0.34, 0.34);

      st.velX += (-stiffness * st.angleX - damping * st.velX) * safeDt;
      st.angleX = clamp(st.angleX + st.velX * safeDt, -0.28, 0.28);

      st.twitchVel += (-twitchStiff * st.twitch - twitchDamp * st.twitchVel) * safeDt;
      st.twitch = clamp(st.twitch + st.twitchVel * safeDt, -0.22, 0.26);

      // Subtle breathing sway
      const idleSway = Math.sin(this._elapsed * 1.6 + (side > 0 ? 0 : 0.7)) * 0.012;

      pivot.rotation.set(
        pivot.userData.baseRotX + st.angleX + st.twitch * 0.45,
        pivot.userData.baseRotY + st.twitch * 0.32 * side,
        pivot.userData.baseRotZ + st.angleZ - st.twitch * 0.65 * side + idleSway
      );
    };

    stepEar(this._springs.right, this.rightEarPivot, +1);
    stepEar(this._springs.left, this.leftEarPivot, -1);

    // Position ears proportionally: +/- earSpacing * faceWidth (default 0.46)
    // Base scale reduced to ~55% of previous build so default 60% earScale matches reference photo
    const earOffsetX = this.config.earSpacing * faceWidth;
    const earUnitScale = headScale * 0.51 * this.config.earScale;

    this.rightEarPivot.position.set(earOffsetX, 0, 0);
    this.rightEarPivot.scale.setScalar(earUnitScale);

    this.leftEarPivot.position.set(-earOffsetX, 0, 0);
    this.leftEarPivot.scale.setScalar(earUnitScale);

    // Position zig-zag blush patches relative to nose tip: +/- 0.35 * faceWidth, height -0.03 * faceHeight
    const blushX = 0.35 * faceWidth;
    const blushY = -0.03 * faceHeight;
    const blushZ = -0.105 * faceHeight;
    const blushScale = headScale * 0.96;

    this.rightBlushMesh.position.set(blushX, blushY, blushZ);
    this.rightBlushMesh.scale.set(blushScale, blushScale, blushScale);

    this.leftBlushMesh.position.set(-blushX, blushY, blushZ);
    this.leftBlushMesh.scale.set(-blushScale, blushScale, blushScale);

    // Update sparse pearl sparkles (controls both gentle sparsity and subtle translucency)
    const sparkleSlider = clamp(this.config.sparkleOpacity, 0.1, 0.8);
    const sparkleRatio = sparkleSlider / 0.35;
    const activeSparkleCount = clamp(
      Math.round(34 + ((sparkleSlider - 0.1) / 0.7) * 34),
      30,
      this._sparkleItems.length
    );

    for (let i = 0; i < this._sparkleItems.length; i++) {
      const item = this._sparkleItems[i];
      if (i >= activeSparkleCount) {
        item.sprite.visible = false;
        continue;
      }
      item.sprite.visible = true;

      const wave = 0.5 + 0.5 * Math.sin(this._elapsed * item.speed + item.phase);
      const driftX = Math.sin(this._elapsed * item.driftFreq + item.phase) * item.driftAmp * faceWidth;
      const driftY = Math.cos(this._elapsed * item.driftFreq * 0.85 + item.phase) * item.driftAmp * faceHeight;
      const driftZ = Math.sin(this._elapsed * item.driftFreq * 0.6 + item.phase * 1.3) * item.driftAmp * 0.6 * faceHeight;

      item.sprite.position.set(
        item.nx * faceWidth + driftX,
        item.ny * faceHeight + driftY,
        item.nz * faceHeight + driftZ
      );

      const s = item.baseSize * headScale * (0.85 + 0.30 * wave);
      item.sprite.scale.set(s, s, 1);

      const baseOpacity = item.alphaMin + (item.alphaMax - item.alphaMin) * wave;
      item.mat.opacity = clamp(baseOpacity * sparkleRatio, 0.04, 0.78);
    }
  }

  // Apply 3D landmark positions already expressed in world coordinates (used internally & in 3D preview)
  applyWorldLandmarks(p1, p10, p152, p234, p454, mirror = true, customDt) {
    const now = performance.now();
    const dt = customDt !== undefined ? customDt : (now - this._lastTime) * 0.001;
    this._lastTime = now;

    const faceHeight = p10.distanceTo(p152);
    const faceWidth = p234.distanceTo(p454);
    if (faceHeight < 1e-4 || faceWidth < 1e-4) {
      this.rootGroup.visible = false;
      return;
    }

    const headScale = faceWidth * 0.55 + faceHeight * 0.45;

    // Build orthonormal local 3D head basis: rightVec (234 -> 454), upVec (152 -> 10), forwardVec = right x up
    if (mirror) {
      this._rightVec.subVectors(p234, p454).normalize();
    } else {
      this._rightVec.subVectors(p454, p234).normalize();
    }
    this._upVec.subVectors(p10, p152).normalize();
    this._forwardVec.crossVectors(this._rightVec, this._upVec).normalize();

    // Ensure forwardVec consistently points out of the face toward nose tip / camera
    this._tmpVecA.addVectors(p234, p454).multiplyScalar(0.5);
    this._tmpVecB.subVectors(p1, this._tmpVecA);
    if (this._forwardVec.dot(this._tmpVecB) < 0) {
      this._forwardVec.negate();
      this._rightVec.negate();
    }

    // Re-orthogonalize upVec = forwardVec x rightVec for pure determinant +1 rotation matrix
    this._upVec.crossVectors(this._forwardVec, this._rightVec).normalize();
    this._basisMat.makeBasis(this._rightVec, this._upVec, this._forwardVec);
    this._headQuat.setFromRotationMatrix(this._basisMat);
    this._headEuler.setFromQuaternion(this._headQuat, 'YXZ');

    // Feed angular and translational head velocity into ear spring physics
    if (this._hasPrevPose && dt > 0.0005 && dt < 0.25) {
      const invDt = 1.0 / dt;
      const dRoll = clamp((this._headEuler.z - this._prevHeadEuler.z) * invDt, -12, 12);
      const dPitch = clamp((this._headEuler.x - this._prevHeadEuler.x) * invDt, -12, 12);
      const dYaw = clamp((this._headEuler.y - this._prevHeadEuler.y) * invDt, -12, 12);
      const dMoveY = clamp(((p10.y - this._prevHeadPos.y) / Math.max(0.05, headScale)) * invDt, -10, 10);
      const dMoveX = clamp(((p10.x - this._prevHeadPos.x) / Math.max(0.05, headScale)) * invDt, -10, 10);

      this._springs.right.velZ += (-dRoll * 0.38 - dMoveX * 0.42 + dMoveY * 0.24) * dt * 18;
      this._springs.left.velZ += (-dRoll * 0.38 - dMoveX * 0.42 - dMoveY * 0.24) * dt * 18;
      this._springs.right.velX += (-dPitch * 0.36 + dYaw * 0.20) * dt * 18;
      this._springs.left.velX += (-dPitch * 0.36 - dYaw * 0.20) * dt * 18;
    }

    this._prevHeadEuler.copy(this._headEuler);
    this._prevHeadPos.copy(p10);
    this._hasPrevPose = true;

    // Cluster 1 (Ears): anchored at forehead landmark[10] + upVec * (earHeight * faceHeight) - forwardVec * (0.12 * faceHeight)
    this._earCenter
      .copy(p10)
      .addScaledVector(this._upVec, this.config.earHeight * faceHeight)
      .addScaledVector(this._forwardVec, -this.config.earDepthBack * faceHeight);

    this.earsAnchor.position.copy(this._earCenter);
    this.earsAnchor.quaternion.copy(this._headQuat);

    // Cluster 2 (Face Effects): anchored at nose tip landmark[1] synchronized with 3D head orientation
    this.faceAnchor.position.copy(p1);
    this.faceAnchor.quaternion.copy(this._headQuat);

    this._stepPhysicsAndEffects(dt, faceWidth, faceHeight, headScale);
    this.rootGroup.visible = true;
  }

  _resizeIfNeeded(width, height) {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (w !== this._width || h !== this._height) {
      this._width = w;
      this._height = h;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  _landmarkToWorld(lm, viewW, viewH, mirror, target) {
    const x = (mirror ? 0.5 - lm.x : lm.x - 0.5) * viewW;
    const y = (0.5 - lm.y) * viewH;
    // MediaPipe z shares x scale and is negative closer to camera
    const z = -(lm.z || 0) * viewW;
    target.set(x, y, z);
    return target;
  }

  // Standard Photobooth API: update(landmarks, width, height, mirror = true)
  update(landmarks, width, height, mirror = true) {
    if (this._disposed) return;

    const w = width || this.canvas.width || 640;
    const h = height || this.canvas.height || 480;
    this._resizeIfNeeded(w, h);

    if (!landmarks || landmarks.length < 455) {
      this.clear();
      return;
    }

    // Compute visible frustum plane at z = 0 matching the video frame aspect
    const camZ = this.camera.position.z;
    const vFovRad = THREE.MathUtils.degToRad(this.camera.fov);
    const viewH = 2 * Math.tan(vFovRad * 0.5) * camZ;
    const viewW = viewH * this.camera.aspect;

    this._landmarkToWorld(landmarks[1], viewW, viewH, mirror, this._p1);
    this._landmarkToWorld(landmarks[10], viewW, viewH, mirror, this._p10);
    this._landmarkToWorld(landmarks[152], viewW, viewH, mirror, this._p152);
    this._landmarkToWorld(landmarks[234], viewW, viewH, mirror, this._p234);
    this._landmarkToWorld(landmarks[454], viewW, viewH, mirror, this._p454);

    this.applyWorldLandmarks(this._p1, this._p10, this._p152, this._p234, this._p454, mirror);
    this.renderer.render(this.scene, this.camera);
  }

  clear() {
    if (this._disposed) return;
    this.rootGroup.visible = false;
    this._hasPrevPose = false;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, true, true);
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;

    for (let i = 0; i < this._geometries.length; i++) {
      this._geometries[i].dispose();
    }
    for (let i = 0; i < this._materials.length; i++) {
      this._materials[i].dispose();
    }
    for (let i = 0; i < this._textures.length; i++) {
      this._textures[i].dispose();
    }

    this._geometries.length = 0;
    this._materials.length = 0;
    this._textures.length = 0;
    this._furInstancedSystems.length = 0;
    this._sparkleItems.length = 0;

    this.renderer.dispose();
  }
}

if (typeof window !== 'undefined') {
  window.FluffyEarsFilter3D = FluffyEarsFilter3D;
}

export default FluffyEarsFilter3D;
