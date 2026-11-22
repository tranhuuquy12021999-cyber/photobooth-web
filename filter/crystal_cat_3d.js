import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js';

/**
 * CrystalCatFilter3D — Standalone Three.js Iridescent Jelly Crystal Cat AR Filter
 * Zero external textures or dependencies beyond Three.js r169 CDN.
 *
 * Baked configuration defaults:
 *   earHeight     = 0.26 (0.26 * faceHeight)
 *   earScale      = 0.8 (80%)
 *   earOpacity    = 0.08 (8%)
 *   glowIntensity = 1 (100%)
 *
 * API:
 *   const filter = new CrystalCatFilter3D(canvas, options);
 *   filter.update(landmarks, width, height, mirror = true);
 *   filter.clear();
 *   filter.dispose();
 */

const DEFAULT_CONFIG = Object.freeze({
  earHeight: 0.26,
  earScale: 0.8,
  earOpacity: 0.08,
  glowIntensity: 1,
});

// ============================================================================
// Custom Fresnel Jelly Shaders (No transmission — pure alpha-preserving WebGL)
// ============================================================================

const EAR_VERTEX_SHADER = `
  varying vec3 vViewNormal;
  varying vec3 vViewDir;
  varying vec3 vLocalPos;
  varying vec3 vLocalNormal;

  void main() {
    vLocalPos = position;
    vLocalNormal = normalize(normal);
    vViewNormal = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;
const EAR_FRAGMENT_SHADER = `
  uniform float uTime;
  uniform float uEarOpacity;
  uniform float uGlowIntensity;
  uniform float uIsBack;
  uniform float uSideSign;

  varying vec3 vViewNormal;
  varying vec3 vViewDir;
  varying vec3 vLocalPos;
  varying vec3 vLocalNormal;

  void main() {
    vec3 N = normalize(vViewNormal);
    vec3 V = normalize(vViewDir);
    if (!gl_FrontFacing) {
      N = -N;
    }

    float ndotv = clamp(dot(N, V), 0.0, 1.0);
    // Crisp glass-bubble Fresnel rim: stays ultra-clear in center, pops vibrantly on rounded bevel edges
    float fresnel = pow(1.0 - ndotv, 2.35);
    float midRim = pow(1.0 - ndotv, 1.65);
    float tightRim = pow(1.0 - ndotv, 4.6);

    // Local coordinates normalized to the extruded asymmetric curved ear bounds:
    // y runs roughly from -0.60 (bottom bevel) to +1.08 (top apex bevel)
    float ny = clamp((vLocalPos.y + 0.60) / 1.68, 0.0, 1.0);
    // outerX < 0 is INNER convex arch (facing head center), outerX > 0 is OUTER gently concave flank
    float outerX = clamp((vLocalPos.x * uSideSign) / 0.90, -1.0, 1.0);

    // Reference photo palette:
    // 1. Top apex: translucent milky-white pearlescent glass & smooth curved reflection
    // 2. Both side rims (especially sweeping inner arch & outer flank): bright pastel neon lime-green
    // 3. Bottom base edge next to hair: luminous magenta-pink with thin sparkling lemon-yellow corner/outer rim
    vec3 milkyWhite = vec3(1.0, 0.99, 1.0);
    vec3 pastelNeonGreen = vec3(0.46, 1.0, 0.44);
    vec3 mintHighlight = vec3(0.70, 1.0, 0.64);
    vec3 magentaPink = vec3(1.0, 0.24, 0.72);
    vec3 lemonYellow = vec3(1.0, 0.98, 0.36);

    float shimmer = sin(uTime * 1.4 + vLocalPos.x * 2.4 - vLocalPos.y * 1.8) * 0.035;

    // Region weights tailored to the asymmetric curved ear silhouette:
    // Top dome leans slightly outward (+outerX), so tilt the top mask gently along outerX
    float topCoord = ny + outerX * 0.10 + shimmer * 0.25;
    float topMask = smoothstep(0.60, 0.90, topCoord);

    // Bottom edge along hair
    float bottomMask = 1.0 - smoothstep(0.06, 0.30, ny - shimmer * 0.2);

    // Two side flanks (inner sweeping arch & outer edge)
    float sideMask = clamp(1.0 - topMask * 0.94 - bottomMask * 0.88, 0.0, 1.0);

    // Bottom edge: vibrant magenta-pink glow inside the bevel + crisp thin lemon-yellow outer lip & corners
    float bottomCorner = smoothstep(0.28, 0.85, abs(outerX)) * (1.0 - smoothstep(0.08, 0.32, ny));
    float yellowLip = clamp(smoothstep(0.32, 0.82, tightRim) * 1.1 + bottomCorner * 0.65, 0.0, 1.0);
    vec3 bottomColor = mix(magentaPink, lemonYellow, yellowLip * (1.0 - smoothstep(0.10, 0.28, ny)));

    // Side edges: crisp bright pastel neon green, especially vivid on the sweeping inner arch
    float innerBoost = smoothstep(0.10, -0.55, outerX);
    vec3 sideColor = mix(pastelNeonGreen, mintHighlight, smoothstep(0.42, 0.78, ny) * 0.45);
    sideColor = mix(sideColor, pastelNeonGreen * 1.08, innerBoost * 0.4);
    // Smooth warm yellow-green corner bridge at bottom-outer & bottom-inner turns
    sideColor = mix(sideColor, lemonYellow, bottomCorner * 0.38);

    // Blend all three rim zones seamlessly
    vec3 rimColor = sideColor * sideMask + bottomColor * bottomMask + milkyWhite * topMask;
    rimColor = mix(rimColor, milkyWhite, tightRim * (0.26 + 0.62 * topMask));

    // Smooth curved glass specular reflection sweeping across the upper milky dome
    vec3 L1 = normalize(vec3(-0.18 * uSideSign, 0.78, 0.84));
    vec3 H1 = normalize(L1 + V);
    float topGlassMask = smoothstep(0.44, 0.94, topCoord);
    float specDome = pow(max(dot(N, H1), 0.0), 16.0) * topGlassMask;
    float specCrisp = pow(max(dot(N, H1), 0.0), 58.0) * smoothstep(0.36, 0.95, topCoord);

    vec3 L2 = normalize(vec3(0.35 * uSideSign, 0.52, 0.82));
    vec3 H2 = normalize(L2 + V);
    float specRim = pow(max(dot(N, H2), 0.0), 34.0) * fresnel;

    float glow = clamp(uGlowIntensity, 0.45, 1.6);

    if (uIsBack > 0.5) {
      // Ultra-subtle back bevel bounce ONLY on edges — zero fog in center so hair stays razor sharp
      float backAlpha = pow(1.0 - ndotv, 3.0) * 0.16 * glow;
      vec3 backCol = mix(rimColor, milkyWhite, 0.25);
      gl_FragColor = vec4(backCol, clamp(backAlpha, 0.0, 0.30));
      return;
    }

    // ULTRA-CLEAR center interior (alpha ~0.05 - 0.10 at default earOpacity = 0.08)
    // Pure crystal clarity over lower hair; soft translucent milky-white veil only at upper peak
    float milkyCapVeil = smoothstep(0.58, 0.96, topCoord);
    float centerAlpha = uEarOpacity * (0.68 + 0.95 * milkyCapVeil);
    float milkySheenAlpha = milkyCapVeil * (0.14 + 0.18 * midRim);

    // Crisp glowing Fresnel bevel rim
    float rimAlpha = (fresnel * 0.78 + tightRim * 0.44) * (0.76 + 0.30 * glow);
    float specAlpha = (specDome * 0.34 + specCrisp * 0.62 + specRim * 0.22) * (0.78 + 0.24 * glow);

    // Keep interior tint clean white-crystal (never grey/muddy)
    vec3 interiorColor = mix(vec3(0.98, 1.0, 0.99), milkyWhite, milkyCapVeil);
    vec3 color = mix(interiorColor, rimColor * (0.90 + 0.22 * glow), clamp(fresnel * 1.25 + tightRim * 0.5, 0.0, 1.0));
    color += milkyWhite * (specDome * 0.48 + specCrisp * 0.85 + specRim * 0.28) * (0.8 + 0.2 * glow);

    float alpha = clamp(centerAlpha + milkySheenAlpha + rimAlpha + specAlpha, 0.0, 0.95);
    gl_FragColor = vec4(color, alpha);
  }
