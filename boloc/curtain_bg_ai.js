/**
 * CurtainBgAI - Universal Real-Time AI Background Engine (Zero Embedded Assets)
 * Engine: MediaPipe Selfie Multiclass (ViT) + 13-Tap Joint Bilateral WebGL Shader + Adaptive Edge Blending + Clean Plate
 *
 * Works seamlessly across ALL backdrop types: dark curtains, bright white, pastel, and scenic photos.
 * Self-contained WebGL canvas (alpha: true, preserveDrawingBuffer: true) — zero conflict with host 2D Canvas.
 *
 * Quick Usage:
 *   import CurtainBgAI from './curtain_bg_ai.js';
 *   const bgAI = new CurtainBgAI(); // bgUrl is optional (renders transparent cutout or original if unset)
 *   await bgAI.init();
 *
 *   // Instant background swap (URL string, preloaded <img>, <canvas>, ImageBitmap, or null to clear):
 *   await bgAI.setBackground('./nen/rem_den.jpg');
 *   await bgAI.setBackground('./nen/studio_pastel.jpg');
 *
 *   // Render loop (2D Canvas Photobooth):
 *   const frameCanvas = bgAI.processFrame(videoEl, true);
 *   mainCtx.drawImage(frameCanvas, 0, 0, mainCanvas.width, mainCanvas.height);
 */
import { FilesetResolver, ImageSegmenter } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

export const DEFAULT_OPTIONS = {
  bgUrl: null,               // Optional: load any backdrop anytime via setBackground(source)
  noBgMode: 'transparent',   // 'transparent' (cutout with alpha) or 'original' (passthrough video) when no background is set
  threshold: 0.55,
  edgeShrink: 0.35,
  edgeFeather: 0.12,
  edgeSnap: 0.75,
  temporalSmooth: 0.3,
  bgBlur: 1.5,
  cleanPlateSensitivity: 0.18,
  delegate: 'GPU',
  wasmPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
  modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite'
};

const VERTEX_SHADER_SRC = `
  attribute vec2 a_pos;
  varying vec2 v_uv;
  void main() {
    v_uv = a_pos * 0.5 + 0.5;
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

const TEMPORAL_FRAGMENT_SHADER_SRC = `
  precision mediump float;
  varying vec2 v_uv;
  uniform sampler2D u_currMask;
  uniform sampler2D u_prevMask;
  uniform float u_temporalSmooth;
  uniform float u_hasPrev;

  void main() {
    vec2 curr = texture2D(u_currMask, v_uv).rg;
    vec2 prev = texture2D(u_prevMask, v_uv).rg;

    float diff = abs(curr.r - prev.r);
    float openingGap = step(curr.r, prev.r - 0.06);
    float motionAdapt = 1.0 - smoothstep(0.10, 0.40, diff) * 0.72;
    float gapRelease = mix(1.0, 0.45, openingGap);
    float blendFactor = clamp(u_temporalSmooth * motionAdapt * gapRelease * u_hasPrev, 0.0, 0.85);

    vec2 smoothed = mix(curr, prev, blendFactor);
    gl_FragColor = vec4(smoothed.r, smoothed.g, 0.0, 1.0);
  }
