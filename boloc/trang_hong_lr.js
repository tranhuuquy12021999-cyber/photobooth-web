/**
 * trang_hong_lr.js — Bộ lọc Lightroom "Tone Trắng Hồng" + Khử mụn thông minh & Mịn da giữ nét (WebGL 60 FPS)
 * Tương thích 100% web tĩnh / Photobooth trên GitHub Pages (Không React, không thư viện ngoài)
 */
(function (global) {
  'use strict';

  const DEFAULT_PRESET = {
    // Ánh sáng (Light)
    exposure: 0.1,
    highlights: -20,
    shadows: 18,
    whites: -19,
    blacks: 20,

    // Màu sắc tổng (Color)
    temp: -8,
    vibrance: 25,

    // Màu riêng (HSL)
    redHue: 0,
    redSat: 12,
    redLum: 12,

    orangeHue: -1,
    orangeSat: -9,
    orangeLum: 7,

    yellowHue: 0,
    yellowSat: 10,
    yellowLum: 12,

    greenHue: 0,
    greenSat: 1,
    greenLum: -1,

    // Làm đẹp & Chi tiết (Beauty & Detail)
    acneRemoval: 55,
    skinSmooth: 35,
    sharpening: 75
  };

  const VERTEX_SHADER_SRC = "attribute vec2 a_position;\nattribute vec2 a_texCoord;\nvarying vec2 v_texCoord;\n\nvoid main() {\n  gl_Position = vec4(a_position, 0.0, 1.0);\n  v_texCoord = a_texCoord;\n}";

  const FRAGMENT_SHADER_SRC = "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n\nuniform sampler2D u_image;\nuniform vec2 u_texelSize;\nuniform float u_mirror;\nuniform float u_bypass;\n\n// Beauty & Detail\nuniform float u_acneRemoval;\nuniform float u_skinSmooth;\nuniform float u_sharpening;\n\n// Optional MediaPipe FaceMesh protection ellipses (cx, cy, rx, ry in source UV)\nuniform float u_hasLandmarks;\nuniform vec4 u_faceOval;\nuniform vec4 u_leftEye;\nuniform vec4 u_rightEye;\nuniform vec4 u_mouth;\nuniform vec4 u_noseBase;\n\n// Light\nuniform float u_exposure;\nuniform float u_highlights;\nuniform float u_shadows;\nuniform float u_whites;\nuniform float u_blacks;\n\n// Color\nuniform float u_temp;\nuniform float u_vibrance;\n\n// HSL (Red, Orange, Yellow, Green)\nuniform vec3 u_hslRed;\nuniform vec3 u_hslOrange;\nuniform vec3 u_hslYellow;\nuniform vec3 u_hslGreen;\n\nvarying vec2 v_texCoord;\n\nconst vec3 LUMA_COEFF = vec3(0.2126, 0.7152, 0.0722);\n\nfloat computeSkinMask(vec3 rgb) {\n  float Y  = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;\n  float Cb = 0.5 - 0.168736 * rgb.r - 0.331264 * rgb.g + 0.5 * rgb.b;\n  float Cr = 0.5 + 0.5 * rgb.r - 0.418688 * rgb.g - 0.081312 * rgb.b;\n\n  float yMask  = smoothstep(0.14, 0.27, Y) * (1.0 - smoothstep(0.92, 0.99, Y));\n  float cbMask = smoothstep(0.275, 0.345, Cb) * (1.0 - smoothstep(0.475, 0.535, Cb));\n  float crMask = smoothstep(0.51, 0.555, Cr) * (1.0 - smoothstep(0.685, 0.75, Cr));\n\n  float warmMask = smoothstep(-0.01, 0.055, rgb.r - rgb.b);\n  return yMask * cbMask * crMask * warmMask;\n}\n\nfloat ellipseDistSq(vec2 p, vec4 e) {\n  vec2 d = (p - e.xy) / max(e.zw, vec2(0.0005));\n  return dot(d, d);\n}\n\nfloat computeLandmarkGuard(vec2 uv) {\n  if (u_hasLandmarks < 0.5) return 1.0;\n\n  float insideFace = 1.0 - smoothstep(0.88, 1.18, ellipseDistSq(uv, u_faceOval));\n  float guardLeftEye  = smoothstep(0.75, 1.35, ellipseDistSq(uv, u_leftEye));\n  float guardRightEye = smoothstep(0.75, 1.35, ellipseDistSq(uv, u_rightEye));\n  float guardMouth    = smoothstep(0.78, 1.32, ellipseDistSq(uv, u_mouth));\n  float guardNose     = smoothstep(0.65, 1.25, ellipseDistSq(uv, u_noseBase));\n\n  return insideFace * guardLeftEye * guardRightEye * guardMouth * guardNose;\n}\n\nvec3 rgb2hsl(vec3 c) {\n  float maxC = max(c.r, max(c.g, c.b));\n  float minC = min(c.r, min(c.g, c.b));\n  float l = 0.5 * (maxC + minC);\n  float d = maxC - minC;\n\n  if (d < 0.00001) {\n    return vec3(0.0, 0.0, l);\n  }\n\n  float s = l > 0.5 ? d / max(2.0 - maxC - minC, 0.00001) : d / max(maxC + minC, 0.00001);\n  float h = 0.0;\n\n  if (maxC == c.r) {\n    h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);\n  } else if (maxC == c.g) {\n    h = (c.b - c.r) / d + 2.0;\n  } else {\n    h = (c.r - c.g) / d + 4.0;\n  }\n  h /= 6.0;\n\n  return vec3(h, s, l);\n}\n\nfloat hue2rgb(float p, float q, float t) {\n  float tt = fract(t);\n  if (tt < 1.0 / 6.0) return p + (q - p) * 6.0 * tt;\n  if (tt < 0.5) return q;\n  if (tt < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - tt) * 6.0;\n  return p;\n}\n\nvec3 hsl2rgb(vec3 hsl) {\n  float h = hsl.x;\n  float s = hsl.y;\n  float l = hsl.z;\n\n  if (s < 0.00001) {\n    return vec3(l);\n  }\n\n  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;\n  float p = 2.0 * l - q;\n\n  return vec3(\n    hue2rgb(p, q, h + 1.0 / 3.0),\n    hue2rgb(p, q, h),\n    hue2rgb(p, q, h - 1.0 / 3.0)\n  );\n}\n\nfloat hueBell(float deg, float center, float leftWidth, float rightWidth) {\n  float diff = mod(deg - center + 540.0, 360.0) - 180.0;\n  float width = diff < 0.0 ? leftWidth : rightWidth;\n  float t = clamp(abs(diff) / max(width, 0.001), 0.0, 1.0);\n  return 1.0 - (t * t * (3.0 - 2.0 * t));\n}\n\nvoid main() {\n  vec2 uv = vec2(mix(v_texCoord.x, 1.0 - v_texCoord.x, u_mirror), v_texCoord.y);\n  vec4 texColor = texture2D(u_image, uv);\n  vec3 rawColor = texColor.rgb;\n\n  if (u_bypass > 0.5) {\n    gl_FragColor = vec4(rawColor, texColor.a);\n    return;\n  }\n\n  vec3 color = rawColor;\n\n  vec3 cL = texture2D(u_image, uv - vec2(u_texelSize.x, 0.0)).rgb;\n  vec3 cR = texture2D(u_image, uv + vec2(u_texelSize.x, 0.0)).rgb;\n  vec3 cT = texture2D(u_image, uv - vec2(0.0, u_texelSize.y)).rgb;\n  vec3 cB = texture2D(u_image, uv + vec2(0.0, u_texelSize.y)).rgb;\n\n  float lCenterRaw = dot(rawColor, LUMA_COEFF);\n  float lL = dot(cL, LUMA_COEFF);\n  float lR = dot(cR, LUMA_COEFF);\n  float lT = dot(cT, LUMA_COEFF);\n  float lB = dot(cB, LUMA_COEFF);\n  float gradMag = length(vec2(lR - lL, lB - lT));\n\n  float beautyMaskApplied = 0.0;\n\n  if (u_acneRemoval > 0.001 || u_skinSmooth > 0.001) {\n    float skinMask = computeSkinMask(rawColor) * computeLandmarkGuard(uv);\n\n    if (skinMask > 0.005) {\n      float minDim = min(1.0 / max(u_texelSize.x, 0.00001), 1.0 / max(u_texelSize.y, 0.00001));\n      float pxScale = clamp(minDim / 420.0, 1.0, 6.0);\n\n      vec2 rInner = u_texelSize * (1.85 * pxScale);\n      vec2 rOuter = u_texelSize * (4.10 * pxScale);\n\n      vec2 d0 = vec2(1.0, 0.0);\n      vec2 d1 = vec2(0.7071, 0.7071);\n      vec2 d2 = vec2(0.0, 1.0);\n      vec2 d3 = vec2(-0.7071, 0.7071);\n\n      vec3 o0 = texture2D(u_image, uv + d0 * rOuter).rgb;\n      vec3 o4 = texture2D(u_image, uv - d0 * rOuter).rgb;\n      vec3 o1 = texture2D(u_image, uv + d1 * rOuter).rgb;\n      vec3 o5 = texture2D(u_image, uv - d1 * rOuter).rgb;\n      vec3 o2 = texture2D(u_image, uv + d2 * rOuter).rgb;\n      vec3 o6 = texture2D(u_image, uv - d2 * rOuter).rgb;\n      vec3 o3 = texture2D(u_image, uv + d3 * rOuter).rgb;\n      vec3 o7 = texture2D(u_image, uv - d3 * rOuter).rgb;\n\n      float oppDiff = max(\n        max(abs(dot(o0 - o4, LUMA_COEFF)), abs(dot(o1 - o5, LUMA_COEFF))),\n        max(abs(dot(o2 - o6, LUMA_COEFF)), abs(dot(o3 - o7, LUMA_COEFF)))\n      );\n\n      vec3 i0 = texture2D(u_image, uv + d0 * rInner).rgb;\n      vec3 i4 = texture2D(u_image, uv - d0 * rInner).rgb;\n      vec3 i1 = texture2D(u_image, uv + d1 * rInner).rgb;\n      vec3 i5 = texture2D(u_image, uv - d1 * rInner).rgb;\n      vec3 i2 = texture2D(u_image, uv + d2 * rInner).rgb;\n      vec3 i6 = texture2D(u_image, uv - d2 * rInner).rgb;\n      vec3 i3 = texture2D(u_image, uv + d3 * rInner).rgb;\n      vec3 i7 = texture2D(u_image, uv - d3 * rInner).rgb;\n\n      vec3 skinSum = vec3(0.0);\n      float skinWeightSum = 0.0001;\n\n      {\n        vec3 s; float sm; float sl; float sr; float w;\n\n        s = o0; sm = computeSkinMask(s); sl = dot(s, LUMA_COEFF); sr = s.r - s.g;\n        w = sm * (0.30 + 0.70 * smoothstep(0.18, 0.72, sl)) * exp(-max(sr - 0.13, 0.0) * 7.5);\n        skinSum += s * w; skinWeightSum += w;\n\n        s = o1; sm = computeSkinMask(s); sl = dot(s, LUMA_COEFF); sr = s.r - s.g;\n        w = sm * (0.30 + 0.70 * smoothstep(0.18, 0.72, sl)) * exp(-max(sr - 0.13, 0.0) * 7.5);\n        skinSum += s * w; skinWeightSum += w;\n\n        s = o2; sm = computeSkinMask(s); sl = dot(s, LUMA_COEFF); sr = s.r - s.g;\n        w = sm * (0.30 + 0.70 * smoothstep(0.18, 0.72, sl)) * exp(-max(sr - 0.13, 0.0) * 7.5);\n        skinSum += s * w; skinWeightSum += w;\n\n        s = o3; sm = computeSkinMask(s); sl = dot(s, LUMA_COEFF); sr = s.r - s.g;\n        w = sm * (0.30 + 0.70 * smoothstep(0.18, 0.72, sl)) * exp(-max(sr - 0.13, 0.0) * 7.5);\n        skinSum += s * w; skinWeightSum += w;\n\n        s = o4; sm = computeSkinMask(s); sl = dot(s, LUMA_COEFF); sr = s.r - s.g;\n        w = sm * (0.30 + 0.70 * smoothstep(0.18, 0.72, sl)) * exp(-max(sr - 0.13, 0.0) * 7.5);\n        skinSum += s * w; skinWeightSum += w;\n\n        s = o5; sm = computeSkinMask(s); sl = dot(s, LUMA_COEFF); sr = s.r - s.g;\n        w = sm * (0.30 + 0.70 * smoothstep(0.18, 0.72, sl)) * exp(-max(sr - 0.13, 0.0) * 7.5);\n        skinSum += s * w; skinWeightSum += w;\n\n        s = o6; sm = computeSkinMask(s); sl = dot(s, LUMA_COEFF); sr = s.r - s.g;\n        w = sm * (0.30 + 0.70 * smoothstep(0.18, 0.72, sl)) * exp(-max(sr - 0.13, 0.0) * 7.5);\n        skinSum += s * w; skinWeightSum += w;\n\n        s = o7; sm = computeSkinMask(s); sl = dot(s, LUMA_COEFF); sr = s.r - s.g;\n        w = sm * (0.30 + 0.70 * smoothstep(0.18, 0.72, sl)) * exp(-max(sr - 0.13, 0.0) * 7.5);\n        skinSum += s * w; skinWeightSum += w;\n      }\n\n      float surroundSkinCoverage = smoothstep(0.9, 3.2, skinWeightSum);\n      vec3 localSkinMean = skinSum / skinWeightSum;\n\n      if (u_acneRemoval > 0.001 && surroundSkinCoverage > 0.01) {\n        float acneAmt = u_acneRemoval / 100.0;\n\n        float centerRed = color.r - color.g;\n        float meanRed = localSkinMean.r - localSkinMean.g;\n        float redExcess = max(centerRed - meanRed, 0.0);\n\n        float lipGuard = 1.0 - smoothstep(0.24, 0.38, centerRed);\n        float redSpot = smoothstep(0.014, 0.075, redExcess) * lipGuard;\n\n        float meanLum = dot(localSkinMean, LUMA_COEFF);\n        float lumDeficit = max(meanLum - lCenterRaw, 0.0);\n        float darkSpot = smoothstep(0.018, 0.095, lumDeficit) * (1.0 - smoothstep(0.19, 0.32, lumDeficit));\n\n        float contourLock = (1.0 - smoothstep(0.055, 0.15, gradMag))\n          * (1.0 - smoothstep(0.09, 0.22, oppDiff));\n\n        float healStrength = clamp(max(redSpot, darkSpot * 0.90), 0.0, 1.0)\n          * contourLock\n          * surroundSkinCoverage\n          * skinMask\n          * acneAmt;\n\n        float blendW = clamp(healStrength * 1.15, 0.0, 0.94);\n        color = mix(color, localSkinMean, blendW);\n        beautyMaskApplied = max(beautyMaskApplied, blendW);\n      }\n\n      if (u_skinSmooth > 0.001) {\n        float smoothAmt = u_skinSmooth / 100.0;\n        float sigma = 0.052 + 0.036 * smoothAmt;\n        float invTwoSigmaSq = 1.0 / (2.0 * sigma * sigma);\n\n        vec3 biSum = color * 1.35;\n        float biWeight = 1.35;\n\n        vec3 d; float w;\n\n        d = cL - color; w = 0.90 * exp(-dot(d, d) * invTwoSigmaSq); biSum += cL * w; biWeight += w;\n        d = cR - color; w = 0.90 * exp(-dot(d, d) * invTwoSigmaSq); biSum += cR * w; biWeight += w;\n        d = cT - color; w = 0.90 * exp(-dot(d, d) * invTwoSigmaSq); biSum += cT * w; biWeight += w;\n        d = cB - color; w = 0.90 * exp(-dot(d, d) * invTwoSigmaSq); biSum += cB * w; biWeight += w;\n\n        d = i0 - color; w = 0.72 * exp(-dot(d, d) * invTwoSigmaSq); biSum += i0 * w; biWeight += w;\n        d = i1 - color; w = 0.72 * exp(-dot(d, d) * invTwoSigmaSq); biSum += i1 * w; biWeight += w;\n        d = i2 - color; w = 0.72 * exp(-dot(d, d) * invTwoSigmaSq); biSum += i2 * w; biWeight += w;\n        d = i3 - color; w = 0.72 * exp(-dot(d, d) * invTwoSigmaSq); biSum += i3 * w; biWeight += w;\n        d = i4 - color; w = 0.72 * exp(-dot(d, d) * invTwoSigmaSq); biSum += i4 * w; biWeight += w;\n        d = i5 - color; w = 0.72 * exp(-dot(d, d) * invTwoSigmaSq); biSum += i5 * w; biWeight += w;\n        d = i6 - color; w = 0.72 * exp(-dot(d, d) * invTwoSigmaSq); biSum += i6 * w; biWeight += w;\n        d = i7 - color; w = 0.72 * exp(-dot(d, d) * invTwoSigmaSq); biSum += i7 * w; biWeight += w;\n\n        d = o1 - color; w = 0.35 * exp(-dot(d, d) * invTwoSigmaSq); biSum += o1 * w; biWeight += w;\n        d = o3 - color; w = 0.35 * exp(-dot(d, d) * invTwoSigmaSq); biSum += o3 * w; biWeight += w;\n        d = o5 - color; w = 0.35 * exp(-dot(d, d) * invTwoSigmaSq); biSum += o5 * w; biWeight += w;\n        d = o7 - color; w = 0.35 * exp(-dot(d, d) * invTwoSigmaSq); biSum += o7 * w; biWeight += w;\n\n        vec3 blurred = biSum / biWeight;\n\n        float edgeKeep = 1.0 - smoothstep(0.065, 0.165, gradMag);\n        float smoothMix = clamp(smoothAmt * 0.82 * skinMask * edgeKeep, 0.0, 0.85);\n        color = mix(color, blurred, smoothMix);\n        beautyMaskApplied = max(beautyMaskApplied, smoothMix * 0.78);\n      }\n    }\n  }\n\n  if (abs(u_exposure) > 0.0005) {\n    vec3 lin = pow(max(color, vec3(0.0)), vec3(2.2));\n    lin *= exp2(u_exposure);\n    vec3 over = max(lin - vec3(0.94), vec3(0.0));\n    lin = min(lin, vec3(0.94)) + over / (vec3(1.0) + over * 0.65);\n    color = pow(clamp(lin, 0.0, 1.0), vec3(1.0 / 2.2));\n  }\n\n  if (abs(u_temp) > 0.001) {\n    float t = u_temp / 100.0;\n    float lumBefore = dot(color, LUMA_COEFF);\n    color.r *= (1.0 + t * 0.13);\n    color.g *= (1.0 + t * 0.015);\n    color.b *= (1.0 - t * 0.155);\n    color = max(color, vec3(0.0));\n    float lumAfter = dot(color, LUMA_COEFF);\n    color *= mix(1.0, lumBefore / max(lumAfter, 0.0001), 0.68);\n    color = clamp(color, 0.0, 1.0);\n  }\n\n  {\n    float lum = dot(color, LUMA_COEFF);\n\n    float blacksMask = 1.0 - smoothstep(0.0, 0.34, lum);\n    float shadowsMask = (1.0 - smoothstep(0.06, 0.58, lum)) * smoothstep(0.0, 0.14, lum + 0.04);\n    float highlightsMask = smoothstep(0.42, 0.88, lum);\n    float whitesMask = smoothstep(0.68, 1.0, lum);\n\n    float dBlacks = (u_blacks / 100.0) * 0.145 * blacksMask;\n    float dShadows = (u_shadows / 100.0) * 0.23 * shadowsMask;\n    float dHighlights = (u_highlights / 100.0) * 0.24 * highlightsMask;\n    float dWhites = (u_whites / 100.0) * 0.19 * whitesMask;\n\n    float totalDelta = dBlacks + dShadows + dHighlights + dWhites;\n    float targetLum = clamp(lum + totalDelta, 0.0, 1.0);\n\n    vec3 ratioColor = color * (targetLum / max(lum, 0.002));\n    vec3 shiftColor = color + vec3(targetLum - lum);\n    float ratioWeight = smoothstep(0.05, 0.36, lum) * (1.0 - 0.32 * smoothstep(0.76, 1.0, lum));\n    color = clamp(mix(shiftColor, ratioColor, ratioWeight), 0.0, 1.0);\n  }\n\n  if (abs(u_vibrance) > 0.001) {\n    vec3 hslV = rgb2hsl(color);\n    float degV = hslV.x * 360.0;\n    float skinProtectBell = hueBell(degV, 26.0, 22.0, 28.0);\n    float neutralGate = smoothstep(0.025, 0.13, hslV.y);\n    float mutedBias = 1.0 - hslV.y * 0.72;\n    float skinProtect = 1.0 - 0.54 * skinProtectBell * step(0.0, u_vibrance);\n\n    float vibGain = (u_vibrance / 100.0) * 0.58 * mutedBias * skinProtect * neutralGate;\n    float lumV = dot(color, LUMA_COEFF);\n    color = clamp(mix(vec3(lumV), color, 1.0 + vibGain), 0.0, 1.0);\n  }\n\n  {\n    vec3 hsl = rgb2hsl(color);\n    float deg = hsl.x * 360.0;\n\n    float satGate = smoothstep(0.045, 0.18, hsl.y)\n      * smoothstep(0.02, 0.10, hsl.z)\n      * (1.0 - smoothstep(0.93, 0.995, hsl.z));\n\n    if (satGate > 0.0001) {\n      float wRed = hueBell(deg, 0.0, 32.0, 28.0);\n      float wOrange = hueBell(deg, 28.0, 28.0, 30.0);\n      float wYellow = hueBell(deg, 58.0, 30.0, 36.0);\n      float wGreen = hueBell(deg, 120.0, 52.0, 56.0);\n\n      float wSum = wRed + wOrange + wYellow + wGreen;\n      if (wSum > 1.0) {\n        float invSum = 1.0 / wSum;\n        wRed *= invSum;\n        wOrange *= invSum;\n        wYellow *= invSum;\n        wGreen *= invSum;\n      }\n\n      float dHue = wRed * u_hslRed.x + wOrange * u_hslOrange.x + wYellow * u_hslYellow.x + wGreen * u_hslGreen.x;\n      float dSat = wRed * u_hslRed.y + wOrange * u_hslOrange.y + wYellow * u_hslYellow.y + wGreen * u_hslGreen.y;\n      float dLum = wRed * u_hslRed.z + wOrange * u_hslOrange.z + wYellow * u_hslYellow.z + wGreen * u_hslGreen.z;\n\n      hsl.x = fract(hsl.x + (dHue / 100.0) * (32.0 / 360.0) * satGate);\n      hsl.y = clamp(hsl.y * (1.0 + (dSat / 100.0) * 0.90 * satGate), 0.0, 1.0);\n      float lumEnv = 0.35 + 0.65 * (1.0 - abs(2.0 * hsl.z - 1.0));\n      hsl.z = clamp(hsl.z + (dLum / 100.0) * 0.28 * lumEnv * satGate, 0.0, 1.0);\n\n      color = clamp(hsl2rgb(hsl), 0.0, 1.0);\n    }\n  }\n\n  if (u_sharpening > 0.001) {\n    float lAvg = 0.25 * (lL + lR + lT + lB);\n    float edge = lCenterRaw - lAvg;\n    float edgeMask = smoothstep(0.0035, 0.024, abs(edge));\n    float beautySharpGuard = 1.0 - clamp(beautyMaskApplied * 0.95, 0.0, 0.95);\n    float sharpAmount = (u_sharpening / 100.0) * 1.15 * beautySharpGuard;\n    float deltaSharp = clamp(edge * sharpAmount * edgeMask, -0.18, 0.18);\n    color = clamp(color + vec3(deltaSharp), 0.0, 1.0);\n  }\n\n  gl_FragColor = vec4(color, texColor.a);\n}";

  function getSourceSize(source) {
    if (!source) return { width: 0, height: 0 };
    if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) {
      return { width: source.videoWidth || source.width || 0, height: source.videoHeight || source.height || 0 };
    }
    if (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement) {
      return { width: source.naturalWidth || source.width || 0, height: source.naturalHeight || source.height || 0 };
    }
    return { width: source.width || 0, height: source.height || 0 };
  }

  function computeEllipse(pts, indices, padX, padY) {
    let minX = 1, maxX = 0, minY = 1, maxY = 0, count = 0;
    for (let i = 0; i < indices.length; i++) {
      const p = pts[indices[i]];
      if (p && typeof p.x === 'number' && typeof p.y === 'number') {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
        count++;
      }
    }
    if (count < 2) return [0.5, 0.5, 0.001, 0.001];
    return [
      (minX + maxX) * 0.5,
      (minY + maxY) * 0.5,
      Math.max((maxX - minX) * 0.5 * padX, 0.008),
      Math.max((maxY - minY) * 0.5 * padY, 0.008)
    ];
  }

  function extractFaceMeshEllipses(input) {
    if (!input || !Array.isArray(input) || input.length === 0) {
      return { hasLandmarks: false };
    }
    const pts = Array.isArray(input[0]) ? input[0] : input;
    if (!pts || pts.length < 400) {
      return { hasLandmarks: false };
    }
    return {
      hasLandmarks: true,
      faceOval: computeEllipse(pts, [10, 152, 234, 454, 127, 356, 172, 397], 1.06, 1.08),
      leftEye: computeEllipse(pts, [33, 133, 159, 145, 70, 105, 107, 46], 1.25, 1.45),
      rightEye: computeEllipse(pts, [362, 263, 386, 374, 300, 334, 336, 276], 1.25, 1.45),
      mouth: computeEllipse(pts, [61, 291, 0, 17, 13, 14, 37, 267], 1.18, 1.3),
      noseBase: computeEllipse(pts, [98, 327, 2, 1, 168], 1.15, 0.85)
    };
  }

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    if (!shader) {
      throw new Error('[TrangHongLRFilter] Không thể tạo WebGL shader.');
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const err = gl.getShaderInfoLog(shader) || 'Shader compile error';
      gl.deleteShader(shader);
      throw new Error('[TrangHongLRFilter] Lỗi biên dịch shader: ' + err);
    }
    return shader;
  }

  class TrangHongLRFilter {
    constructor(canvas, customParams = {}) {
      if (!canvas || typeof canvas.getContext !== 'function') {
        throw new Error('[TrangHongLRFilter] Cần truyền vào một thẻ <canvas> hợp lệ.');
      }

      this.canvas = canvas;
      this.params = Object.assign({}, DEFAULT_PRESET, customParams);
      this._disposed = false;

      const glOpts = {
        preserveDrawingBuffer: true,
        antialias: false,
        alpha: true,
        premultipliedAlpha: false
      };

      const gl = canvas.getContext('webgl', glOpts) || canvas.getContext('experimental-webgl', glOpts);
      if (!gl) {
        throw new Error('[TrangHongLRFilter] Trình duyệt không hỗ trợ WebGL.');
      }
      this.gl = gl;

      this._vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
      this._fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC);

      const program = gl.createProgram();
      gl.attachShader(program, this._vertexShader);
      gl.attachShader(program, this._fragmentShader);
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const err = gl.getProgramInfoLog(program) || 'Program link error';
        gl.deleteProgram(program);
        throw new Error('[TrangHongLRFilter] Lỗi liên kết shader program: ' + err);
      }

      this._program = program;
      gl.useProgram(program);

      this._posBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this._posBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW
      );
      const aPos = gl.getAttribLocation(program, 'a_position');
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      this._texBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this._texBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0]),
        gl.STATIC_DRAW
      );
      const aTex = gl.getAttribLocation(program, 'a_texCoord');
      gl.enableVertexAttribArray(aTex);
      gl.vertexAttribPointer(aTex, 2, gl.FLOAT, false, 0, 0);

      this._texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this._texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      this._uniforms = {
        image: gl.getUniformLocation(program, 'u_image'),
        texelSize: gl.getUniformLocation(program, 'u_texelSize'),
        mirror: gl.getUniformLocation(program, 'u_mirror'),
        bypass: gl.getUniformLocation(program, 'u_bypass'),
        acneRemoval: gl.getUniformLocation(program, 'u_acneRemoval'),
        skinSmooth: gl.getUniformLocation(program, 'u_skinSmooth'),
        sharpening: gl.getUniformLocation(program, 'u_sharpening'),
        hasLandmarks: gl.getUniformLocation(program, 'u_hasLandmarks'),
        faceOval: gl.getUniformLocation(program, 'u_faceOval'),
        leftEye: gl.getUniformLocation(program, 'u_leftEye'),
        rightEye: gl.getUniformLocation(program, 'u_rightEye'),
        mouth: gl.getUniformLocation(program, 'u_mouth'),
        noseBase: gl.getUniformLocation(program, 'u_noseBase'),
        exposure: gl.getUniformLocation(program, 'u_exposure'),
        highlights: gl.getUniformLocation(program, 'u_highlights'),
        shadows: gl.getUniformLocation(program, 'u_shadows'),
        whites: gl.getUniformLocation(program, 'u_whites'),
        blacks: gl.getUniformLocation(program, 'u_blacks'),
        temp: gl.getUniformLocation(program, 'u_temp'),
        vibrance: gl.getUniformLocation(program, 'u_vibrance'),
        hslRed: gl.getUniformLocation(program, 'u_hslRed'),
        hslOrange: gl.getUniformLocation(program, 'u_hslOrange'),
        hslYellow: gl.getUniformLocation(program, 'u_hslYellow'),
        hslGreen: gl.getUniformLocation(program, 'u_hslGreen')
      };

      gl.uniform1i(this._uniforms.image, 0);
      gl.uniform1f(this._uniforms.bypass, 0.0);
      gl.uniform1f(this._uniforms.hasLandmarks, 0.0);
      this._syncUniforms();
    }

    _syncUniforms() {
      const gl = this.gl;
      const p = this.params;
      gl.useProgram(this._program);
      gl.uniform1f(this._uniforms.acneRemoval, Number(p.acneRemoval) || 0);
      gl.uniform1f(this._uniforms.skinSmooth, Number(p.skinSmooth) || 0);
      gl.uniform1f(this._uniforms.sharpening, Number(p.sharpening) || 0);
      gl.uniform1f(this._uniforms.exposure, Number(p.exposure) || 0);
      gl.uniform1f(this._uniforms.highlights, Number(p.highlights) || 0);
      gl.uniform1f(this._uniforms.shadows, Number(p.shadows) || 0);
      gl.uniform1f(this._uniforms.whites, Number(p.whites) || 0);
      gl.uniform1f(this._uniforms.blacks, Number(p.blacks) || 0);
      gl.uniform1f(this._uniforms.temp, Number(p.temp) || 0);
      gl.uniform1f(this._uniforms.vibrance, Number(p.vibrance) || 0);
      gl.uniform3f(this._uniforms.hslRed, Number(p.redHue) || 0, Number(p.redSat) || 0, Number(p.redLum) || 0);
      gl.uniform3f(this._uniforms.hslOrange, Number(p.orangeHue) || 0, Number(p.orangeSat) || 0, Number(p.orangeLum) || 0);
      gl.uniform3f(this._uniforms.hslYellow, Number(p.yellowHue) || 0, Number(p.yellowSat) || 0, Number(p.yellowLum) || 0);
      gl.uniform3f(this._uniforms.hslGreen, Number(p.greenHue) || 0, Number(p.greenSat) || 0, Number(p.greenLum) || 0);
    }

    _syncLandmarks(landmarks) {
      const gl = this.gl;
      const lm = extractFaceMeshEllipses(landmarks);
      gl.uniform1f(this._uniforms.hasLandmarks, lm.hasLandmarks ? 1.0 : 0.0);
      if (lm.hasLandmarks) {
        gl.uniform4f(this._uniforms.faceOval, lm.faceOval[0], lm.faceOval[1], lm.faceOval[2], lm.faceOval[3]);
        gl.uniform4f(this._uniforms.leftEye, lm.leftEye[0], lm.leftEye[1], lm.leftEye[2], lm.leftEye[3]);
        gl.uniform4f(this._uniforms.rightEye, lm.rightEye[0], lm.rightEye[1], lm.rightEye[2], lm.rightEye[3]);
        gl.uniform4f(this._uniforms.mouth, lm.mouth[0], lm.mouth[1], lm.mouth[2], lm.mouth[3]);
        gl.uniform4f(this._uniforms.noseBase, lm.noseBase[0], lm.noseBase[1], lm.noseBase[2], lm.noseBase[3]);
      }
    }

    render(source, mirror = false, landmarks = null) {
      if (this._disposed || !source) return;
      const size = getSourceSize(source);
      if (size.width <= 0 || size.height <= 0) return;

      const gl = this.gl;
      gl.useProgram(this._program);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

      gl.uniform2f(this._uniforms.texelSize, 1.0 / size.width, 1.0 / size.height);
      gl.uniform1f(this._uniforms.mirror, mirror ? 1.0 : 0.0);
      this._syncLandmarks(landmarks);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    applyToImage(source, mirror = false, landmarks = null) {
      const size = getSourceSize(source);
      if (size.width <= 0 || size.height <= 0) {
        throw new Error('[TrangHongLRFilter] Nguồn ảnh chưa sẵn sàng hoặc kích thước bằng 0.');
      }

      const maxTex = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) || 4096;
      let targetW = size.width;
      let targetH = size.height;
      if (targetW > maxTex || targetH > maxTex) {
        const scale = Math.min(maxTex / targetW, maxTex / targetH);
        targetW = Math.round(targetW * scale);
        targetH = Math.round(targetH * scale);
      }

      const tempGlCanvas = document.createElement('canvas');
      tempGlCanvas.width = targetW;
      tempGlCanvas.height = targetH;

      const tempFilter = new TrangHongLRFilter(tempGlCanvas, this.params);
      tempFilter.render(source, mirror, landmarks);

      const output2DCanvas = document.createElement('canvas');
      output2DCanvas.width = targetW;
      output2DCanvas.height = targetH;
      const ctx2d = output2DCanvas.getContext('2d');
      if (ctx2d) {
        ctx2d.drawImage(tempGlCanvas, 0, 0, targetW, targetH);
      }

      tempFilter.dispose();
      return output2DCanvas;
    }

    updateParams(params) {
      if (this._disposed || !params) return;
      this.params = Object.assign({}, this.params, params);
      this._syncUniforms();
    }

    dispose() {
      if (this._disposed) return;
      this._disposed = true;
      const gl = this.gl;
      gl.deleteTexture(this._texture);
      gl.deleteBuffer(this._posBuffer);
      gl.deleteBuffer(this._texBuffer);
      gl.deleteShader(this._vertexShader);
      gl.deleteShader(this._fragmentShader);
      gl.deleteProgram(this._program);
      const loseExt = gl.getExtension('WEBGL_lose_context');
      if (loseExt) {
        loseExt.loseContext();
      }
    }
  }

  TrangHongLRFilter.DEFAULT_PRESET = Object.assign({}, DEFAULT_PRESET);
  global.TrangHongLRFilter = TrangHongLRFilter;
})(typeof window !== 'undefined' ? window : globalThis);

// TỰ ĐỘNG ĐĂNG KÝ NÚT BỘ LỌC VÀO GIAO DIỆN HQ-PHOTO
if (typeof ALL_FILTERS === 'undefined') var ALL_FILTERS = [];

(function () {
  let lrCanvas = null;
  let lrInstance = null;

  ALL_FILTERS.push({
    id: 'tranghong_lr',
    name: 'Trắng Hồng',
    icon: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop',
    render: function (sourceImg, w, h, arCtx, landmarks) {
      if (!lrCanvas) {
        lrCanvas = document.createElement('canvas');
      }
      if (lrCanvas.width !== w || lrCanvas.height !== h) {
        lrCanvas.width = w;
        lrCanvas.height = h;
      }
      if (!lrInstance && window.TrangHongLRFilter) {
        lrInstance = new window.TrangHongLRFilter(lrCanvas);
      }
      if (!lrInstance) return null;

      lrInstance.render(sourceImg, false, landmarks || null);
      return lrCanvas;
    }
  });
})();