`;
const STRAWBERRY_VERTEX_SHADER = `
  varying vec3 vViewNormal;
  varying vec3 vViewDir;
  varying vec3 vLocalPos;

  void main() {
    vLocalPos = position;
    vViewNormal = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;
const STRAWBERRY_FRAGMENT_SHADER = `
  uniform float uGlowIntensity;
  uniform float uTime;

  varying vec3 vViewNormal;
  varying vec3 vViewDir;
  varying vec3 vLocalPos;

  void main() {
    vec3 N = normalize(vViewNormal);
    vec3 V = normalize(vViewDir);
    if (!gl_FrontFacing) N = -N;

    float ndotv = clamp(dot(N, V), 0.0, 1.0);
    float fresnel = pow(1.0 - ndotv, 1.9);
    float tightRim = pow(1.0 - ndotv, 4.0);

    // ny: 0 at fuller bottom belly/calyx, 1 at tapered rounded upper tip
    float ny = clamp((vLocalPos.y + 0.54) / 1.08, 0.0, 1.0);

    // Translucent jelly strawberry: fresh translucent coral-red/rose top -> soft lavender bottom
    vec3 topStrawberryRed = vec3(1.0, 0.24, 0.36);
    vec3 midJellyPink = vec3(1.0, 0.44, 0.62);
    vec3 bottomSoftViolet = vec3(0.66, 0.44, 0.98);

    vec3 bodyCol = mix(bottomSoftViolet, midJellyPink, smoothstep(0.10, 0.55, ny));
    bodyCol = mix(bodyCol, topStrawberryRed, smoothstep(0.46, 0.90, ny));

    vec3 rimCol = mix(vec3(0.92, 0.72, 1.0), vec3(1.0, 0.86, 0.90), ny);
    rimCol = mix(rimCol, vec3(1.0, 0.98, 1.0), tightRim * 0.72);

    // Juicy curved white candy-glass specular highlight across upper dome
    vec3 L = normalize(vec3(-0.28, 0.64, 0.82));
    vec3 H = normalize(L + V);
    float specMain = pow(max(dot(N, H), 0.0), 20.0);
    float specCrisp = pow(max(dot(N, H), 0.0), 68.0);

    float glow = clamp(uGlowIntensity, 0.45, 1.6);
    vec3 color = mix(bodyCol, rimCol * (0.92 + 0.18 * glow), clamp(fresnel * 1.05, 0.0, 1.0));
    color += vec3(1.0, 0.98, 1.0) * (specMain * 0.46 + specCrisp * 0.86) * (0.8 + 0.2 * glow);

    // Translucent glass jelly interior (~0.20 center), luminous glossy rim
    float alpha = clamp(0.19 + fresnel * 0.66 + specMain * 0.34 + specCrisp * 0.44, 0.0, 0.94);
    gl_FragColor = vec4(color, alpha);
  }
`;
const CALYX_FRAGMENT_SHADER = `
  uniform float uGlowIntensity;

  varying vec3 vViewNormal;
  varying vec3 vViewDir;
  varying vec3 vLocalPos;

  void main() {
    vec3 N = normalize(vViewNormal);
    vec3 V = normalize(vViewDir);
    if (!gl_FrontFacing) N = -N;

    float ndotv = clamp(dot(N, V), 0.0, 1.0);
    float fresnel = pow(1.0 - ndotv, 1.75);

    vec3 leafBase = vec3(0.84, 0.97, 0.86);
    vec3 leafTip = vec3(1.0, 0.82, 0.94);
    float tipBlend = clamp(length(vLocalPos.xz) * 2.2, 0.0, 1.0);
    vec3 col = mix(leafBase, leafTip, tipBlend * 0.55);
    col = mix(col, vec3(1.0), fresnel * 0.65);

    float glow = clamp(uGlowIntensity, 0.5, 1.5);
    float alpha = clamp((0.18 + fresnel * 0.48) * (0.78 + 0.22 * glow), 0.0, 0.82);
    gl_FragColor = vec4(col, alpha);
  }
`;
const NOSE_FRAGMENT_SHADER = `
  uniform float uGlowIntensity;
  uniform float uTime;

  varying vec3 vViewNormal;
  varying vec3 vViewDir;
  varying vec3 vLocalPos;

  void main() {
    vec3 N = normalize(vViewNormal);
    vec3 V = normalize(vViewDir);
    if (!gl_FrontFacing) N = -N;

    float ndotv = clamp(dot(N, V), 0.0, 1.0);
    float fresnel = pow(1.0 - ndotv, 2.05);
    float tightRim = pow(1.0 - ndotv, 4.4);

    // ny: 0 at bottom heart tip, 1 at top rounded heart lobes
    float ny = clamp((vLocalPos.y + 0.56) / 1.12, 0.0, 1.0);

    vec3 softBabyPink = vec3(1.0, 0.82, 0.91);
    vec3 hintLilac = vec3(0.92, 0.82, 0.99);
    vec3 rosyPinkBottom = vec3(1.0, 0.42, 0.78);
    vec3 glossyWhite = vec3(1.0, 0.99, 1.0);

    // Translucent light pink center so skin softly shows through like jelly glass
    vec3 bodyCol = mix(softBabyPink, hintLilac, smoothstep(0.3, 0.85, ndotv) * 0.35);

    // Glowing rosy pink along the bottom edge
    float lowerMask = 1.0 - smoothstep(0.10, 0.54, ny);
    bodyCol = mix(bodyCol, rosyPinkBottom, lowerMask * (0.42 + fresnel * 0.65));

    // Smooth continuous glossy white band along upper heart contour (no circular dot specular)
    float topRimGloss = smoothstep(0.54, 0.94, ny) * smoothstep(-0.05, 0.55, vLocalPos.z + 0.18);
    float upperSoftRim = smoothstep(0.45, 0.90, ny) * fresnel;

    float glow = clamp(uGlowIntensity, 0.5, 1.5);
    vec3 rimCol = mix(rosyPinkBottom, glossyWhite, smoothstep(0.35, 0.80, ny));

    vec3 color = mix(bodyCol, rimCol * (0.94 + 0.14 * glow), clamp(fresnel * 0.92, 0.0, 1.0));
    color = mix(color, glossyWhite, clamp(topRimGloss * 0.54 + upperSoftRim * 0.52, 0.0, 0.92));
    color += glossyWhite * tightRim * 0.24 * glow;

    // Clean translucent pastel pink center (~0.36) with smooth continuous white top rim & rosy bottom rim
    float alpha = clamp(0.36 + fresnel * 0.44 + topRimGloss * 0.26 + lowerMask * fresnel * 0.16, 0.0, 0.94);
    gl_FragColor = vec4(color, alpha);
  }
`;
const WHISKER_VERTEX_SHADER = `
  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying vec3 vViewDir;

  void main() {
    vUv = uv;
    vViewNormal = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;
const WHISKER_FRAGMENT_SHADER = `
  uniform float uGlowIntensity;

  varying vec2 vUv;
  varying vec3 vViewNormal;
  varying vec3 vViewDir;

  void main() {
    vec3 N = normalize(vViewNormal);
    vec3 V = normalize(vViewDir);
    if (!gl_FrontFacing) N = -N;

    float ndotv = clamp(dot(N, V), 0.0, 1.0);
    // Clear glass-tube Fresnel rim: sheer center, delicate bright white rim along tube contour
    float fresnel = pow(1.0 - ndotv, 1.9);

    // Smoothly fades to alpha = 0 at BOTH ends:
    // - Long seamless fade from inner nose root (0.0 -> 0.42)
    // - Soft delicate fade-out at outer tip (0.84 -> 1.0)
    float rootFade = smoothstep(0.0, 0.42, vUv.x);
    float tipFade = smoothstep(1.0, 0.84, vUv.x);
    float endFade = rootFade * tipFade;

    vec3 L = normalize(vec3(0.0, 0.75, 0.85));
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 28.0);

    vec3 glassTint = vec3(0.97, 0.99, 1.0);
    vec3 pureWhite = vec3(1.0, 1.0, 1.0);
    float glow = clamp(uGlowIntensity, 0.5, 1.5);

    vec3 color = mix(glassTint, pureWhite, clamp(fresnel * 0.85 + spec * 0.75, 0.0, 1.0));
    color *= (0.96 + 0.12 * glow);

    // Translucent clear glass-tube opacity: max ~0.45 - 0.55 at mid-shaft, blending naturally onto skin
    float glassAlpha = (0.14 + fresnel * 0.34 + spec * 0.14) * (0.82 + 0.18 * glow);
    float alpha = clamp(glassAlpha, 0.0, 0.55) * endFade;

    if (alpha < 0.004) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;
const SPARKLE_VERTEX_SHADER = `
  attribute float aSize;
  attribute float aPhase;
  attribute float aSpeed;
  attribute float aKind;

  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uScaleFactor;

  varying float vTwinkle;
  varying float vKind;

  void main() {
    vKind = aKind;
    float wave = 0.5 + 0.5 * sin(uTime * aSpeed + aPhase);
    vTwinkle = 0.42 + 0.58 * pow(wave, 1.5);

    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPos;

    float depth = max(-mvPos.z, 0.1);
    float sizePx = aSize * uScaleFactor * uPixelRatio * (0.84 + 0.28 * vTwinkle) / depth;
    gl_PointSize = clamp(sizePx, 2.0, 56.0);
  }
`;
const SPARKLE_FRAGMENT_SHADER = `
  uniform sampler2D uMap;
  uniform float uGlowIntensity;

  varying float vTwinkle;
  varying float vKind;

  void main() {
    float glow = clamp(uGlowIntensity, 0.45, 1.65);

    if (vKind > 0.5) {
      float d = length(gl_PointCoord - vec2(0.5));
      float core = smoothstep(0.46, 0.05, d);
      float alpha = core * core * vTwinkle * clamp(0.88 * glow, 0.45, 1.0);
      if (alpha < 0.02) discard;
      gl_FragColor = vec4(vec3(1.0, 0.99, 1.0), alpha);
      return;
    }

    vec4 tex = texture2D(uMap, gl_PointCoord);
    float alpha = tex.a * vTwinkle * clamp(0.96 * glow, 0.48, 1.0);
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(tex.rgb * (0.96 + 0.2 * glow), alpha);
  }
`;

// ============================================================================
// Procedural Textures & Geometry Builders
// ============================================================================

function createStarSparkleTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const half = size / 2;

  ctx.clearRect(0, 0, size, size);

  const halo = ctx.createRadialGradient(half, half, 0, half, half, half * 0.56);
  halo.addColorStop(0, 'rgba(255, 255, 255, 0.98)');
  halo.addColorStop(0.2, 'rgba(248, 252, 255, 0.45)');
  halo.addColorStop(0.55, 'rgba(230, 245, 255, 0.08)');
  halo.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);

  ctx.save();
  ctx.translate(half, half);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  const outerR = half * 0.95;
  const innerR = half * 0.095;
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    const r = i % 2 === 0 ? outerR : innerR;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();

  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.48)';
  ctx.beginPath();
  const diagOuter = half * 0.30;
  const diagInner = half * 0.06;
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    const r = i % 2 === 0 ? diagOuter : diagInner;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  const core = ctx.createRadialGradient(half, half, 0, half, half, half * 0.18);
  core.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  core.addColorStop(0.55, 'rgba(255, 255, 255, 0.85)');
  core.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0.0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function heartNoseSDF(x, y) {
  const ax = Math.abs(x);
  const lobeDist = Math.hypot(ax - 0.34, y - 0.17) - 0.44;
  const lowerEdge = (ax * 0.78 - (y + 0.52) * 0.62) - 0.04;
  const topCap = y - 0.62;
  const lowerHull = -smin(-lowerEdge, -topCap, 0.22);
  return smin(lobeDist, Math.max(lowerHull, Math.hypot(ax, y + 0.08) - 0.72), 0.14);
}

