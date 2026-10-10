/*
 * Prism hero — the "rhombus splitting light" artwork, animated.
 *
 * Two stacked canvases:
 *   .hero__gl  (WebGL) – silky light ribbons: fine strands that sway, curve and stream outward,
 *                        with iridescent fringes; drawn by a fragment shader.
 *                        The rhombus is drawn here too: a gem spinning in place, its colors
 *                        travelling right -> left.
 *   .hero__fx  (2D)    – drifting sparkles; also receives the drag input for the rhombus.
 *
 * The ribbons always originate from the rhombus' right tip, and trail behind it while it moves.
 * If WebGL is unavailable the section falls back to the static artwork (see .hero--static).
 * Colors, shape, sizes and speeds live in `settings`, editable at runtime via window.prismHero.
 */
(() => {
  const section = document.querySelector('.hero');
  if (!section) return;

  const glCanvas = section.querySelector('.hero__gl');
  const canvas = section.querySelector('.hero__fx');
  const ctx = canvas.getContext('2d');
  const gl = glCanvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    powerPreference: 'high-performance',
  });
  if (!ctx || !gl) {
    section.classList.add('hero--static');
    return;
  }

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const DEG = Math.PI / 180;
  const TAU = Math.PI * 2;

  // ---------------------------------------------------------------------------
  // Settings — live-editable from the editor panel (editor.js), remembered per browser
  // ---------------------------------------------------------------------------

  // Defaults live in constants.js (loaded before this file).
  if (!window.PRISM_DEFAULTS) {
    console.warn('[hero] constants.js is missing; using the static artwork.');
    section.classList.add('hero--static');
    return;
  }
  const DEFAULTS = Object.freeze({ ...window.PRISM_DEFAULTS });

  const STORAGE_KEY = 'prism-hero-settings';

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      // keep only known keys with the right type
      return Object.fromEntries(
        Object.entries(saved).filter(([k, v]) => k in DEFAULTS && typeof v === typeof DEFAULTS[k]),
      );
    } catch {
      return {};
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // storage unavailable (private mode etc.) — settings just won't persist
    }
  }

  const settings = { ...DEFAULTS, ...loadSettings() };

  const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

  // ---------------------------------------------------------------------------
  // Ribbons
  // ---------------------------------------------------------------------------

  // Ribbon bodies are all warm; the rainbow only appears as prism fringes on their edges.
  // Colors refer to the beam settings: main / secondary / deep / core.
  const BEAM_COLOR = { main: 'beamMain', secondary: 'beamSecondary', deep: 'beamDeep', core: 'beamCore' };

  // angle° (0 = right, + = down), swing°, swing speed, width°, intensity, flow speed,
  // fringe (rainbow edge strength; sign picks the side: + below, - above), body color
  const RIBBON_DEFS = [
    [-34, 6, 0.37, 1.6, 0.75, 0.9, -1.0, 'main'],
    [-29, 7, 0.29, 3.2, 0.45, 1.1, 0.0, 'deep'],
    [-23, 8, 0.41, 1.2, 0.8, 0.8, 0.8, 'secondary'],
    [-14, 6, 0.23, 2.4, 0.3, 1.2, 0.0, 'deep'],
    [-6, 7, 0.33, 1.4, 0.6, 0.9, -0.7, 'main'],
    [0, 5, 0.27, 0.9, 0.85, 1.3, 0.0, 'core'],
    [6, 7, 0.19, 2.6, 0.55, 0.7, 0.9, 'main'],
    [13, 8, 0.31, 1.2, 0.5, 1.0, 0.0, 'secondary'],
    [20, 6, 0.43, 2.0, 0.6, 1.4, 1.0, 'main'],
    [28, 7, 0.25, 1.3, 0.5, 0.8, -0.8, 'deep'],
    [34, 6, 0.35, 2.4, 0.5, 1.2, 1.0, 'main'],
    [41, 6, 0.39, 1.5, 0.35, 0.7, 0.6, 'deep'],
  ];
  const K = RIBBON_DEFS.length;

  const uA = new Float32Array(K * 4); // base angle, swing, swing speed, phase
  const uB = new Float32Array(K * 4); // width, intensity, flow speed, fringe
  const uC = new Float32Array(K * 3); // color
  RIBBON_DEFS.forEach(([, , , w, i, fl, fr], k) => uB.set([w * DEG, i, fl, fr], k * 4));

  function buildRibbons() {
    RIBBON_DEFS.forEach(([a, sw, sp, , , , , color], k) => {
      // golden-angle phases so no two ribbons move in sync
      uA.set([a * DEG, sw * settings.swingScale * DEG, sp * settings.swingSpeed, k * 2.39996], k * 4);
      uC.set(hexToRgb(settings[BEAM_COLOR[color]]), k * 3);
    });
  }

  const VERT = `
    attribute vec2 aPos;
    void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
  `;

  const FRAG = `
    precision highp float;
    #define K ${K}
    uniform vec2 uOrigin;   // ribbon source, buffer px (GL coords)
    uniform float uScale;   // buffer px per unit (= section height)
    uniform float uTime;    // slow time: sway
    uniform float uFlow;    // flow time: streaming strands (speeds up while dragging)
    uniform float uBend;    // extra curvature from rhombus motion (trailing)
    uniform float uCurl;    // base curvature amplitude
    uniform vec4 uRhombus;  // rhombus center (buffer px, GL coords), half-width, half-height (px)
    uniform float uSpin;    // rhombus rotation about its vertical axis (radians)
    uniform float uGemP;    // outline exponent: 1 = straight sides, lower = sides curve in
    uniform float uCurve;   // how much the bands inside the rhombus arc
    uniform float uGemFlow; // how fast the rhombus gradient flows on its own
    uniform vec3 uGemBody, uGemHi, uGemDeep, uGemShadow;
    uniform float uGemSpread; // warm red -> yellow spread inside the rhombus
    uniform float uFringe;  // rainbow edges on the beams
    uniform float uExposure;
    uniform vec3 uBg;       // background color (average, before grain)
    uniform vec4 uA[K];
    uniform vec4 uB[K];
    uniform vec3 uC[K];

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

    // The ribbons' palette laid out as one repeating strip: deep ember, orange body,
    // white-hot filament and a prism fringe (red -> violet) on its leading edge.
    vec3 gemStrip(float v) {
      // wide, soft bands that blend into each other (few per gem, like the reference)
      vec3 c = uGemShadow;                                             // shadow base
      float breathe = sin(uTime * 0.8);
      c += uGemBody * band(v, 0.52, 0.16 + 0.03 * breathe) * 1.15;     // body
      c += uGemDeep * band(v, 0.9, 0.12) * 0.6;                        // second, deeper band
      c += uGemHi * band(v, 0.36, 0.06) * 1.3;                         // soft highlight
      for (int k = 0; k < 4; k++) {                                    // broad warm spread:
        float fk = float(k);                                           // red -> amber -> yellow
        c += spectrum(fk * 0.05) * band(v, 0.3 - fk * 0.05, 0.035) * 0.55 * uGemSpread;
      }
      return c;
    }

    // Half-extent of the gem's cross-section at height y: the concave outline, 1 at the equator.
    float profile(float y) {
      return pow(max(1.0 - pow(abs(y), uGemP), 0.0), 1.0 / uGemP);
    }

    // A concave four-sided double pyramid spinning about its vertical axis (think Sims plumbob,
    // minus the bobbing), seen from the side. Each pixel finds the front face of the square
    // cross-section at its height. The ribbon palette is wrapped around the gem as one surface,
    // so it travels right -> left as the gem turns; fixed lighting makes the faces catch the light.
    // Returns color, coverage in .a; f = shape value (< 1 inside) for the outer glow.
    vec4 rhombus(vec2 frag, out float f) {
      vec2 q = (frag - uRhombus.xy) / uRhombus.zw;   // GL coords: x right, y up
      float X = q.x, Y = q.y, ay = abs(Y);
      float m = max(abs(cos(uSpin)), abs(sin(uSpin))); // silhouette width as it turns
      f = pow(abs(X) / m, uGemP) + pow(ay, uGemP);
      if (ay >= 1.0) return vec4(0.0);
      float s = profile(Y);
      float edgePx = (s * m - abs(X)) * uRhombus.z;
      float cover = clamp(edgePx + 0.5, 0.0, 1.0);
      if (cover <= 0.0) return vec4(0.0);

      // front face: the square's edge with the largest z at this x
      float xn = clamp(X / max(s, 1e-4), -m, m);
      float zf = -1.0;
      vec2 nh = vec2(sign(X), 0.0);
      float edgeDist = 1e3;
      for (int k = 0; k < 4; k++) {
        float a0 = uSpin + float(k) * 1.5708;
        vec2 v0 = vec2(cos(a0), sin(a0));
        vec2 v1 = vec2(cos(a0 + 1.5708), sin(a0 + 1.5708));
        if (v0.y > 0.0) edgeDist = min(edgeDist, abs(xn - v0.x));   // visible vertical edge
        float lo = min(v0.x, v1.x), hi = max(v0.x, v1.x);
        if (hi - lo > 1e-4 && xn >= lo && xn <= hi) {
          float z = mix(v0.y, v1.y, (xn - v0.x) / (v1.x - v0.x));
          if (z > zf) { zf = z; nh = vec2(cos(a0 + 0.7854), sin(a0 + 0.7854)); }
        }
      }
      // round the faces a little so light glides across them instead of flicking on and off
      nh = normalize(mix(nh, normalize(vec2(xn, max(zf, 0.0)) + 1e-4), 0.5));

      // 3D normal: horizontal face normal plus the slope of the concave profile
      float yy = max(ay, 0.02);
      float slope = 0.7071 * pow(max(1.0 - pow(yy, uGemP), 1e-4), 1.0 / uGemP - 1.0) * pow(yy, uGemP - 1.0);
      vec3 n = normalize(vec3(nh.x, slope * sign(Y), nh.y));

      // Palette wrapped around the gem. On top of turning with the gem it flows over the
      // surface on its own (right -> left, faster while dragged), ripples, and the bands arc
      // toward the tips.
      float around = (atan(max(zf, 0.0), xn) - uSpin) / 6.2831;
      float arc = uCurve * (0.75 + 0.35 * sin(uTime * 0.7));
      float ripple = 0.06 * sin(uTime * 0.9 + Y * 3.0);
      float v = around - uFlow * uGemFlow * 0.5 + arc * Y * Y + ripple;
      vec3 c = gemStrip(v);

      // faint silky texture streaming through the gem
      float strands = noise(vec2(v * 40.0, Y * 4.0 - uFlow * 0.8));
      c *= 0.92 + 0.16 * strands;

      // fixed light from the upper right, where the beams leave
      vec3 L = normalize(vec3(0.55, 0.45, 0.7));
      float diff = max(dot(n, L), 0.0);
      c *= 0.45 + 0.8 * diff;
      float spec = pow(max(dot(n, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), 60.0);
      c += vec3(1.0, 0.85, 0.6) * spec * 1.2;

      // a glint sweeping diagonally across the whole gem, right -> left, every few seconds
      float sweep = 1.6 - fract(uTime * 0.17) * 3.6;
      float g = (X + Y * 0.45 - sweep) / 0.14;
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
      float t = uTime;

      // the whole fan breathes up and down
      float sway = 0.08 * sin(t * 0.45) + 0.04 * sin(t * 1.1 + 1.3);

      vec3 col = vec3(0.0);
      for (int i = 0; i < K; i++) {
        vec4 a = uA[i];
        vec4 b = uB[i];
        float fi = float(i);

        float ang = a.x + sway
                  + a.y * sin(t * a.z + a.w)
                  + 0.35 * a.y * sin(t * a.z * 2.3 + a.w * 2.0);
        // curvature grows with distance -> ribbons arc like the reference
        float bend = uBend + uCurl * sin(t * a.z * 0.6 + a.w * 1.7);
        float w = b.x * (1.0 + 0.3 * sin(t * a.z * 1.7 + a.w * 3.0));
        float x = (th - ang - bend * r) / w;
        float core = exp(-x * x);
        if (core < 0.003) continue;

        // fine silky strands streaming outward
        float s1 = noise(vec2(th * 110.0 + fi * 17.0, r * 1.4 - uFlow * b.z));
        float s2 = noise(vec2(th * 40.0 + fi * 7.0, r * 0.7 - uFlow * b.z * 0.6));
        float s = 0.55 * s1 + 0.45 * s2;
        float strands = 0.45 + 0.85 * s * s;   // smooth veil with soft threads

        // brighter sheen travelling along the ribbon
        float pulse = pow(0.5 + 0.5 * sin((r * 1.6 - uFlow * b.z * 0.55) * 6.2831 + a.w * 4.0), 6.0);
        float energy = b.y * strands * (0.55 + 1.3 * pulse);

        // saturated warm body; tone mapping turns dense overlaps yellow -> white
        col += uC[i] * core * energy;
        // crisp luminous filament through the ribbon
        col += vec3(1.0, 0.72, 0.4) * exp(-x * x * 30.0) * b.y * (0.35 + 0.9 * pulse) * (0.6 + 0.6 * s1);
        // faint deep-orange bloom around the ribbon
        col += vec3(1.0, 0.3, 0.05) * exp(-x * x * 0.12) * b.y * 0.018;

        // prism fringe: spectral bands stepping out from one edge, red -> violet,
        // tight near the source and spreading with distance
        float fr = b.w;
        if (fr != 0.0) {
          float xs = x * sign(fr);
          float spread = 0.55 + 0.9 * min(r, 1.2);
          vec3 rainbow = vec3(0.0);
          for (int k = 0; k < 6; k++) {
            float fk = float(k);
            float d = (xs - (0.75 + fk * 0.22) * spread) / (0.23 * spread);
            float wgt = k == 2 ? 0.45 : 1.0;  // keep green subtle, like the references
            rainbow += spectrum(0.02 + fk * 0.148) * exp(-d * d) * wgt;
          }
          col += rainbow * abs(fr) * energy * 0.5 * uFringe;
        }
      }

      // whisper of warm haze inside the cone
      float haze = exp(-pow((th - 0.05 - sway) / 0.6, 2.0));
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
      col *= uExposure;
      float peak = max(col.r, max(col.g, col.b));
      vec3 keepHue = col / max(peak, 1e-4) * (1.0 - exp(-peak));
      vec3 burn = 1.0 - exp(-col);
      col = mix(keepHue, burn, smoothstep(1.2, 4.5, peak));

      // film grain: speckled near-black background, subtle noise on the light
      float g = hash(gl_FragCoord.xy + fract(t * 7.0) * 91.0);
      col += uBg * (0.3 + 1.4 * g);
      col += (g - 0.5) * 0.07 * col;
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s) || 'shader compile failed');
    }
    return s;
  }

  let program = null;
  let loc = null;

  function initGL() {
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'program link failed');
    }
    gl.useProgram(program);

    // one oversized triangle covering the viewport
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    loc = {};
    for (const name of [
      'uOrigin', 'uScale', 'uTime', 'uFlow', 'uBend', 'uCurl', 'uA', 'uB', 'uC', 'uRhombus', 'uSpin',
      'uGemP', 'uCurve', 'uGemFlow', 'uGemBody', 'uGemHi', 'uGemDeep', 'uGemShadow', 'uGemSpread',
      'uFringe', 'uExposure', 'uBg',
    ]) {
      loc[name] = gl.getUniformLocation(program, name);
    }
    gl.uniform4fv(loc.uB, uB);
    uploadSettings();
  }

  // Push the current settings into the shader (called on init and whenever they change).
  function uploadSettings() {
    buildRibbons();
    gl.uniform4fv(loc.uA, uA);
    gl.uniform3fv(loc.uC, uC);
    gl.uniform1f(loc.uCurl, settings.curl);
    gl.uniform1f(loc.uGemP, 1 - 0.6 * settings.gemPinch);
    gl.uniform1f(loc.uCurve, settings.gemCurve);
    gl.uniform1f(loc.uGemFlow, settings.gemFlow);
    gl.uniform3fv(loc.uGemBody, hexToRgb(settings.gemBody));
    gl.uniform3fv(loc.uGemHi, hexToRgb(settings.gemHighlight));
    gl.uniform3fv(loc.uGemDeep, hexToRgb(settings.gemDeep));
    gl.uniform3fv(loc.uGemShadow, hexToRgb(settings.gemShadow));
    gl.uniform1f(loc.uGemSpread, settings.gemSpread);
    gl.uniform1f(loc.uFringe, settings.fringe);
    gl.uniform1f(loc.uExposure, settings.brightness);
    gl.uniform3fv(loc.uBg, hexToRgb(settings.background));
  }

  try {
    initGL();
  } catch (err) {
    console.warn('[hero] WebGL unavailable, using static artwork:', err);
    section.classList.add('hero--static');
    return;
  }

  // ---------------------------------------------------------------------------
  // Sparkles (2D)
  // ---------------------------------------------------------------------------

  let particles = [];
  function spawnParticle(p, r) {
    const def = RIBBON_DEFS[(Math.random() * K) | 0];
    p.a = (def[0] + (Math.random() - 0.5) * def[3] * 2) * DEG;
    p.r = r;
    p.speed = 20 + Math.random() * 70;
    p.size = 0.6 + Math.random() * 1.1;
    p.alpha = 0.2 + Math.random() * 0.5;
    p.freq = 1 + Math.random() * 3;
    p.phase = Math.random() * TAU;
    return p;
  }

  // ---------------------------------------------------------------------------
  // Layout & state
  // ---------------------------------------------------------------------------

  let W = 0, H = 0, dpr = 1, glDpr = 1, R = 0;
  let rw = 0, rh = 0; // rhombus half-width / half-height
  const home = { x: 0, y: 0 };
  const pos = { x: 0, y: 0 };
  const vel = { x: 0, y: 0 }; // spring velocity
  const motion = { x: pos.x, y: pos.y, vx: 0, vy: 0 }; // smoothed on-screen velocity
  let mode = 'idle'; // 'idle' | 'drag' | 'return'
  let drag = null;
  let t = 0;
  let flow = 0;
  let bend = 0;
  let spin = 0;


  function layout() {
    const rect = section.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width));
    H = Math.max(1, Math.round(rect.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    glDpr = Math.min(dpr, 1.5); // ribbons are soft; no need for full retina fill-rate

    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    glCanvas.width = Math.round(W * glDpr);
    glCanvas.height = Math.round(H * glDpr);
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);

    const narrow = W < 900;
    sizeRhombus();
    home.x = W * (narrow ? 0.3 : 0.46);
    home.y = H * (narrow ? 0.34 : 0.45);
    R = Math.hypot(W, H) * 1.05;

    const count = Math.round(Math.min(260, (W * H) / 6000));
    particles = Array.from({ length: count }, () => spawnParticle({}, Math.random() * R));

    if (mode === 'idle') {
      pos.x = home.x;
      pos.y = home.y;
    } else {
      clampToSection(pos);
    }
    motion.x = pos.x;
    motion.y = pos.y;
  }

  function sizeRhombus() {
    rh = Math.max(34, Math.min(H * 0.088, W * 0.11)) * settings.gemSize;
    rw = rh * settings.gemWidth;
  }

  function clampToSection(p) {
    p.x = Math.min(W - rw, Math.max(rw, p.x));
    p.y = Math.min(H - rh, Math.max(rh, p.y));
    return p;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  function drawRibbons(ox, oy) {
    gl.uniform2f(loc.uOrigin, ox * glDpr, (H - oy) * glDpr);
    gl.uniform1f(loc.uScale, H * glDpr);
    gl.uniform1f(loc.uTime, t);
    gl.uniform1f(loc.uFlow, flow);
    gl.uniform1f(loc.uBend, bend);
    gl.uniform4f(loc.uRhombus, pos.x * glDpr, (H - pos.y) * glDpr, rw * glDpr, rh * glDpr);
    gl.uniform1f(loc.uSpin, spin);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function drawParticles(ox, oy) {
    ctx.fillStyle = 'rgb(255,210,160)';
    for (const p of particles) {
      const x = ox + Math.cos(p.a) * p.r;
      const y = oy + Math.sin(p.a) * p.r;
      if (x < -2 || y < -2 || x > W + 2 || y > H + 2) continue;
      ctx.globalAlpha = p.alpha * (0.5 + 0.5 * Math.sin(t * p.freq + p.phase));
      ctx.fillRect(x, y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    // ribbons leave from the right tip, which moves in and out as the gem turns
    const ox = pos.x + rw * Math.max(Math.abs(Math.cos(spin)), Math.abs(Math.sin(spin))) * 0.98;
    const oy = pos.y;

    drawRibbons(ox, oy);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawParticles(ox, oy);
  }

  // ---------------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------------

  const SPRING_K = 140; // stiffness
  const SPRING_C = 2 * Math.sqrt(SPRING_K) * 0.62; // < critical → small overshoot

  function update(dt, animDt) {
    for (const p of particles) {
      p.r += p.speed * animDt;
      if (p.r > R) spawnParticle(p, Math.random() * 20);
    }

    if (mode === 'idle') {
      pos.x = home.x;
      pos.y = home.y;
    } else if (mode === 'return') {
      const tx = home.x;
      const ty = home.y;
      // semi-implicit Euler in small substeps for stability
      const steps = 4;
      const h = dt / steps;
      for (let s = 0; s < steps; s++) {
        vel.x += (SPRING_K * (tx - pos.x) - SPRING_C * vel.x) * h;
        vel.y += (SPRING_K * (ty - pos.y) - SPRING_C * vel.y) * h;
        pos.x += vel.x * h;
        pos.y += vel.y * h;
      }
      if (Math.hypot(tx - pos.x, ty - pos.y) < 0.5 && Math.hypot(vel.x, vel.y) < 8) {
        mode = 'idle';
      }
    }

    // Ribbons react to how the rhombus moves: vertical motion makes them trail (bend),
    // any fast motion makes the strands stream faster.
    if (dt > 0) {
      const k = Math.min(1, dt * 8);
      motion.vx += ((pos.x - motion.x) / dt - motion.vx) * k;
      motion.vy += ((pos.y - motion.y) / dt - motion.vy) * k;
      motion.x = pos.x;
      motion.y = pos.y;
    }
    const targetBend = Math.max(-0.9, Math.min(0.9, (-motion.vy / H) * 0.45));
    bend += (targetBend - bend) * Math.min(1, dt * 5);
    const speed = Math.hypot(motion.vx, motion.vy) / H;
    flow += animDt * (settings.flowSpeed + Math.min(1.5, speed));
    spin += animDt * settings.spinSpeed * (1 + Math.min(3, speed * 1.5)); // turns faster while dragged
  }

  let raf = 0;
  let last = 0;
  let running = false;

  function frame(now) {
    const dt = Math.min(0.033, Math.max(0, (now - last) / 1000));
    last = now;
    const animDt = reduceMotion.matches ? 0 : dt;
    t += animDt;
    update(dt, animDt);
    render();
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  // ---------------------------------------------------------------------------
  // Drag & drop
  // ---------------------------------------------------------------------------

  function localPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function hitRhombus(p) {
    const pad = 1.15; // slightly generous hit area
    return Math.abs(p.x - pos.x) / (rw * pad) + Math.abs(p.y - pos.y) / (rh * pad) <= 1;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const p = localPoint(e);
    if (!hitRhombus(p)) return;
    e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // pointer already gone; dragging still works while it stays over the canvas
    }
    drag = { id: e.pointerId, dx: p.x - pos.x, dy: p.y - pos.y, lastX: pos.x, lastY: pos.y, lastT: e.timeStamp };
    mode = 'drag';
    vel.x = vel.y = 0;
    section.classList.add('is-dragging');
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = localPoint(e);
    if (!drag) {
      canvas.style.cursor = hitRhombus(p) ? 'grab' : '';
      return;
    }
    if (e.pointerId !== drag.id) return;

    clampToSection(Object.assign(pos, { x: p.x - drag.dx, y: p.y - drag.dy }));

    // track release velocity so the spring-back carries the throw
    const elapsed = (e.timeStamp - drag.lastT) / 1000;
    if (elapsed > 0.001) {
      vel.x = vel.x * 0.6 + ((pos.x - drag.lastX) / elapsed) * 0.4;
      vel.y = vel.y * 0.6 + ((pos.y - drag.lastY) / elapsed) * 0.4;
      drag.lastX = pos.x;
      drag.lastY = pos.y;
      drag.lastT = e.timeStamp;
    }
  });

  function release(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    // a pause before letting go means no throw
    if (e.timeStamp - drag.lastT > 80) vel.x = vel.y = 0;
    drag = null;
    mode = 'return';
    section.classList.remove('is-dragging');
    canvas.style.cursor = hitRhombus(localPoint(e)) ? 'grab' : '';
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  // On touch, block page scrolling only when the gesture starts on the rhombus.
  canvas.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    if (touch && hitRhombus(localPoint(touch))) e.preventDefault();
  }, { passive: false });

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  glCanvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    stop();
  });
  glCanvas.addEventListener('webglcontextrestored', () => {
    initGL();
    layout();
    start();
  });

  // Editor API (see editor.js)
  window.prismHero = {
    defaults: DEFAULTS,
    get: () => ({ ...settings }),
    set(patch) {
      for (const [k, v] of Object.entries(patch)) {
        if (k in DEFAULTS && typeof v === typeof DEFAULTS[k]) settings[k] = v;
      }
      uploadSettings();
      sizeRhombus();
      if (mode === 'drag') clampToSection(pos);
      saveSettings();
    },
    reset() {
      Object.assign(settings, DEFAULTS);
      uploadSettings();
      sizeRhombus();
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // nothing stored
      }
    },
  };

  layout();
  render();

  new ResizeObserver(() => {
    layout();
    render();
  }).observe(section);

  // only animate while the hero is on screen
  new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) start();
    else stop();
  }).observe(section);
})();
