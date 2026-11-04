// GLSL ES 1.00, so it runs on WebGL 1 as well as 2. Ported unchanged from the prototype.

export const vertex = /* glsl */ `
  attribute vec3 position; // x, y (CSS px, viewport-centred, y up), alpha
  attribute vec4 aDyn;     // shade (-1 deep .. 0 own tone .. 1 vein-bright), size multiplier, angle, width (flip)
  attribute vec4 aRand;    // unused phase, unused, flutter phase, brightness
  attribute float aSize;   // CSS px
  attribute float aDepth;  // -1 far .. 1 near
  attribute float aTone;   // palette index 0..5

  uniform vec2 uRes;
  uniform float uDpr;
  uniform float uMinPx;
  uniform float uTime;
  uniform float uFade;
  uniform vec2 uParallax;
  uniform vec3 uPalette[6];
  uniform vec3 uVein;
  uniform vec3 uDeep;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vAngle;
  varying float vWidth;
  varying float vPx;
  varying float vBlur;

  void main() {
    vec2 p = position.xy + aDepth * uParallax;
    gl_Position = vec4(p / (uRes * 0.5), 0.0, 1.0);

    float near = smoothstep(0.78, 1.0, aDepth);
    vPx = max(aSize * (1.0 + 0.22 * aDepth) * aDyn.y * uDpr, uMinPx);
    gl_PointSize = vPx;

    vec3 own = uPalette[int(aTone + 0.5)] * (0.88 + 0.24 * aRand.w);
    vColor = aDyn.x >= 0.0 ? mix(own, uVein, aDyn.x * 0.85) : mix(own, uDeep, -aDyn.x);
    vAlpha = position.z * uFade * mix(1.0, 0.4, near);
    vBlur = 1.0 + near * 6.0;
    vWidth = aDyn.w;
    vAngle = aDyn.z + sin(uTime * 1.6 + aRand.z * 6.2831853) * 0.4;
  }
`;

export const fragment = /* glsl */ `
  precision highp float;

  uniform float uFold;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vAngle;
  varying float vWidth;
  varying float vPx;
  varying float vBlur;

  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    p.y = -p.y;
    float c = cos(vAngle);
    float s = sin(vAngle);
    p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    // A leaf tumbling in flight turns edge-on: it narrows about its midrib.
    p.x /= max(vWidth, 0.12);

    // A leaf along +y: pointed at both ends, widest a little below the middle.
    float t = (p.y + 0.92) / 1.84;
    if (t <= 0.0 || t >= 1.0) discard;
    float halfWidth = 0.46 * sin(3.14159265 * pow(t, 0.72));
    float d = abs(p.x) - halfWidth;

    float aa = 2.0 / vPx * vBlur / max(vWidth, 0.12); // one device pixel in sprite units, widened when out of focus
    float a = smoothstep(aa, -aa, d);
    if (a < 0.004) discard;

    // One half in shade, as if folded along the midrib; the rib itself shows on the larger leaves.
    float side = mix(uFold, 1.0, smoothstep(-aa, aa, p.x));
    float rib = 1.0 - 0.22 * smoothstep(aa * 1.3, 0.0, abs(p.x)) * step(10.0, vPx) * step(t, 0.92);
    float alpha = a * vAlpha;
    gl_FragColor = vec4(vColor * side * rib * alpha, alpha);
  }
`;
