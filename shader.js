/*
 * GLSL for the prism hero (used by hero.js).
 *
 * One full-screen fragment shader draws the light ribbons, the spinning rhombus over them,
 * tone mapping and film grain. Anything that only depends on time is computed in hero.js
 * once per frame and passed in as a uniform, so the per-pixel work stays as small as possible.
 *
 * Uniform names follow the setting names in constants.js where they carry a setting directly
 * (gemBody -> uGemBody, brightness -> uBrightness, ...).
 */
window.Prism = window.Prism || {};

Prism.shaders = {
  vertex: `
    attribute vec2 aPos;
    void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
  `,

  fragment: (ribbonCount) => `
    // highp isn't guaranteed in WebGL 1 fragment shaders. Without it the shader still compiles
    // and animates, but at reduced quality: the noise is coarser, and after several minutes the
    // growing time values lose precision, so the strands start to move in visible steps.
    // (Very few current devices lack highp.)
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif

    #define RIBBON_COUNT ${ribbonCount}
    #define TAU 6.28318531
    #define SQRT1_2 0.70710678

    // Settings (see constants.js)
    uniform vec3 uGemBody, uGemHighlight, uGemDeep, uGemShadow;
    uniform float uGemSpread;   // warm red -> yellow spread inside the rhombus
    uniform float uGemFlow;     // how fast the rhombus gradient flows on its own
    uniform float uGemExponent; // outline exponent from gemPinch: 1 = straight sides, lower = sides curve in
    uniform float uBeamSpread;  // vertical spread of the whole fan (1 = default)
    uniform float uFringe;      // rainbow edges on the beams
    uniform float uBrightness;  // exposure before tone mapping
    uniform vec3 uBackground;   // background color (average, before grain)

    // Per ribbon
    uniform vec3 uRibbon[RIBBON_COUNT];      // intensity, flow speed, fringe (sign picks the side)
    uniform vec3 uRibbonColor[RIBBON_COUNT];
    uniform vec4 uMotion[RIBBON_COUNT];      // per frame: angle, bend, width, sheen phase

    // Per frame
    uniform vec2 uOrigin;      // ribbon source, buffer px (GL coords)
    uniform float uScale;      // buffer px per unit (= section height)
    uniform float uTime;       // slow time: ripples on the rhombus
    uniform float uFlow;       // flow time: streaming strands (speeds up while dragging)
    uniform float uGemTime;    // the rhombus' own flow time (independent of the beams' stream speed)
    uniform float uSway;       // whole fan breathing up and down (radians)
    uniform vec4 uRhombus;     // rhombus center (buffer px, GL coords), half-width, half-height (px)
    uniform float uSpin;       // rhombus rotation about its vertical axis (radians)
    uniform float uSilhouette; // rhombus half-width factor as it turns: max(|cos spin|, |sin spin|)
    uniform vec2 uCorner[5];   // square cross-section corners (cos, sin of spin + k*90deg), [4] = [0]
    uniform float uBreathe;    // slow pulse of the rhombus body band, -1..1
    uniform float uArc;        // current arc of the bands inside the rhombus
    uniform float uSweep;      // position of the glint sweeping across the rhombus
    uniform float uGrain;      // film grain offset

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
    }

    vec3 spectrum(float h) {
      return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0);
    }

    // signed distance on a loop of length 1 (for the repeating strip)
    float loopDist(float v, float c) {
      float d = v - c;
      return d - floor(d + 0.5);
    }

    float band(float v, float c, float w) {
      float d = loopDist(v, c) / w;
      return exp(-d * d);
    }

    // The rhombus palette laid out as one repeating strip that wraps around the gem: a shadow
    // base with wide, soft body / deep / highlight bands and a narrow warm spread.
    vec3 gemStrip(float v) {
      vec3 c = uGemShadow;                                             // shadow base
      c += uGemBody * band(v, 0.52, 0.16 + 0.03 * uBreathe) * 1.15;    // body
      c += uGemDeep * band(v, 0.9, 0.12) * 0.6;                        // second, deeper band
      c += uGemHighlight * band(v, 0.36, 0.06) * 1.3;                  // soft highlight
      for (int k = 0; k < 4; k++) {                                    // broad warm spread:
        float fk = float(k);                                           // red -> amber -> yellow
        c += spectrum(fk * 0.05) * band(v, 0.3 - fk * 0.05, 0.035) * 0.55 * uGemSpread;
      }
      return c;
    }

    // Half-extent of the gem's cross-section at height y: the concave outline, 1 at the equator.
    float profile(float y) {
      return pow(max(1.0 - pow(abs(y), uGemExponent), 0.0), 1.0 / uGemExponent);
    }

    // A concave four-sided double pyramid spinning about its vertical axis (think Sims plumbob,
    // minus the bobbing), seen from the side. Each pixel finds the front face of the square
    // cross-section at its height. The palette is wrapped around the gem as one surface, so it
    // travels right -> left as the gem turns; fixed lighting makes the faces catch the light.
    // Returns color, coverage in .a; f = shape value (< 1 inside) for the outer glow.
    vec4 rhombus(vec2 frag, out float f) {
      vec2 q = (frag - uRhombus.xy) / uRhombus.zw;   // GL coords: x right, y up
      float X = q.x, Y = q.y, ay = abs(Y);
      f = pow(abs(X) / uSilhouette, uGemExponent) + pow(ay, uGemExponent);
      if (ay >= 1.0) return vec4(0.0);
      float s = profile(Y);
      float edgePx = (s * uSilhouette - abs(X)) * uRhombus.z;
      float cover = clamp(edgePx + 0.5, 0.0, 1.0);
      if (cover <= 0.0) return vec4(0.0);

      // front face: the square's edge with the largest z at this x
      float xn = clamp(X / max(s, 1e-4), -uSilhouette, uSilhouette);
      float zf = -1.0;
      vec2 nh = vec2(sign(X), 0.0);
      float edgeDist = 1e3;
      for (int k = 0; k < 4; k++) {
        vec2 v0 = uCorner[k];
        vec2 v1 = uCorner[k + 1];
        if (v0.y > 0.0) edgeDist = min(edgeDist, abs(xn - v0.x));   // visible vertical edge
        float lo = min(v0.x, v1.x), hi = max(v0.x, v1.x);
        if (hi - lo > 1e-4 && xn >= lo && xn <= hi) {
          float z = mix(v0.y, v1.y, (xn - v0.x) / (v1.x - v0.x));
          if (z > zf) { zf = z; nh = (v0 + v1) * SQRT1_2; } // face normal: halfway between corners
        }
      }
      // round the faces a little so light glides across them instead of flicking on and off
      nh = normalize(mix(nh, normalize(vec2(xn, max(zf, 0.0)) + 1e-4), 0.5));

      // 3D normal: horizontal face normal plus the slope of the concave profile
      float yy = max(ay, 0.02);
      float slope = SQRT1_2 * pow(max(1.0 - pow(yy, uGemExponent), 1e-4), 1.0 / uGemExponent - 1.0)
                  * pow(yy, uGemExponent - 1.0);
      vec3 n = normalize(vec3(nh.x, slope * sign(Y), nh.y));

      // Palette wrapped around the gem. On top of turning with the gem it flows over the
      // surface on its own (right -> left, faster while dragged), ripples, and the bands arc
      // toward the tips.
      float around = (atan(max(zf, 0.0), xn) - uSpin) / TAU;
      float ripple = 0.06 * sin(uTime * 0.9 + Y * 3.0);
      float v = around - uGemTime * uGemFlow * 0.5 + uArc * Y * Y + ripple;
      vec3 c = gemStrip(v);

      // faint silky texture streaming through the gem
      float strands = noise(vec2(v * 40.0, Y * 4.0 - uGemTime * 0.8));
      c *= 0.92 + 0.16 * strands;

      // fixed light from the upper right, where the beams leave
      vec3 L = normalize(vec3(0.55, 0.45, 0.7));
      float diff = max(dot(n, L), 0.0);
      c *= 0.45 + 0.8 * diff;
      float spec = pow(max(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 60.0);
      c += vec3(1.0, 0.85, 0.6) * spec * 1.2;

      // a glint sweeping diagonally across the whole gem, right -> left, every few seconds
      float g = (X + Y * 0.45 - uSweep) / 0.14;
      c += vec3(1.0, 0.8, 0.55) * exp(-g * g) * (0.35 + 0.6 * diff);

      // bright edges: vertical edges facing us, the equator ridge, and the silhouette rim
      c += vec3(1.0, 0.75, 0.5) * exp(-pow(edgeDist * s * uRhombus.z / 4.0, 2.0)) * (0.25 + diff) * 0.25;
      c += vec3(1.0, 0.8, 0.6) * exp(-pow(Y * uRhombus.w / 3.0, 2.0)) * 0.15;
      c += vec3(1.0, 0.55, 0.2) * exp(-pow(edgePx / 2.0, 2.0)) * 0.4;
      return vec4(c, cover);
    }

    void main() {
      vec2 p = (gl_FragCoord.xy - uOrigin) / uScale;
      p.y = -p.y;                               // + angle = downward, like the 2D canvas
      float r = length(p);
      float th = atan(p.y, p.x);

      vec3 col = vec3(0.0);
      for (int i = 0; i < RIBBON_COUNT; i++) {
        vec4 motion = uMotion[i];               // angle, bend, width, sheen phase
        float intensity = uRibbon[i].x;
        float flowSpeed = uRibbon[i].y;
        float fringe = uRibbon[i].z;
        float fi = float(i);

        // distance across the ribbon; curvature grows with distance from the source
        float x = (th - motion.x - motion.y * r) / motion.z;

        // Skip pixels this ribbon can't reach. The bloom and the prism fringe extend well
        // past the core, so the cutoff has to cover them too or they end in a hard edge.
        float fringeSpread = 0.55 + 0.9 * min(r, 1.2);
        float xs = x * sign(fringe);
        bool inFringe = fringe != 0.0 && xs > 0.0 && xs < 2.6 * fringeSpread;
        if (x * x > 25.0 && !inFringe) continue;
        float core = exp(-x * x);

        // fine silky strands streaming outward
        float s1 = noise(vec2(th * 110.0 + fi * 17.0, r * 1.4 - uFlow * flowSpeed));
        float s2 = noise(vec2(th * 40.0 + fi * 7.0, r * 0.7 - uFlow * flowSpeed * 0.6));
        float s = 0.55 * s1 + 0.45 * s2;
        float strands = 0.45 + 0.85 * s * s;   // smooth veil with soft threads

        // brighter sheen travelling along the ribbon
        float pulse = pow(0.5 + 0.5 * sin((r * 1.6 - uFlow * flowSpeed * 0.55) * TAU + motion.w), 6.0);
        float energy = intensity * strands * (0.55 + 1.3 * pulse);

        // saturated warm body; tone mapping turns dense overlaps yellow -> white
        col += uRibbonColor[i] * core * energy;
        // crisp luminous filament through the ribbon
        col += vec3(1.0, 0.72, 0.4) * exp(-x * x * 30.0) * intensity * (0.35 + 0.9 * pulse) * (0.6 + 0.6 * s1);
        // faint deep-orange bloom around the ribbon
        col += vec3(1.0, 0.3, 0.05) * exp(-x * x * 0.12) * intensity * 0.018;

        // prism fringe: spectral bands stepping out from one edge, red -> violet,
        // tight near the source and spreading with distance
        if (inFringe) {
          vec3 rainbow = vec3(0.0);
          for (int k = 0; k < 6; k++) {
            float fk = float(k);
            float d = (xs - (0.75 + fk * 0.22) * fringeSpread) / (0.23 * fringeSpread);
            float weight = k == 2 ? 0.45 : 1.0;  // keep green subtle
            rainbow += spectrum(0.02 + fk * 0.148) * exp(-d * d) * weight;
          }
          col += rainbow * abs(fringe) * energy * 0.5 * uFringe;
        }
      }

      // whisper of warm haze inside the cone
      float haze = exp(-pow((th - 0.05 * uBeamSpread - uSway) / (0.6 * uBeamSpread), 2.0));
      col += vec3(1.0, 0.28, 0.03) * 0.03 * haze;

      // only in front of the source, fading with distance
      float front = smoothstep(-0.15, 0.4, p.x / max(r, 1e-4));
      col *= front / (1.0 + 0.45 * r);

      // the rhombus sits over the ribbons, with a soft orange glow around it
      float f;
      vec4 gem = rhombus(gl_FragCoord.xy, f);
      col += vec3(1.0, 0.32, 0.05) * 0.14 * exp(-max(f - 1.0, 0.0) * 5.0) * step(1.0, f);
      col = mix(col, gem.rgb, gem.a);

      // white-hot source: white core, yellow-orange halo
      col += vec3(1.0, 0.5, 0.14) * 0.03 / (r + 0.025) * exp(-r * 6.0);
      col += vec3(1.0, 0.9, 0.75) * 0.004 / (r * r * 40.0 + 0.004);

      // hue-preserving tone map keeps the orange orange; only very dense light
      // (the source, crossings) blows out to yellow-white
      col *= uBrightness;
      float peak = max(col.r, max(col.g, col.b));
      vec3 keepHue = col / max(peak, 1e-4) * (1.0 - exp(-peak));
      vec3 burn = 1.0 - exp(-col);
      col = mix(keepHue, burn, smoothstep(1.2, 4.5, peak));

      // film grain: speckled near-black background, subtle noise on the light
      float g = hash(gl_FragCoord.xy + uGrain);
      col += uBackground * (0.3 + 1.4 * g);
      col += (g - 0.5) * 0.07 * col;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