`;

const COMPOSITE_FRAGMENT_SHADER_SRC = `
  precision mediump float;
  varying vec2 v_uv;

  uniform sampler2D u_video;
  uniform sampler2D u_mask;
  uniform sampler2D u_bg;
  uniform sampler2D u_cleanPlateTex;

  uniform vec2 u_resolution;
  uniform vec2 u_maskTexelSize;
  uniform vec2 u_bgSize;

  uniform float u_mirror;
  uniform float u_hasBg;
  uniform float u_noBgMode;
  uniform float u_hasCleanPlate;

  uniform float u_threshold;
  uniform float u_edgeShrink;
  uniform float u_edgeFeather;
  uniform float u_edgeSnap;
  uniform float u_bgBlur;
  uniform float u_cleanPlateSensitivity;

  vec2 computeCoverUV(vec2 uv, vec2 canvasSize, vec2 imageSize) {
    float canvasAspect = canvasSize.x / max(canvasSize.y, 1.0);
    float imageAspect = imageSize.x / max(imageSize.y, 1.0);
    vec2 outUV = uv;
    if (canvasAspect > imageAspect) {
      float scale = imageAspect / canvasAspect;
      outUV.y = (uv.y - 0.5) * scale + 0.5;
    } else {
      float scale = canvasAspect / imageAspect;
      outUV.x = (uv.x - 0.5) * scale + 0.5;
    }
    return clamp(outUV, vec2(0.001), vec2(0.999));
  }

  vec3 sampleBlurredBackground(vec2 baseUV) {
    if (u_bgBlur <= 0.05) {
      return texture2D(u_bg, baseUV).rgb;
    }

    float canvasAspect = u_resolution.x / max(u_resolution.y, 1.0);
    float imageAspect = u_bgSize.x / max(u_bgSize.y, 1.0);
    vec2 uvScale = vec2(1.0);
    if (canvasAspect > imageAspect) {
      uvScale.y = imageAspect / canvasAspect;
    } else {
      uvScale.x = canvasAspect / imageAspect;
    }

    vec2 radius = (u_bgBlur / max(u_resolution, vec2(1.0))) * uvScale * 1.45;

    vec3 acc = texture2D(u_bg, baseUV).rgb * 0.16;
    float wInner = 0.095;
    float wOuter = 0.045;

    acc += texture2D(u_bg, clamp(baseUV + vec2( 0.50,  0.00) * radius, 0.001, 0.999)).rgb * wInner;
    acc += texture2D(u_bg, clamp(baseUV + vec2(-0.50,  0.00) * radius, 0.001, 0.999)).rgb * wInner;
    acc += texture2D(u_bg, clamp(baseUV + vec2( 0.25,  0.433) * radius, 0.001, 0.999)).rgb * wInner;
    acc += texture2D(u_bg, clamp(baseUV + vec2(-0.25,  0.433) * radius, 0.001, 0.999)).rgb * wInner;
    acc += texture2D(u_bg, clamp(baseUV + vec2( 0.25, -0.433) * radius, 0.001, 0.999)).rgb * wInner;
    acc += texture2D(u_bg, clamp(baseUV + vec2(-0.25, -0.433) * radius, 0.001, 0.999)).rgb * wInner;

    acc += texture2D(u_bg, clamp(baseUV + vec2( 0.00,  1.00) * radius, 0.001, 0.999)).rgb * wOuter;
    acc += texture2D(u_bg, clamp(baseUV + vec2( 0.00, -1.00) * radius, 0.001, 0.999)).rgb * wOuter;
    acc += texture2D(u_bg, clamp(baseUV + vec2( 0.866,  0.50) * radius, 0.001, 0.999)).rgb * wOuter;
    acc += texture2D(u_bg, clamp(baseUV + vec2(-0.866,  0.50) * radius, 0.001, 0.999)).rgb * wOuter;
    acc += texture2D(u_bg, clamp(baseUV + vec2( 0.866, -0.50) * radius, 0.001, 0.999)).rgb * wOuter;
    acc += texture2D(u_bg, clamp(baseUV + vec2(-0.866, -0.50) * radius, 0.001, 0.999)).rgb * wOuter;

    return acc;
  }

  void accumulateBilateralTap(
    vec2 centerUV,
    vec2 offsetUV,
    vec3 centerRGB,
    float spatialWeight,
    float invSigmaColor,
    inout vec2 weightedMaskSum,
    inout float weightSum,
    inout float minPerson
  ) {
    vec2 sUV = clamp(centerUV + offsetUV, vec2(0.001), vec2(0.999));
    vec3 sRGB = texture2D(u_video, sUV).rgb;
    vec2 sMask = texture2D(u_mask, sUV).rg;

    vec3 d = centerRGB - sRGB;
    float colorDistSq = dot(d, d);
    float w = spatialWeight * exp(max(-colorDistSq * invSigmaColor, -40.0));

    weightedMaskSum += sMask * w;
    weightSum += w;
    minPerson = min(minPerson, sMask.r);
  }

  void main() {
    vec2 camUV = vec2(u_mirror > 0.5 ? (1.0 - v_uv.x) : v_uv.x, v_uv.y);
    vec3 fgColor = texture2D(u_video, camUV).rgb;

    if (u_hasBg < 0.5 && u_noBgMode > 0.5) {
      gl_FragColor = vec4(fgColor, 1.0);
      return;
    }

    vec2 centerMask = texture2D(u_mask, camUV).rg;

    float snap = clamp(u_edgeSnap, 0.0, 1.0);
    float sigmaColor = mix(0.14, 0.0085, snap);
    float invSigmaColor = 1.0 / max(sigmaColor, 0.002);

    vec2 r1 = u_maskTexelSize * (0.85 + 0.55 * u_edgeShrink);
    vec2 r2 = u_maskTexelSize * (1.95 + 1.15 * snap);

    vec2 sumMask = centerMask * 1.0;
    float sumW = 1.0;
    float mMin = centerMask.r;

    accumulateBilateralTap(camUV, vec2( 1.000,  0.000) * r1, fgColor, 0.78, invSigmaColor, sumMask, sumW, mMin);
    accumulateBilateralTap(camUV, vec2(-1.000,  0.000) * r1, fgColor, 0.78, invSigmaColor, sumMask, sumW, mMin);
    accumulateBilateralTap(camUV, vec2( 0.500,  0.866) * r1, fgColor, 0.78, invSigmaColor, sumMask, sumW, mMin);
    accumulateBilateralTap(camUV, vec2(-0.500,  0.866) * r1, fgColor, 0.78, invSigmaColor, sumMask, sumW, mMin);
    accumulateBilateralTap(camUV, vec2( 0.500, -0.866) * r1, fgColor, 0.78, invSigmaColor, sumMask, sumW, mMin);
    accumulateBilateralTap(camUV, vec2(-0.500, -0.866) * r1, fgColor, 0.78, invSigmaColor, sumMask, sumW, mMin);

    float outerMinIgnore = 1.0;
    accumulateBilateralTap(camUV, vec2( 0.000,  1.000) * r2, fgColor, 0.42, invSigmaColor, sumMask, sumW, outerMinIgnore);
    accumulateBilateralTap(camUV, vec2( 0.000, -1.000) * r2, fgColor, 0.42, invSigmaColor, sumMask, sumW, outerMinIgnore);
    accumulateBilateralTap(camUV, vec2( 0.866,  0.500) * r2, fgColor, 0.42, invSigmaColor, sumMask, sumW, outerMinIgnore);
    accumulateBilateralTap(camUV, vec2(-0.866,  0.500) * r2, fgColor, 0.42, invSigmaColor, sumMask, sumW, outerMinIgnore);
    accumulateBilateralTap(camUV, vec2( 0.866, -0.500) * r2, fgColor, 0.42, invSigmaColor, sumMask, sumW, outerMinIgnore);
    accumulateBilateralTap(camUV, vec2(-0.866, -0.500) * r2, fgColor, 0.42, invSigmaColor, sumMask, sumW, outerMinIgnore);

    vec2 jbMask = sumMask / max(sumW, 0.0001);
    float personProb = mix(centerMask.r, jbMask.r, snap);
    float hairProb = mix(centerMask.g, jbMask.g, snap);

    float isHair = smoothstep(0.14, 0.52, hairProb);

    float skinChoke = clamp(u_edgeShrink * 1.12 + 0.06 * snap, 0.0, 1.0);
    float skinFeather = max(u_edgeFeather * 0.42, 0.015);
    float skinThreshold = clamp(u_threshold + 0.025 * snap, 0.20, 0.92);

    float hairChoke = u_edgeShrink * 0.40;
    float hairFeather = max(u_edgeFeather * 1.12, 0.03);
    float hairThreshold = u_threshold;

    float regionChoke = mix(skinChoke, hairChoke, isHair);
    float regionFeather = mix(skinFeather, hairFeather, isHair);
    float regionThreshold = mix(skinThreshold, hairThreshold, isHair);

    float chokedMask = mix(personProb, min(personProb, mMin), regionChoke * 0.70);

    float low = clamp(regionThreshold - regionFeather, 0.0, 0.98);
    float high = clamp(regionThreshold + regionFeather, low + 0.01, 1.0);
    float alpha = smoothstep(low, high, chokedMask);

    if (u_hasCleanPlate > 0.5) {
      vec3 plateRGB = texture2D(u_cleanPlateTex, camUV).rgb;
      float rgbDiff = length(fgColor - plateRGB);

      float uncertainZone = smoothstep(0.03, 0.07, personProb) * (1.0 - smoothstep(0.86, 0.95, personProb));
      float sens = max(u_cleanPlateSensitivity, 0.04);
      float matchesPlate = 1.0 - smoothstep(sens * 0.42, sens, rgbDiff);

      alpha *= (1.0 - matchesPlate * uncertainZone);
    }

    // No background loaded: output transparent alpha cutout
    if (u_hasBg < 0.5) {
      gl_FragColor = vec4(fgColor, alpha);
      return;
    }

    vec2 bgUV = computeCoverUV(v_uv, u_resolution, u_bgSize);
    vec3 bgColor = sampleBlurredBackground(bgUV);

    // Adaptive Edge Blending: harmonizes edge transition (alpha 0.05 -> 0.85) with actual local bgColor
    // Eliminates both white halos on dark backdrops AND dark halos on bright/pastel/scenic backdrops
    float edgeBand = smoothstep(0.05, 0.32, alpha) * (1.0 - smoothstep(0.48, 0.85, alpha));
    float colorMismatch = length(fgColor - bgColor);
    float mismatchFactor = smoothstep(0.08, 0.75, colorMismatch);
    float outerWeight = 1.0 - smoothstep(0.10, 0.78, alpha);

    float regionStrength = mix(0.42 + 0.26 * u_edgeShrink, 0.62 + 0.26 * u_edgeShrink, isHair);
    float adaptMix = clamp(
      edgeBand * regionStrength * (0.38 + 0.62 * mismatchFactor) * (0.55 + 0.45 * outerWeight),
      0.0,
      0.82
    );

    vec3 adaptedFg = mix(fgColor, bgColor, adaptMix);
    vec3 finalColor = mix(bgColor, adaptedFg, alpha);
    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

export class CurtainBgAI {
  constructor(options = {}) {
    this.options = Object.assign({}, DEFAULT_OPTIONS, options);
    this.canvas = document.createElement('canvas');
    this.canvas.width = 720;
    this.canvas.height = 1280;

    this.gl = null;
    this.segmenter = null;
    this.activeDelegate = null;
    this.isInitialized = false;
    this.hasCleanPlate = false;

    this._quadBuffer = null;
    this._temporalProgram = null;
    this._compositeProgram = null;
    this._videoTex = null;
    this._bgTex = null;
    this._cleanPlateTex = null;
    this._rawMaskTex = null;
    this._pingPongTex = [null, null];
    this._pingPongFbo = [null, null];
    this._pingIdx = 0;
    this._hasPrevMask = false;
    this._maskWidth = 0;
    this._maskHeight = 0;
    this._maskRgbaBuffer = null;

    this._bgWidth = 1080;
    this._bgHeight = 1920;
    this._hasBg = false;
    this._bgCache = new Map();
    this._bgLoadToken = 0;
    this._lastTimestamp = 0;
    this._disposed = false;
    this._tLoc = {};
    this._cLoc = {};
    this._tPosAttr = -1;
    this._cPosAttr = -1;

    this._onContextLost = (e) => {
      e.preventDefault();
      this._hasPrevMask = false;
      this.hasCleanPlate = false;
    };
    this._onContextRestored = () => {
      if (!this._disposed) {
        this._initWebGL();
        if (this.options.bgUrl) {
          this.setBackground(this.options.bgUrl).catch(() => {});
        }
      }
    };

    this.canvas.addEventListener('webglcontextlost', this._onContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this._onContextRestored, false);
  }

  async init() {
    if (this.isInitialized) return this;

    this._initWebGL();

    const bgPromise = this.options.bgUrl
      ? this.setBackground(this.options.bgUrl).catch((err) => {
          console.warn('[CurtainBgAI] Background load warning:', err);
        })
      : Promise.resolve();

    const vision = await FilesetResolver.forVisionTasks(this.options.wasmPath);

    const createSegmenter = (delegate) =>
      ImageSegmenter.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: this.options.modelAssetPath,
          delegate
        },
        runningMode: 'VIDEO',
        outputCategoryMask: false,
        outputConfidenceMasks: true
      });

    if (this.options.delegate === 'GPU') {
      try {
        this.segmenter = await createSegmenter('GPU');
        this.activeDelegate = 'GPU';
      } catch (err) {
        console.warn('[CurtainBgAI] GPU delegate failed, falling back to CPU:', err);
        this.segmenter = await createSegmenter('CPU');
        this.activeDelegate = 'CPU';
      }
    } else {
      this.segmenter = await createSegmenter('CPU');
      this.activeDelegate = 'CPU';
    }

    await bgPromise;
    this.isInitialized = true;
    return this;
  }

  setOptions(partial = {}) {
    Object.assign(this.options, partial);
  }

  captureCleanPlate(videoElement) {
    const gl = this.gl;
    if (
      !gl ||
      !this._cleanPlateTex ||
      !videoElement ||
      videoElement.readyState < 2 ||
      videoElement.videoWidth === 0 ||
      videoElement.videoHeight === 0
    ) {
      return false;
    }

    gl.bindTexture(gl.TEXTURE_2D, this._cleanPlateTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoElement);
    this.hasCleanPlate = true;
    return true;
  }

  clearCleanPlate() {
    this.hasCleanPlate = false;
  }

  clearBackground() {
    this._bgLoadToken++;
    this._hasBg = false;
    this.options.bgUrl = null;
  }

  /**
   * Instant background swap supporting URL strings (with CORS + built-in cache),
   * preloaded <img>, <canvas>, ImageBitmap, Blob/File, or null to clear.
   */
  async setBackground(source) {
    if (!source) {
      this.clearBackground();
      return;
    }

    if (!this.gl) {
      this._initWebGL();
    }
    const gl = this.gl;
    if (!gl || !this._bgTex) return;

    const token = ++this._bgLoadToken;
    let imgEl;

    if (typeof source === 'string') {
      const cached = this._bgCache.get(source);
      if (cached && cached.complete && cached.naturalWidth > 0) {
        imgEl = cached;
      } else {
        const loaded = await this._loadImage(source);
        if (!source.startsWith('blob:')) {
          this._bgCache.set(source, loaded);
        }
        imgEl = loaded;
      }
      if (token !== this._bgLoadToken || this._disposed) return;
      this.options.bgUrl = source;
    } else if (typeof Blob !== 'undefined' && source instanceof Blob) {
      const blobUrl = URL.createObjectURL(source);
      try {
        imgEl = await this._loadImage(blobUrl);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
      if (token !== this._bgLoadToken || this._disposed) return;
      this.options.bgUrl = null;
    } else if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
      if (!source.complete || source.naturalWidth === 0) {
        await new Promise((resolve, reject) => {
          const onLoad = () => {
            source.removeEventListener('load', onLoad);
            source.removeEventListener('error', onErr);
            resolve();
          };
          const onErr = (e) => {
            source.removeEventListener('load', onLoad);
            source.removeEventListener('error', onErr);
            reject(e);
          };
          source.addEventListener('load', onLoad);
          source.addEventListener('error', onErr);
        });
      }
      if (token !== this._bgLoadToken || this._disposed) return;
      imgEl = source;
      this.options.bgUrl = null;
    } else {
      imgEl = source;
      this.options.bgUrl = null;
    }

    const w = imgEl.naturalWidth || imgEl.width || 1080;
    const h = imgEl.naturalHeight || imgEl.height || 1920;
    this._bgWidth = Math.max(w, 1);
    this._bgHeight = Math.max(h, 1);

    gl.bindTexture(gl.TEXTURE_2D, this._bgTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imgEl);
    this._hasBg = true;
  }

  processFrame(videoElement, mirror = true) {
    const gl = this.gl;
    if (
      !gl ||
      !this._compositeProgram ||
      !this._temporalProgram ||
      !videoElement ||
      videoElement.readyState < 2 ||
      videoElement.videoWidth === 0 ||
      videoElement.videoHeight === 0
    ) {
      return this.canvas;
    }

    const vw = videoElement.videoWidth;
    const vh = videoElement.videoHeight;
    if (this.canvas.width !== vw || this.canvas.height !== vh) {
      this.canvas.width = vw;
      this.canvas.height = vh;
      this._hasPrevMask = false;
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._videoTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoElement);

    const passthroughRaw = !this._hasBg && this.options.noBgMode === 'original';
    let smoothedMaskTex = this._pingPongTex[this._pingIdx];

    if (!passthroughRaw && this.segmenter) {
      const now = performance.now();
      const ts = now > this._lastTimestamp ? now : this._lastTimestamp + 1;
      this._lastTimestamp = ts;

      const result = this.segmenter.segmentForVideo(videoElement, ts);
      try {
        const masks = result.confidenceMasks;
        if (masks && masks.length > 0) {
          // Selfie Multiclass: [0]=background, [1]=hair, [2]=body-skin, [3]=face-skin, [4]=clothes, [5]=others
          const bgMask = masks[0];
          const hairMask = masks.length >= 2 ? masks[1] : null;
          const isMulticlass = masks.length >= 2;

          const mw = bgMask.width;
          const mh = bgMask.height;
          const bgData = bgMask.getAsFloat32Array();
          const hairData = hairMask ? hairMask.getAsFloat32Array() : null;

          this._ensureMaskResources(mw, mh);

          const rgba = this._maskRgbaBuffer;
          for (let i = 0, len = bgData.length; i < len; i++) {
            const p = isMulticlass ? 1.0 - bgData[i] : bgData[i];
            const h = hairData ? hairData[i] : 0.0;
            const o = i << 2;
            rgba[o] = p <= 0 ? 0 : p >= 1 ? 255 : (p * 255 + 0.5) | 0;
            rgba[o + 1] = h <= 0 ? 0 : h >= 1 ? 255 : (h * 255 + 0.5) | 0;
            rgba[o + 2] = 0;
            rgba[o + 3] = 255;
          }

          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, this._rawMaskTex);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, mw, mh, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);

          const writeIdx = 1 - this._pingIdx;
          const readIdx = this._pingIdx;

          gl.bindFramebuffer(gl.FRAMEBUFFER, this._pingPongFbo[writeIdx]);
          gl.viewport(0, 0, mw, mh);
          gl.useProgram(this._temporalProgram);
          this._bindQuad(this._tPosAttr);

          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, this._rawMaskTex);
          gl.uniform1i(this._tLoc.u_currMask, 0);

          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, this._pingPongTex[readIdx]);
          gl.uniform1i(this._tLoc.u_prevMask, 1);

          gl.uniform1f(this._tLoc.u_temporalSmooth, this.options.temporalSmooth);
          gl.uniform1f(this._tLoc.u_hasPrev, this._hasPrevMask ? 1.0 : 0.0);

          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

          this._pingIdx = writeIdx;
          this._hasPrevMask = true;
          smoothedMaskTex = this._pingPongTex[this._pingIdx];
        }
      } finally {
        if (typeof result.close === 'function') {
          result.close();
        }
      }
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, vw, vh);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this._compositeProgram);
    this._bindQuad(this._cPosAttr);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._videoTex);
    gl.uniform1i(this._cLoc.u_video, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, smoothedMaskTex || this._rawMaskTex);
    gl.uniform1i(this._cLoc.u_mask, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this._bgTex);
    gl.uniform1i(this._cLoc.u_bg, 2);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this._cleanPlateTex);
    gl.uniform1i(this._cLoc.u_cleanPlateTex, 3);

    gl.uniform2f(this._cLoc.u_resolution, vw, vh);
    gl.uniform2f(
      this._cLoc.u_maskTexelSize,
      1.0 / Math.max(this._maskWidth, 1),
      1.0 / Math.max(this._maskHeight, 1)
    );
    gl.uniform2f(this._cLoc.u_bgSize, this._bgWidth, this._bgHeight);

    gl.uniform1f(this._cLoc.u_mirror, mirror ? 1.0 : 0.0);
    gl.uniform1f(this._cLoc.u_hasBg, this._hasBg ? 1.0 : 0.0);
    gl.uniform1f(this._cLoc.u_noBgMode, this.options.noBgMode === 'original' ? 1.0 : 0.0);
    gl.uniform1f(this._cLoc.u_hasCleanPlate, this.hasCleanPlate ? 1.0 : 0.0);
    gl.uniform1f(this._cLoc.u_threshold, this.options.threshold);
    gl.uniform1f(this._cLoc.u_edgeShrink, this.options.edgeShrink);
    gl.uniform1f(this._cLoc.u_edgeFeather, this.options.edgeFeather);
    gl.uniform1f(this._cLoc.u_edgeSnap, this.options.edgeSnap);
    gl.uniform1f(this._cLoc.u_bgBlur, this.options.bgBlur);
    gl.uniform1f(this._cLoc.u_cleanPlateSensitivity, this.options.cleanPlateSensitivity);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    return this.canvas;
  }

  dispose() {
    this._disposed = true;
    this.isInitialized = false;
    this._hasPrevMask = false;
    this.hasCleanPlate = false;
    this._hasBg = false;
    this._bgCache.clear();

    this.canvas.removeEventListener('webglcontextlost', this._onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this._onContextRestored);

    if (this.segmenter) {
      try {
        this.segmenter.close();
      } catch {
        // ignore
      }
      this.segmenter = null;
    }

    const gl = this.gl;
    if (gl) {
      if (this._videoTex) gl.deleteTexture(this._videoTex);
      if (this._bgTex) gl.deleteTexture(this._bgTex);
      if (this._cleanPlateTex) gl.deleteTexture(this._cleanPlateTex);
      if (this._rawMaskTex) gl.deleteTexture(this._rawMaskTex);
      for (let i = 0; i < 2; i++) {
        if (this._pingPongTex[i]) gl.deleteTexture(this._pingPongTex[i]);
        if (this._pingPongFbo[i]) gl.deleteFramebuffer(this._pingPongFbo[i]);
      }
      if (this._quadBuffer) gl.deleteBuffer(this._quadBuffer);
      if (this._temporalProgram) gl.deleteProgram(this._temporalProgram);
      if (this._compositeProgram) gl.deleteProgram(this._compositeProgram);

      const loseExt = gl.getExtension('WEBGL_lose_context');
      if (loseExt) loseExt.loseContext();
      this.gl = null;
    }

    this._maskRgbaBuffer = null;
  }

  _initWebGL() {
    const attrs = {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    };

    const gl = this.canvas.getContext('webgl2', attrs) || this.canvas.getContext('webgl', attrs);
    if (!gl) {
      throw new Error('WebGL is not supported on this device/browser.');
    }

    this.gl = gl;

    this._quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    this._temporalProgram = this._createProgram(VERTEX_SHADER_SRC, TEMPORAL_FRAGMENT_SHADER_SRC);
    this._compositeProgram = this._createProgram(VERTEX_SHADER_SRC, COMPOSITE_FRAGMENT_SHADER_SRC);

    this._tPosAttr = gl.getAttribLocation(this._temporalProgram, 'a_pos');
    this._tLoc = {
      u_currMask: gl.getUniformLocation(this._temporalProgram, 'u_currMask'),
      u_prevMask: gl.getUniformLocation(this._temporalProgram, 'u_prevMask'),
      u_temporalSmooth: gl.getUniformLocation(this._temporalProgram, 'u_temporalSmooth'),
      u_hasPrev: gl.getUniformLocation(this._temporalProgram, 'u_hasPrev')
    };

    this._cPosAttr = gl.getAttribLocation(this._compositeProgram, 'a_pos');
    this._cLoc = {
      u_video: gl.getUniformLocation(this._compositeProgram, 'u_video'),
      u_mask: gl.getUniformLocation(this._compositeProgram, 'u_mask'),
      u_bg: gl.getUniformLocation(this._compositeProgram, 'u_bg'),
      u_cleanPlateTex: gl.getUniformLocation(this._compositeProgram, 'u_cleanPlateTex'),
      u_resolution: gl.getUniformLocation(this._compositeProgram, 'u_resolution'),
      u_maskTexelSize: gl.getUniformLocation(this._compositeProgram, 'u_maskTexelSize'),
      u_bgSize: gl.getUniformLocation(this._compositeProgram, 'u_bgSize'),
      u_mirror: gl.getUniformLocation(this._compositeProgram, 'u_mirror'),
      u_hasBg: gl.getUniformLocation(this._compositeProgram, 'u_hasBg'),
      u_noBgMode: gl.getUniformLocation(this._compositeProgram, 'u_noBgMode'),
      u_hasCleanPlate: gl.getUniformLocation(this._compositeProgram, 'u_hasCleanPlate'),
      u_threshold: gl.getUniformLocation(this._compositeProgram, 'u_threshold'),
      u_edgeShrink: gl.getUniformLocation(this._compositeProgram, 'u_edgeShrink'),
      u_edgeFeather: gl.getUniformLocation(this._compositeProgram, 'u_edgeFeather'),
      u_edgeSnap: gl.getUniformLocation(this._compositeProgram, 'u_edgeSnap'),
      u_bgBlur: gl.getUniformLocation(this._compositeProgram, 'u_bgBlur'),
      u_cleanPlateSensitivity: gl.getUniformLocation(this._compositeProgram, 'u_cleanPlateSensitivity')
    };

    this._videoTex = this._createTexture();
    this._bgTex = this._createTexture();
    this._cleanPlateTex = this._createTexture();
    this._rawMaskTex = this._createTexture();

    const onePixel = new Uint8Array([0, 0, 0, 0]);
    for (const tex of [this._bgTex, this._cleanPlateTex]) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, onePixel);
    }

    this._maskWidth = 0;
    this._maskHeight = 0;
    this._hasPrevMask = false;
    this.hasCleanPlate = false;
  }

  _ensureMaskResources(width, height) {
    const gl = this.gl;
    if (!gl) return;
    if (this._maskWidth === width && this._maskHeight === height && this._maskRgbaBuffer) {
      return;
    }

    this._maskWidth = width;
    this._maskHeight = height;
    this._maskRgbaBuffer = new Uint8Array(width * height * 4);
    this._hasPrevMask = false;

    for (let i = 0; i < 2; i++) {
      if (this._pingPongTex[i]) gl.deleteTexture(this._pingPongTex[i]);
      if (this._pingPongFbo[i]) gl.deleteFramebuffer(this._pingPongFbo[i]);

      const tex = this._createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

      this._pingPongTex[i] = tex;
      this._pingPongFbo[i] = fbo;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  _createTexture() {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
  }

  _createProgram(vsSrc, fsSrc) {
    const gl = this.gl;
    const vs = this._compileShader(gl.VERTEX_SHADER, vsSrc);
    const fs = this._compileShader(gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const msg = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      throw new Error('WebGL link error: ' + msg);
    }
    return prog;
  }

  _compileShader(type, src) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const msg = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error('WebGL shader error: ' + msg);
    }
    return shader;
  }

  _bindQuad(posAttr) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._quadBuffer);
    gl.enableVertexAttribArray(posAttr);
    gl.vertexAttribPointer(posAttr, 2, gl.FLOAT, false, 0, 0);
  }

  _loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (!url.startsWith('blob:') && !url.startsWith('data:')) {
        img.crossOrigin = 'anonymous';
      }
      img.onload = () => resolve(img);
      img.onerror = (err) => reject(err);
      img.src = url;
    });
  }
}

if (typeof window !== 'undefined') {
  window.CurtainBgAI = CurtainBgAI;
}

export default CurtainBgAI;