function solveBoundaryRadius(sdf, dx, dy, maxR = 1.6) {
  let lo = 0.05;
  let hi = maxR;
  for (let i = 0; i < 16; i++) {
    const mid = 0.5 * (lo + hi);
    if (sdf(dx * mid, dy * mid) < 0) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * Asymmetric curved cartoon cat-ear built with smooth bezierCurveTo THREE.Shape
 * and high-segment ExtrudeGeometry (curveSegments: 48, bevelSegments: 16).
 */
function createPuffyEarGeometry(sideSign = 1) {
  const shape = new THREE.Shape();
  shape.moveTo(0.0, -0.45);
  shape.bezierCurveTo(0.45, -0.46, 0.80, -0.40, 0.74, -0.14);
  shape.bezierCurveTo(0.67, 0.12, 0.57, 0.36, 0.53, 0.64);
  shape.bezierCurveTo(0.49, 0.90, 0.22, 0.96, -0.09, 0.78);
  shape.bezierCurveTo(-0.46, 0.56, -0.84, 0.20, -0.74, -0.16);
  shape.bezierCurveTo(-0.66, -0.44, -0.36, -0.45, 0.0, -0.45);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.036,
    bevelEnabled: true,
    bevelThickness: 0.21,
    bevelSize: 0.15,
    bevelOffset: 0,
    bevelSegments: 16,
    curveSegments: 48,
  });

  geo.computeBoundingBox();
  const midZ = (geo.boundingBox.min.z + geo.boundingBox.max.z) * 0.5;
  geo.translate(0, 0, -midZ);

  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const halfW = Math.max((bb.max.x - bb.min.x) * 0.5, 0.001);
  const halfH = Math.max((bb.max.y - bb.min.y) * 0.5, 0.001);
  const cx = (bb.min.x + bb.max.x) * 0.5;
  const cy = (bb.min.y + bb.max.y) * 0.5;

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    const y = pos.getY(i);
    let z = pos.getZ(i);

    const nx = (x - cx) / halfW;
    const ny = (y - cy) / halfH;
    const r2 = Math.min(nx * nx + ny * ny, 1.0);
    const dome = Math.max(0, 1.0 - r2);
    const signZ = z >= 0 ? 1 : -1;
    z += signZ * dome * 0.11;
    z -= r2 * 0.045;

    if (sideSign < 0) x = -x;
    pos.setXYZ(i, x, y, z);
  }

  if (sideSign < 0) {
    if (geo.index) {
      const idx = geo.index;
      for (let i = 0; i < idx.count; i += 3) {
        const b = idx.getX(i + 1);
        const c = idx.getX(i + 2);
        idx.setX(i + 1, c);
        idx.setX(i + 2, b);
      }
      idx.needsUpdate = true;
    } else {
      for (let i = 0; i < pos.count; i += 3) {
        const x1 = pos.getX(i + 1);
        const y1 = pos.getY(i + 1);
        const z1 = pos.getZ(i + 1);
        pos.setXYZ(i + 1, pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));
        pos.setXYZ(i + 2, x1, y1, z1);
      }
    }
  }

  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function createStrawberryGeometry() {
  const geo = new THREE.SphereGeometry(0.46, 40, 32);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const ny = THREE.MathUtils.clamp((y + 0.46) / 0.92, 0, 1);
    const bellyProfile =
      0.86 +
      0.34 * Math.sin(Math.pow(ny, 0.62) * Math.PI) -
      0.24 * Math.pow(ny, 1.8);
    y = y * 1.18;
    x = x * bellyProfile * 1.06;
    z = z * bellyProfile * 0.72;
    if (ny < 0.16) {
      const bottomPinch = 1.0 - (0.16 - ny) * 0.85;
      x *= bottomPinch;
      z *= bottomPinch;
    }
    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function createCalyxLeafGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(0.095, 0.08, 0.048, 0.25);
  shape.quadraticCurveTo(0, 0.31, -0.048, 0.25);
  shape.quadraticCurveTo(-0.095, 0.08, 0, 0);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.016,
    bevelEnabled: true,
    bevelThickness: 0.01,
    bevelSize: 0.01,
    bevelSegments: 3,
    curveSegments: 14,
  });
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    pos.setXYZ(i, x, y * 0.86, z + y * y * 1.5 - 0.008);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function createHeartNoseGeometry() {
  const geo = new THREE.SphereGeometry(1, 44, 32);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const sx = pos.getX(i);
    const sy = pos.getY(i);
    const sz = pos.getZ(i);
    const rho = Math.hypot(sx, sy);
    let x = 0;
    let y = 0;
    if (rho > 1e-6) {
      const dx = sx / rho;
      const dy = sy / rho;
      const boundaryR = solveBoundaryRadius(heartNoseSDF, dx, dy, 1.35);
      x = dx * rho * boundaryR * 1.1;
      y = dy * rho * boundaryR * 0.94;
    }
    const z = sz * 0.42 * (1.0 - 0.14 * rho * rho);
    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function createTaperedWhiskerGeometry(curve, tubularSegments = 38, radialSegments = 14, maxRadius = 0.0092) {
  const frames = curve.computeFrenetFrames(tubularSegments, false);
  const points = curve.getPoints(tubularSegments);
  const capRings = 4;
  const totalRings = tubularSegments + 1 + capRings;
  const ringVerts = radialSegments + 1;

  const positions = new Float32Array(totalRings * ringVerts * 3);
  const normals = new Float32Array(totalRings * ringVerts * 3);
  const uvs = new Float32Array(totalRings * ringVerts * 2);
  const indices = [];

  const P = new THREE.Vector3();
  const N = new THREE.Vector3();
  const B = new THREE.Vector3();
  const T = new THREE.Vector3();
  const vNorm = new THREE.Vector3();

  let vOffset = 0;
  let uvOffset = 0;

  for (let i = 0; i <= tubularSegments; i++) {
    const u = i / tubularSegments;
    P.copy(points[i]);
    N.copy(frames.normals[i]);
    B.copy(frames.binormals[i]);
    const rootGrow = 0.36 + 0.64 * THREE.MathUtils.smoothstep(u, 0.0, 0.65);
    const tipSleek = 1.0 - 0.18 * THREE.MathUtils.smoothstep(u, 0.85, 1.0);
    const radius = maxRadius * rootGrow * tipSleek;

    for (let j = 0; j <= radialSegments; j++) {
      const v = j / radialSegments;
      const theta = v * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      vNorm.set(cosT * N.x + sinT * B.x, cosT * N.y + sinT * B.y, cosT * N.z + sinT * B.z).normalize();
      positions[vOffset] = P.x + radius * vNorm.x;
      positions[vOffset + 1] = P.y + radius * vNorm.y;
      positions[vOffset + 2] = P.z + radius * vNorm.z;
      normals[vOffset] = vNorm.x;
      normals[vOffset + 1] = vNorm.y;
      normals[vOffset + 2] = vNorm.z;
      vOffset += 3;

      uvs[uvOffset] = u;
      uvs[uvOffset + 1] = v;
      uvOffset += 2;
    }
  }

  P.copy(points[tubularSegments]);
  N.copy(frames.normals[tubularSegments]);
  B.copy(frames.binormals[tubularSegments]);
  T.copy(frames.tangents[tubularSegments]).normalize();
  const endRadius = maxRadius * 0.82;

  for (let c = 1; c <= capRings; c++) {
    const phi = (c / capRings) * (Math.PI * 0.5);
    const ringR = endRadius * Math.cos(phi);
    const forwardPush = endRadius * 1.1 * Math.sin(phi);

    for (let j = 0; j <= radialSegments; j++) {
      const v = j / radialSegments;
      const theta = v * Math.PI * 2;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      vNorm
        .set(
          Math.cos(phi) * (cosT * N.x + sinT * B.x) + Math.sin(phi) * T.x,
          Math.cos(phi) * (cosT * N.y + sinT * B.y) + Math.sin(phi) * T.y,
          Math.cos(phi) * (cosT * N.z + sinT * B.z) + Math.sin(phi) * T.z,
        )
        .normalize();

      positions[vOffset] = P.x + T.x * forwardPush + ringR * (cosT * N.x + sinT * B.x);
      positions[vOffset + 1] = P.y + T.y * forwardPush + ringR * (cosT * N.y + sinT * B.y);
      positions[vOffset + 2] = P.z + T.z * forwardPush + ringR * (cosT * N.z + sinT * B.z);
      normals[vOffset] = vNorm.x;
      normals[vOffset + 1] = vNorm.y;
      normals[vOffset + 2] = vNorm.z;
      vOffset += 3;

      uvs[uvOffset] = 1.0;
      uvs[uvOffset + 1] = v;
      uvOffset += 2;
    }
  }

  for (let i = 0; i < totalRings - 1; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * ringVerts + j;
      const b = (i + 1) * ringVerts + j;
      const c = (i + 1) * ringVerts + (j + 1);
      const d = i * ringVerts + (j + 1);
      indices.push(a, b, d, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}

function createSeededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function createEarSparklesGeometry(seed, sideSign = 1) {
  const rand = createSeededRandom(seed);
  const count = 32;
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const speeds = new Float32Array(count);
  const kinds = new Float32Array(count);

  const heroStars = [
    [-0.18, -0.22, 0.22, 0.19],
    [0.14, -0.26, 0.22, 0.21],
    [-0.02, -0.32, 0.23, 0.18],
    [-0.30, -0.28, 0.20, 0.17],
    [0.29, -0.24, 0.20, 0.17],
    [-0.12, -0.14, 0.24, 0.16],
    [0.09, -0.16, 0.24, 0.15],
    [-0.42, -0.33, 0.17, 0.16],
    [0.42, -0.32, 0.17, 0.16],
    [-0.24, -0.38, 0.20, 0.15],
    [0.22, -0.37, 0.20, 0.15],
    [0.01, -0.40, 0.21, 0.14],
    [-0.36, -0.12, 0.18, 0.13],
    [0.34, -0.10, 0.18, 0.13],
  ];

  for (let i = 0; i < count; i++) {
    if (i < heroStars.length) {
      const [hx, hy, hz, hSize] = heroStars[i];
      positions[i * 3] = (hx + (rand() - 0.5) * 0.04) * sideSign;
      positions[i * 3 + 1] = hy + (rand() - 0.5) * 0.035;
      positions[i * 3 + 2] = hz;
      sizes[i] = hSize;
      kinds[i] = 0.0;
    } else {
      const angle = rand() * Math.PI * 2;
      const radX = 0.08 + Math.pow(rand(), 0.7) * 0.48;
      const px = Math.cos(angle) * radX * sideSign;
      const py = -0.30 + (rand() - 0.35) * 0.36;
      positions[i * 3] = THREE.MathUtils.clamp(px, -0.58, 0.58);
      positions[i * 3 + 1] = THREE.MathUtils.clamp(py, -0.44, 0.06);
      positions[i * 3 + 2] = 0.14 + rand() * 0.12;
      const isStar = i % 2 === 0;
      sizes[i] = isStar ? 0.095 + rand() * 0.065 : 0.045 + rand() * 0.045;
      kinds[i] = isStar ? 0.0 : 1.0;
    }
    phases[i] = rand() * Math.PI * 2;
    speeds[i] = 2.2 + rand() * 3.0;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  geo.setAttribute('aKind', new THREE.BufferAttribute(kinds, 1));
  return geo;
}

function createCustomSparklesGeometry(items) {
  const count = items.length;
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);
  const speeds = new Float32Array(count);
  const kinds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const [x, y, z, size, phase, speed, kind] = items[i];
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    sizes[i] = size;
    phases[i] = phase;
    speeds[i] = speed;
    kinds[i] = kind;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  geo.setAttribute('aKind', new THREE.BufferAttribute(kinds, 1));
  return geo;
}

// ============================================================================
// Main Standalone Class: CrystalCatFilter3D
// ============================================================================

export class CrystalCatFilter3D {
  constructor(canvas, options = {}) {
    if (!canvas) {
      throw new Error('CrystalCatFilter3D requires a valid HTMLCanvasElement.');
    }

    this.canvas = canvas;
    this.config = {
      earHeight: options.earHeight ?? DEFAULT_CONFIG.earHeight,
      earScale: options.earScale ?? DEFAULT_CONFIG.earScale,
      earOpacity: options.earOpacity ?? DEFAULT_CONFIG.earOpacity,
      glowIntensity: options.glowIntensity ?? DEFAULT_CONFIG.glowIntensity,
    };

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 16 / 9, 1, 6000);

    this.rootGroup = new THREE.Group();
    this.earCluster = new THREE.Group();
    this.noseCluster = new THREE.Group();
    this.rootGroup.add(this.earCluster);
    this.rootGroup.add(this.noseCluster);
    this.rootGroup.visible = false;
    this.scene.add(this.rootGroup);

    this.ears = [];
    this.disposableGeometries = [];
    this.disposableMaterials = [];

    this.elapsedTime = 0;
    this.lastTimestamp = 0;
    this.lastWidth = 0;
    this.lastHeight = 0;
    this.hasPrevPose = false;
    this.prevHeadQuat = new THREE.Quaternion();
    this.prevHeadPos = new THREE.Vector3();

    this.spring = {
      angleZ: 0,
      velZ: 0,
      angleX: 0,
      velX: 0,
      berryOffsetX: 0,
      berryVelX: 0,
      berryOffsetY: 0,
      berryVelY: 0,
    };

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
    this._deltaQuat = new THREE.Quaternion();
    this._deltaEuler = new THREE.Euler();
    this._headPos = new THREE.Vector3();
    this._velPos = new THREE.Vector3();
    this._tmpVec = new THREE.Vector3();
    this._earAnchor = new THREE.Vector3();

    this._buildSceneGraph();
  }

  _trackGeo(geo) {
    this.disposableGeometries.push(geo);
    return geo;
  }

  _trackMat(mat) {
    this.disposableMaterials.push(mat);
    return mat;
  }

  _buildSceneGraph() {
    this.starTexture = createStarSparkleTexture();

    const berryGeo = this._trackGeo(createStrawberryGeometry());
    const calyxLeafGeo = this._trackGeo(createCalyxLeafGeometry());
    const stemGeo = this._trackGeo(new THREE.CylinderGeometry(0.022, 0.032, 0.13, 10));
    const noseGeo = this._trackGeo(createHeartNoseGeometry());

    const sides = [-1, 1];
    for (let idx = 0; idx < sides.length; idx++) {
      const sideSign = sides[idx];
      const earGeo = this._trackGeo(createPuffyEarGeometry(sideSign));
      const pivot = new THREE.Group();
      const innerSpringGroup = new THREE.Group();
      const earBody = new THREE.Group();
      earBody.position.set(0, 0.44, 0);

      const backMat = this._trackMat(
        new THREE.ShaderMaterial({
          uniforms: {
            uTime: { value: 0 },
            uEarOpacity: { value: this.config.earOpacity },
            uGlowIntensity: { value: this.config.glowIntensity },
            uIsBack: { value: 1.0 },
            uSideSign: { value: sideSign },
          },
          vertexShader: EAR_VERTEX_SHADER,
          fragmentShader: EAR_FRAGMENT_SHADER,
          transparent: true,
          depthWrite: false,
          side: THREE.BackSide,
        }),
      );

      const frontMat = this._trackMat(
        new THREE.ShaderMaterial({
          uniforms: {
            uTime: { value: 0 },
            uEarOpacity: { value: this.config.earOpacity },
            uGlowIntensity: { value: this.config.glowIntensity },
            uIsBack: { value: 0.0 },
            uSideSign: { value: sideSign },
          },
          vertexShader: EAR_VERTEX_SHADER,
          fragmentShader: EAR_FRAGMENT_SHADER,
          transparent: true,
          depthWrite: false,
          side: THREE.FrontSide,
        }),
      );

      const backMesh = new THREE.Mesh(earGeo, backMat);
      backMesh.renderOrder = 10;

      const frontMesh = new THREE.Mesh(earGeo, frontMat);
      frontMesh.renderOrder = 16;

      const berryPivot = new THREE.Group();
      berryPivot.position.set(sideSign * -0.02, -0.10, 0.02);
      berryPivot.rotation.z = sideSign * -0.16;

      const berryMat = this._trackMat(
        new THREE.ShaderMaterial({
          uniforms: {
            uGlowIntensity: { value: this.config.glowIntensity },
            uTime: { value: 0 },
          },
          vertexShader: STRAWBERRY_VERTEX_SHADER,
          fragmentShader: STRAWBERRY_FRAGMENT_SHADER,
          transparent: true,
          depthWrite: false,
          side: THREE.FrontSide,
        }),
      );
      const berryMesh = new THREE.Mesh(berryGeo, berryMat);
      berryMesh.scale.set(0.62, 0.64, 0.62);
      berryMesh.renderOrder = 12;
      berryPivot.add(berryMesh);

      const calyxMat = this._trackMat(
        new THREE.ShaderMaterial({
          uniforms: {
            uGlowIntensity: { value: this.config.glowIntensity },
          },
          vertexShader: STRAWBERRY_VERTEX_SHADER,
          fragmentShader: CALYX_FRAGMENT_SHADER,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );

      const calyxGroup = new THREE.Group();
      calyxGroup.position.set(0, -0.34, 0.01);
      for (let l = 0; l < 4; l++) {
        const angle = (l / 4) * Math.PI * 2 + 0.38;
        const leaf = new THREE.Mesh(calyxLeafGeo, calyxMat);
        leaf.rotation.y = angle;
        leaf.rotation.x = 1.08;
        leaf.scale.setScalar(0.84);
        leaf.renderOrder = 13;
        calyxGroup.add(leaf);
      }
      const stem = new THREE.Mesh(stemGeo, calyxMat);
      stem.position.set(0, -0.05, 0);
      stem.renderOrder = 13;
      calyxGroup.add(stem);
      berryPivot.add(calyxGroup);

      const earSparklesGeo = this._trackGeo(
        createEarSparklesGeometry(idx === 0 ? 4129 : 8837, sideSign),
      );
      const sparklesMat = this._trackMat(
        new THREE.ShaderMaterial({
          uniforms: {
            uMap: { value: this.starTexture },
            uTime: { value: 0 },
            uGlowIntensity: { value: this.config.glowIntensity },
            uPixelRatio: { value: 1 },
            uScaleFactor: { value: 1 },
          },
          vertexShader: SPARKLE_VERTEX_SHADER,
          fragmentShader: SPARKLE_FRAGMENT_SHADER,
          transparent: true,
          depthWrite: false,
        }),
      );
      const earSparkles = new THREE.Points(earSparklesGeo, sparklesMat);
      earSparkles.renderOrder = 14;
      earSparkles.frustumCulled = false;

      earBody.add(backMesh);
      earBody.add(berryPivot);
      earBody.add(earSparkles);
      earBody.add(frontMesh);

      innerSpringGroup.add(earBody);
      pivot.add(innerSpringGroup);
      this.earCluster.add(pivot);

      this.ears.push({
        pivot,
        innerSpringGroup,
        berryPivot,
        frontMat,
        backMat,
        berryMat,
        calyxMat,
        sparklesMat,
        sideSign,
        baseRoll: -sideSign * 0.44,
      });
    }

    // Cluster 2: Compact Heart Nose & 4 Slender Translucent Glass Whiskers
    this.noseMat = this._trackMat(
      new THREE.ShaderMaterial({
        uniforms: {
          uGlowIntensity: { value: this.config.glowIntensity },
          uTime: { value: 0 },
        },
        vertexShader: STRAWBERRY_VERTEX_SHADER,
        fragmentShader: NOSE_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide,
      }),
    );
    this.noseMesh = new THREE.Mesh(noseGeo, this.noseMat);
    this.noseMesh.renderOrder = 20;
    this.noseCluster.add(this.noseMesh);

    this.whiskersGroup = new THREE.Group();
    this.whiskerMat = this._trackMat(
      new THREE.ShaderMaterial({
        uniforms: {
          uGlowIntensity: { value: this.config.glowIntensity },
        },
        vertexShader: WHISKER_VERTEX_SHADER,
        fragmentShader: WHISKER_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        side: THREE.FrontSide,
      }),
    );

    const whiskerStarsList = [];
    for (const side of sides) {
      const upperCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.21, -0.014, -0.048),
        new THREE.Vector3(side * 0.33, 0.012, -0.070),
        new THREE.Vector3(side * 0.45, 0.014, -0.112),
        new THREE.Vector3(side * 0.56, -0.004, -0.172),
      ]);
      const upperMesh = new THREE.Mesh(
        this._trackGeo(createTaperedWhiskerGeometry(upperCurve, 38, 14, 0.0092)),
        this.whiskerMat,
      );
      upperMesh.renderOrder = 19;
      this.whiskersGroup.add(upperMesh);

      const lowerCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 0.20, -0.048, -0.052),
        new THREE.Vector3(side * 0.32, -0.068, -0.080),
        new THREE.Vector3(side * 0.44, -0.105, -0.125),
        new THREE.Vector3(side * 0.54, -0.150, -0.184),
      ]);
      const lowerMesh = new THREE.Mesh(
        this._trackGeo(createTaperedWhiskerGeometry(lowerCurve, 38, 14, 0.0088)),
        this.whiskerMat,
      );
      lowerMesh.renderOrder = 19;
      this.whiskersGroup.add(lowerMesh);

      const pStar1 = upperCurve.getPoint(0.36);
      const pStar2 = lowerCurve.getPoint(0.32);
      const pStar3 = upperCurve.getPoint(0.84);
      whiskerStarsList.push(
        [pStar1.x, pStar1.y + 0.003, pStar1.z + 0.018, 0.064, side < 0 ? 0.5 : 1.9, 2.7, 0.0],
        [pStar2.x, pStar2.y + 0.002, pStar2.z + 0.018, 0.056, side < 0 ? 2.1 : 3.6, 3.1, 0.0],
        [pStar3.x, pStar3.y + 0.002, pStar3.z + 0.018, 0.040, side < 0 ? 3.8 : 0.9, 3.5, 0.0],
      );
    }

    const whiskerStarsGeo = this._trackGeo(createCustomSparklesGeometry(whiskerStarsList));
    this.whiskerSparklesMat = this._trackMat(
      new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: this.starTexture },
          uTime: { value: 0 },
          uGlowIntensity: { value: this.config.glowIntensity },
          uPixelRatio: { value: 1 },
          uScaleFactor: { value: 1 },
        },
        vertexShader: SPARKLE_VERTEX_SHADER,
        fragmentShader: SPARKLE_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
      }),
    );
    const whiskerStars = new THREE.Points(whiskerStarsGeo, this.whiskerSparklesMat);
    whiskerStars.renderOrder = 21;
    whiskerStars.frustumCulled = false;
    this.whiskersGroup.add(whiskerStars);
    this.noseCluster.add(this.whiskersGroup);
  }

  _mapLandmark(lm, width, height, camZ, refZ, mirror, out) {
    const nx = mirror ? 1.0 - lm.x : lm.x;
    const px = (nx - 0.5) * width;
    const py = (0.5 - lm.y) * height;
    const pz = -(lm.z - refZ) * width;
    const perspScale = (camZ - pz) / camZ;
    out.set(px * perspScale, py * perspScale, pz);
    return out;
  }

  update(landmarks, width, height, mirror = true) {
    if (!this.renderer) return;

    if (width > 0 && height > 0 && (width !== this.lastWidth || height !== this.lastHeight)) {
      this.lastWidth = width;
      this.lastHeight = height;
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }

    if (!landmarks || landmarks.length < 455) {
      this.hasPrevPose = false;
      this.clear();
      return;
    }

    const now = performance.now() * 0.001;
    const dt = this.lastTimestamp > 0 ? Math.min(Math.max(now - this.lastTimestamp, 0.001), 0.05) : 0.016;
    this.lastTimestamp = now;
    this.elapsedTime += dt;

    const fovRad = THREE.MathUtils.degToRad(this.camera.fov);
    const camZ = height / 2 / Math.tan(fovRad / 2);
    this.camera.position.set(0, 0, camZ);
    this.camera.lookAt(0, 0, 0);

    const refZ = (landmarks[234].z + landmarks[454].z) * 0.5;
    this._mapLandmark(landmarks[10], width, height, camZ, refZ, mirror, this._p10);
    this._mapLandmark(landmarks[152], width, height, camZ, refZ, mirror, this._p152);
    this._mapLandmark(landmarks[234], width, height, camZ, refZ, mirror, this._p234);
    this._mapLandmark(landmarks[454], width, height, camZ, refZ, mirror, this._p454);
    this._mapLandmark(landmarks[1], width, height, camZ, refZ, mirror, this._p1);

    const faceHeight = this._p10.distanceTo(this._p152);
    const faceWidth = this._p234.distanceTo(this._p454);
    if (faceHeight < 1e-4 || faceWidth < 1e-4) {
      this.clear();
      return;
    }
    const headScale = faceWidth * 0.55 + faceHeight * 0.45;

    this._upVec.subVectors(this._p10, this._p152).normalize();
    if (mirror) {
      this._rightVec.subVectors(this._p234, this._p454).normalize();
    } else {
      this._rightVec.subVectors(this._p454, this._p234).normalize();
    }
    this._forwardVec.crossVectors(this._rightVec, this._upVec).normalize();
    this._rightVec.crossVectors(this._upVec, this._forwardVec).normalize();

    this._basisMat.makeBasis(this._rightVec, this._upVec, this._forwardVec);
    this._headQuat.setFromRotationMatrix(this._basisMat);
    this._headPos.copy(this._p10);

    if (this.hasPrevPose) {
      this._deltaQuat.copy(this.prevHeadQuat).invert().multiply(this._headQuat);
      this._deltaEuler.setFromQuaternion(this._deltaQuat, 'YXZ');
      this._velPos.subVectors(this._headPos, this.prevHeadPos).divideScalar(headScale);

      const localRightMove = this._velPos.dot(this._rightVec);
      const localUpMove = this._velPos.dot(this._upVec);
      const rollImpulse = THREE.MathUtils.clamp(this._deltaEuler.z * 2.2 - localRightMove * 3.8, -0.8, 0.8);
      const pitchImpulse = THREE.MathUtils.clamp(this._deltaEuler.x * 2.0 + localUpMove * 3.5, -0.8, 0.8);

      this.spring.velZ += rollImpulse * 14.0;
      this.spring.velX += pitchImpulse * 12.0;
      this.spring.berryVelX -= rollImpulse * 2.4;
      this.spring.berryVelY -= pitchImpulse * 2.2;
    }
    this.prevHeadQuat.copy(this._headQuat);
    this.prevHeadPos.copy(this._headPos);
    this.hasPrevPose = true;

    const earStiffness = 115.0;
    const earDamping = 9.5;
    this.spring.velZ += (-earStiffness * this.spring.angleZ - earDamping * this.spring.velZ) * dt;
    this.spring.angleZ = THREE.MathUtils.clamp(this.spring.angleZ + this.spring.velZ * dt, -0.32, 0.32);

    this.spring.velX += (-earStiffness * this.spring.angleX - earDamping * this.spring.velX) * dt;
    this.spring.angleX = THREE.MathUtils.clamp(this.spring.angleX + this.spring.velX * dt, -0.26, 0.26);

    const berryStiffness = 68.0;
    const berryDamping = 6.2;
    this.spring.berryVelX += (-berryStiffness * this.spring.berryOffsetX - berryDamping * this.spring.berryVelX) * dt;
    this.spring.berryOffsetX = THREE.MathUtils.clamp(this.spring.berryOffsetX + this.spring.berryVelX * dt, -0.11, 0.11);

    this.spring.berryVelY += (-berryStiffness * this.spring.berryOffsetY - berryDamping * this.spring.berryVelY) * dt;
    this.spring.berryOffsetY = THREE.MathUtils.clamp(this.spring.berryOffsetY + this.spring.berryVelY * dt, -0.09, 0.09);

    // Cluster 1: Crystal Ears anchored to forehead (landmark[10])
    this._earAnchor
      .copy(this._p10)
      .addScaledVector(this._upVec, this.config.earHeight * faceHeight)
      .addScaledVector(this._forwardVec, -0.12 * faceHeight);

    this.earCluster.position.copy(this._earAnchor);
    this.earCluster.quaternion.copy(this._headQuat);

    const earUnitScale = headScale * 0.275 * this.config.earScale;
    const halfEarSpacing = 0.31 * faceWidth;
    const idleFloatY = Math.sin(this.elapsedTime * 2.1) * 0.018;
    const pixelRatio = this.renderer.getPixelRatio();

    for (const ear of this.ears) {
      ear.pivot.position.set(ear.sideSign * halfEarSpacing, -0.07 * faceHeight, -0.02 * faceHeight);
      ear.pivot.scale.setScalar(earUnitScale);
      ear.pivot.rotation.set(
        0.06 + this.spring.angleX,
        ear.sideSign * -0.12,
        ear.baseRoll + this.spring.angleZ,
      );

      const squash = 1.0 + Math.abs(this.spring.angleZ) * 0.08;
      ear.innerSpringGroup.scale.set(1.0 / Math.sqrt(squash), squash, 1.0);

      ear.berryPivot.position.set(
        ear.sideSign * -0.02 + this.spring.berryOffsetX,
        -0.10 + idleFloatY + this.spring.berryOffsetY,
        0.02,
      );
      ear.berryPivot.rotation.z = ear.sideSign * -0.16 - this.spring.berryOffsetX * 1.4;

      ear.frontMat.uniforms.uTime.value = this.elapsedTime;
      ear.backMat.uniforms.uTime.value = this.elapsedTime;
      ear.berryMat.uniforms.uTime.value = this.elapsedTime;
      ear.sparklesMat.uniforms.uTime.value = this.elapsedTime;
      ear.sparklesMat.uniforms.uPixelRatio.value = pixelRatio;
      ear.sparklesMat.uniforms.uScaleFactor.value = earUnitScale * camZ;
    }

    // Cluster 2: Compact Translucent Heart Nose & 4 Slender Glass Whiskers anchored to nose tip (landmark[1])
    this._tmpVec.copy(this._p1).addScaledVector(this._forwardVec, 0.018 * headScale);
    this.noseCluster.position.copy(this._tmpVec);
    this.noseCluster.quaternion.copy(this._headQuat);

    this.noseMesh.scale.setScalar(headScale * 0.062);
    this.noseMat.uniforms.uTime.value = this.elapsedTime;

    this.whiskersGroup.scale.setScalar(faceWidth);
    this.whiskerSparklesMat.uniforms.uTime.value = this.elapsedTime;
    this.whiskerSparklesMat.uniforms.uPixelRatio.value = pixelRatio;
    this.whiskerSparklesMat.uniforms.uScaleFactor.value = faceWidth * camZ;

    this.rootGroup.visible = true;
    this.renderer.render(this.scene, this.camera);
  }

  clear() {
    this.rootGroup.visible = false;
    if (this.renderer) {
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear(true, true, true);
    }
  }

  dispose() {
    this.clear();
    for (const geo of this.disposableGeometries) geo.dispose();
    for (const mat of this.disposableMaterials) mat.dispose();
    if (this.starTexture) this.starTexture.dispose();
    this.disposableGeometries = [];
    this.disposableMaterials = [];
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
    this.scene = null;
    this.camera = null;
    this.canvas = null;
  }
}

if (typeof window !== 'undefined') {
  window.CrystalCatFilter3D = CrystalCatFilter3D;
}

export default CrystalCatFilter3D;
