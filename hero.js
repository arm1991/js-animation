/*
 * Prism hero — the "rhombus splitting light" artwork, animated.
 *
 * Two stacked canvases:
 *   .hero__gl  (WebGL) – silky light ribbons: fine strands that sway, curve and stream outward,
 *                        with iridescent fringes; drawn by the fragment shader in shader.js.
 *                        The rhombus is drawn here too: a gem spinning in place, its colors
 *                        travelling right -> left.
 *   .hero__fx  (2D)    – drifting sparkles; also receives the drag input for the rhombus.
 *
 * The ribbons always originate from the rhombus' right tip, and trail behind it while it moves.
 * If WebGL is unavailable the section falls back to the static artwork (see .hero--static).
 * Colors, shape, sizes and speeds live in `settings`, editable at runtime via Prism.hero.
 *
 * Loaded after constants.js (Prism.defaults), settings.js (Prism.controls) and shader.js.
 */
(() => {
  const section = document.querySelector('.hero');
  if (!section) return;

  const Prism = window.Prism || {};
  if (!Prism.defaults || !Prism.shaders) {
    console.warn('[hero] constants.js or shader.js is missing; using the static artwork.');
    section.classList.add('hero--static');
    return;
  }

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
  const narrowScreen = window.matchMedia('(max-width: 899px)'); // same breakpoint as styles.css
  const DEG = Math.PI / 180;
  const TAU = Math.PI * 2;
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // ≈ 2.4 rad: phases that never line up

  // ---------------------------------------------------------------------------
  // Settings — live-editable from the editor panel (editor.js), remembered per browser
  // ---------------------------------------------------------------------------

  const DEFAULTS = Object.freeze({ ...Prism.defaults });
  // v2 stores only changed values. The old key held full snapshots, which would keep masking
  // new defaults, so it is no longer read (it is left in place, not deleted).
  const STORAGE_KEY = 'prism-hero-settings-v2';

  // Allowed ranges from settings.js (optional: without it numbers are only checked for type).
  const RANGES = new Map((Prism.controls || []).flatMap((group) => group.controls).map((c) => [c.key, c]));

  // Returns a safe version of `value` for setting `key`, or undefined if it can't be used:
  // colors must be #rrggbb, numbers must be finite and are clamped to the editor's range.
  function sanitize(key, value) {
    if (!(key in DEFAULTS)) return undefined;
    if (typeof DEFAULTS[key] === 'string') {
      return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    const range = RANGES.get(key);
    return range ? Math.min(range.max, Math.max(range.min, value)) : value;
  }

  // Copies the usable entries of `patch` into `target`; returns the keys that were applied.
  function applyPatch(target, patch) {
    const applied = [];
    for (const [key, value] of Object.entries(patch)) {
      const safe = sanitize(key, value);
      if (safe === undefined) continue;
      target[key] = safe;
      applied.push(key);
    }
    return applied;
  }

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      const valid = {};
      if (saved && typeof saved === 'object') applyPatch(valid, saved);
      return valid;
    } catch {
      return {};
    }
  }

  let saveTimer = 0;

  // Sliders fire many input events per second; write to storage once they settle.
  function saveSettingsSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSettings, 250);
  }

  // Only values that differ from the defaults are stored, so later changes to constants.js
  // still reach browsers that have tweaked something in the editor.
  function saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    const changed = Object.fromEntries(Object.entries(settings).filter(([key, value]) => value !== DEFAULTS[key]));
    try {
      if (Object.keys(changed).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(changed));
      else localStorage.removeItem(STORAGE_KEY);
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
  //   angle:     degrees, 0 = right, + = down       swing: degrees of up/down sway
  //   speed:     swing speed                        width: degrees
  //   intensity: brightness of the ribbon           flow:  how fast strands stream outward
  //   fringe:    rainbow edge strength (+ below, - above, 0 = none)
  //   color:     which beam color setting the body uses
  // prettier-ignore
  const RIBBONS = [
    // angle swing speed width intensity flow  fringe  color
    [  -34,    6, 0.37,  1.6,     0.75,  0.9,  -1.0,  'beamMain'      ],
    [  -29,    7, 0.29,  3.2,     0.45,  1.1,   0.0,  'beamDeep'      ],
    [  -23,    8, 0.41,  1.2,     0.8,   0.8,   0.8,  'beamSecondary' ],
    [  -14,    6, 0.23,  2.4,     0.3,   1.2,   0.0,  'beamDeep'      ],
    [   -6,    7, 0.33,  1.4,     0.6,   0.9,  -0.7,  'beamMain'      ],
    [    0,    5, 0.27,  0.9,     0.85,  1.3,   0.0,  'beamCore'      ],
    [    6,    7, 0.19,  2.6,     0.55,  0.7,   0.9,  'beamMain'      ],
    [   13,    8, 0.31,  1.2,     0.5,   1.0,   0.0,  'beamSecondary' ],
    [   20,    6, 0.43,  2.0,     0.6,   1.4,   1.0,  'beamMain'      ],
    [   28,    7, 0.25,  1.3,     0.5,   0.8,  -0.8,  'beamDeep'      ],
    [   34,    6, 0.35,  2.4,     0.5,   1.2,   1.0,  'beamMain'      ],
    [   41,    6, 0.39,  1.5,     0.35,  0.7,   0.6,  'beamDeep'      ],
  ].map(([angle, swing, speed, width, intensity, flow, fringe, color]) =>
    ({ angle, swing, speed, width, intensity, flow, fringe, color }));
  const RIBBON_COUNT = RIBBONS.length;

  // Ribbon parameters scaled by the current settings (rebuilt when settings change).
  let ribbonPaths = []; // { angle, swing, speed, phase, width } in radians / per second
  const ribbonLook = new Float32Array(RIBBON_COUNT * 3); // uRibbon: intensity, flow speed, fringe
  const ribbonColor = new Float32Array(RIBBON_COUNT * 3); // uRibbonColor
  const ribbonMotion = new Float32Array(RIBBON_COUNT * 4); // uMotion, per frame: angle, bend, width, sheen phase

  function buildRibbons() {
    // beamSpread scales the whole fan vertically; widths follow more gently so a narrow
    // fan stays a bundle of distinct ribbons instead of one blob
    const spread = settings.beamSpread;
    const widthScale = Math.sqrt(spread);
    ribbonPaths = RIBBONS.map((ribbon, i) => {
      ribbonLook.set([ribbon.intensity, ribbon.flow, ribbon.fringe], i * 3);
      ribbonColor.set(hexToRgb(settings[ribbon.color]), i * 3);
      return {
        angle: ribbon.angle * spread * DEG,
        swing: ribbon.swing * settings.swingScale * spread * DEG,
        speed: ribbon.speed * settings.swingSpeed,
        phase: i * GOLDEN_ANGLE, // so no two ribbons move in sync
        width: ribbon.width * widthScale * DEG,
      };
    });
  }

  // Per-ribbon motion depends only on time, so it is computed once per frame here instead of
  // once per pixel in the shader.
  function animateRibbons() {
    const sway = (0.08 * Math.sin(t * 0.45) + 0.04 * Math.sin(t * 1.1 + 1.3)) * settings.beamSpread;
    const curl = settings.curl * settings.beamSpread;
    ribbonPaths.forEach(({ angle, swing, speed, phase, width }, i) => {
      ribbonMotion[i * 4] =
        angle + sway + swing * Math.sin(t * speed + phase) + 0.35 * swing * Math.sin(t * speed * 2.3 + phase * 2);
      ribbonMotion[i * 4 + 1] = bend + curl * Math.sin(t * speed * 0.6 + phase * 1.7);
      ribbonMotion[i * 4 + 2] = width * (1 + 0.3 * Math.sin(t * speed * 1.7 + phase * 3));
      ribbonMotion[i * 4 + 3] = phase * 4;
    });
    return sway;
  }

  // ---------------------------------------------------------------------------
  // WebGL
  // ---------------------------------------------------------------------------

  // Settings passed straight to the shader: uniform -> [setting, optional conversion].
  // Colors (hex strings) are uploaded as vec3, everything else as float.
  const SETTING_UNIFORMS = {
    uGemBody: ['gemBody'],
    uGemHighlight: ['gemHighlight'],
    uGemDeep: ['gemDeep'],
    uGemShadow: ['gemShadow'],
    uGemSpread: ['gemSpread'],
    uGemFlow: ['gemFlow'],
    uGemExponent: ['gemPinch', (pinch) => 1 - 0.6 * pinch],
    uBeamSpread: ['beamSpread'],
    uFringe: ['fringe'],
    uBrightness: ['brightness'],
    uBackground: ['background'],
  };

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || 'shader compile failed');
    }
    return shader;
  }

  let uniforms = {}; // uniform name -> location

  function initGL() {
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, Prism.shaders.vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, Prism.shaders.fragment(RIBBON_COUNT)));
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

    // look up every uniform the shader actually uses (arrays are reported as "name[0]")
    uniforms = {};
    for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
      const name = gl.getActiveUniform(program, i).name.replace(/\[0\]$/, '');
      uniforms[name] = gl.getUniformLocation(program, name);
    }
    uploadSettings();
  }

  // Push the current settings into the shader (called on init and whenever they change).
  function uploadSettings() {
    buildRibbons();
    gl.uniform3fv(uniforms.uRibbon, ribbonLook);
    gl.uniform3fv(uniforms.uRibbonColor, ribbonColor);
    for (const [name, [key, convert = (value) => value]] of Object.entries(SETTING_UNIFORMS)) {
      const value = convert(settings[key]);
      if (typeof value === 'string') gl.uniform3fv(uniforms[name], hexToRgb(value));
      else gl.uniform1f(uniforms[name], value);
    }
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

  // (Re)starts a sparkle at distance `r` from the source, somewhere inside a random ribbon.
  function spawnParticle(p, r) {
    const ribbon = RIBBONS[(Math.random() * RIBBON_COUNT) | 0];
    const angle = (ribbon.angle + (Math.random() - 0.5) * ribbon.width * 2) * settings.beamSpread * DEG;
    p.dx = Math.cos(angle); // direction never changes, so it's computed once here
    p.dy = Math.sin(angle);
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

  const GL_MAX_DPR = 1.5;
  const GL_MAX_PIXELS = 4e6; // about 2600 x 1500

  // Section size in CSS px (W, H) and pixel ratios of the 2D and GL canvases.
  let W = 0;
  let H = 0;
  let dpr = 1;
  let glDpr = 1;
  let particleReach = 0; // sparkles respawn once they're this far from the source
  let gemHalfW = 0;
  let gemHalfH = 0;
  const home = { x: 0, y: 0 }; // where the rhombus rests
  const pos = { x: 0, y: 0 }; // where it is now
  const vel = { x: 0, y: 0 }; // spring / throw velocity
  const motion = { x: 0, y: 0, vx: 0, vy: 0 }; // smoothed on-screen velocity
  let canvasRect = null; // canvas position on screen; cleared on resize and scroll
  let mode = 'idle'; // 'idle' | 'drag' | 'return'
  let drag = null;
  let t = 0; // animation time (s)
  let flow = 0; // beams' streaming time; runs faster while the rhombus moves
  let gemTime = 0; // the rhombus' own flow time, so the stream speed setting doesn't affect it
  let bend = 0; // how much the ribbons trail behind vertical motion
  let spin = 0; // rhombus rotation (rad)

  // Sizes everything to the section. Returns false (and does nothing) when the size and pixel
  // ratio haven't changed, unless `force` is set (e.g. after the GL context was restored).
  function layout(force = false) {
    const rect = section.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (!force && width === W && height === H && ratio === dpr) return false;
    W = width;
    H = height;
    dpr = ratio;
    canvasRect = null;
    // ribbons are soft, so the shader runs below full retina resolution and within a total
    // pixel budget (keeps 4K/5K screens from rendering 8M+ pixels per frame)
    glDpr = Math.min(dpr, GL_MAX_DPR, Math.sqrt(GL_MAX_PIXELS / (W * H)));

    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    glCanvas.width = Math.round(W * glDpr);
    glCanvas.height = Math.round(H * glDpr);
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);

    // narrow screens: the rhombus moves up-left, the copy sits at the bottom (see styles.css)
    const narrow = narrowScreen.matches;
    sizeRhombus();
    home.x = W * (narrow ? 0.3 : 0.46);
    home.y = H * (narrow ? 0.34 : 0.45);
    particleReach = Math.hypot(W, H) * 1.05;

    // keep the sparkles already on screen; only add or drop some to match the new area
    const count = Math.round(Math.min(260, (W * H) / 6000));
    if (particles.length > count) particles.length = count;
    while (particles.length < count) particles.push(spawnParticle({}, Math.random() * particleReach));

    if (mode === 'idle') {
      pos.x = home.x;
      pos.y = home.y;
    } else {
      clampToSection(pos);
    }
    motion.x = pos.x;
    motion.y = pos.y;
    return true;
  }

  function sizeRhombus() {
    gemHalfH = Math.max(34, Math.min(H * 0.088, W * 0.11)) * settings.gemSize;
    gemHalfW = gemHalfH * settings.gemWidth;
  }

  function clampToSection(p) {
    p.x = Math.min(W - gemHalfW, Math.max(gemHalfW, p.x));
    p.y = Math.min(H - gemHalfH, Math.max(gemHalfH, p.y));
    return p;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  // How wide the spinning rhombus looks, relative to its face-on half-width.
  const silhouette = () => Math.max(Math.abs(Math.cos(spin)), Math.abs(Math.sin(spin)));

  const corners = new Float32Array(5 * 2); // uCorner: the 4 corners, then the first one again

  function drawRibbons(ox, oy) {
    const sway = animateRibbons();
    for (let k = 0; k < 5; k++) {
      corners[k * 2] = Math.cos(spin + (k * Math.PI) / 2);
      corners[k * 2 + 1] = Math.sin(spin + (k * Math.PI) / 2);
    }

    gl.uniform4fv(uniforms.uMotion, ribbonMotion);
    gl.uniform2f(uniforms.uOrigin, ox * glDpr, (H - oy) * glDpr);
    gl.uniform1f(uniforms.uScale, H * glDpr);
    gl.uniform1f(uniforms.uTime, t);
    gl.uniform1f(uniforms.uFlow, flow);
    gl.uniform1f(uniforms.uGemTime, gemTime);
    gl.uniform1f(uniforms.uSway, sway);
    gl.uniform4f(uniforms.uRhombus, pos.x * glDpr, (H - pos.y) * glDpr, gemHalfW * glDpr, gemHalfH * glDpr);
    gl.uniform1f(uniforms.uSpin, spin);
    gl.uniform1f(uniforms.uSilhouette, silhouette());
    gl.uniform2fv(uniforms.uCorner, corners);
    gl.uniform1f(uniforms.uBreathe, Math.sin(t * 0.8));
    gl.uniform1f(uniforms.uArc, settings.gemCurve * (0.75 + 0.35 * Math.sin(t * 0.7)));
    gl.uniform1f(uniforms.uSweep, 1.6 - ((t * 0.17) % 1) * 3.6);
    gl.uniform1f(uniforms.uGrain, ((t * 7) % 1) * 91);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function drawParticles(ox, oy) {
    ctx.fillStyle = 'rgb(255,210,160)';
    for (const p of particles) {
      const x = ox + p.dx * p.r;
      const y = oy + p.dy * p.r;
      if (x < -2 || y < -2 || x > W + 2 || y > H + 2) continue;
      ctx.globalAlpha = p.alpha * (0.5 + 0.5 * Math.sin(t * p.freq + p.phase));
      ctx.fillRect(x, y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function render() {
    // ribbons leave from the right tip, which moves in and out as the gem turns
    const ox = pos.x + gemHalfW * silhouette() * 0.98;
    const oy = pos.y;

    drawRibbons(ox, oy);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawParticles(ox, oy);
  }

  // ---------------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------------

  const GEM_FLOW_RATE = 0.6; // the rhombus gradient's base pace (its speed is set by gemFlow)
  const SPRING_K = 140; // stiffness
  const SPRING_C = 2 * Math.sqrt(SPRING_K) * 0.62; // < critical → small overshoot

  function update(dt, animDt) {
    for (const p of particles) {
      p.r += p.speed * animDt;
      if (p.r > particleReach) spawnParticle(p, Math.random() * 20);
    }

    if (mode === 'idle') {
      pos.x = home.x;
      pos.y = home.y;
    } else if (mode === 'return') {
      // semi-implicit Euler in small substeps for stability
      const steps = 4;
      const h = dt / steps;
      for (let s = 0; s < steps; s++) {
        vel.x += (SPRING_K * (home.x - pos.x) - SPRING_C * vel.x) * h;
        vel.y += (SPRING_K * (home.y - pos.y) - SPRING_C * vel.y) * h;
        pos.x += vel.x * h;
        pos.y += vel.y * h;
      }
      if (Math.hypot(home.x - pos.x, home.y - pos.y) < 0.5 && Math.hypot(vel.x, vel.y) < 8) {
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
    gemTime += animDt * (GEM_FLOW_RATE + Math.min(1.5, speed));
    spin += animDt * settings.spinSpeed * (1 + Math.min(3, speed * 1.5)); // turns faster while dragged
  }

  let raf = 0;
  let last = 0;
  let running = false;
  let onScreen = false;
  let contextLost = false;

  // With reduced motion nothing moves on its own, so once the rhombus is at rest (and the
  // ribbons have stopped trailing it) the loop stops; updateRunning() draws a single frame
  // whenever something changes.
  const atRest = () => reduceMotion.matches && mode === 'idle' && Math.abs(bend) < 1e-3;

  function frame(now) {
    const dt = Math.min(0.033, Math.max(0, (now - last) / 1000));
    last = now;
    const animDt = reduceMotion.matches ? 0 : dt;
    t += animDt;
    update(dt, animDt);
    render();
    if (atRest()) running = false;
    else raf = requestAnimationFrame(frame);
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

  // Animate only while the hero is visible and the GL context is usable. Also call this after
  // anything changes, so a stopped (reduced-motion) loop draws the new state.
  function updateRunning() {
    if (onScreen && !contextLost) start();
    else stop();
  }

  // ---------------------------------------------------------------------------
  // Drag & drop
  // ---------------------------------------------------------------------------

  // The canvas position is cached (canvasRect): reading it on every pointermove can force a
  // layout, and it only changes when the page scrolls or the section resizes.
  window.addEventListener('scroll', () => (canvasRect = null), { passive: true });

  // Pointer or touch position relative to the canvas, in CSS px.
  function localPoint(e) {
    if (!canvasRect) canvasRect = canvas.getBoundingClientRect();
    return { x: e.clientX - canvasRect.left, y: e.clientY - canvasRect.top };
  }

  let cursor = '';
  function setCursor(value) {
    if (value === cursor) return; // pointermove fires a lot; skip redundant style writes
    cursor = value;
    canvas.style.cursor = value;
  }

  function hitRhombus(p) {
    const pad = 1.15; // slightly generous hit area
    return Math.abs(p.x - pos.x) / (gemHalfW * pad) + Math.abs(p.y - pos.y) / (gemHalfH * pad) <= 1;
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
    updateRunning();
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = localPoint(e);
    if (!drag) {
      setCursor(hitRhombus(p) ? 'grab' : '');
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
    setCursor(hitRhombus(localPoint(e)) ? 'grab' : '');
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  // On touch, block page scrolling only when the gesture starts on the rhombus.
  canvas.addEventListener(
    'touchstart',
    (e) => {
      const touch = e.touches[0];
      if (touch && hitRhombus(localPoint(touch))) e.preventDefault();
    },
    { passive: false },
  );

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  glCanvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault(); // allow the browser to restore the context later
    contextLost = true;
    updateRunning();
  });
  glCanvas.addEventListener('webglcontextrestored', () => {
    try {
      initGL();
    } catch (err) {
      console.warn('[hero] WebGL could not be restored, using static artwork:', err);
      section.classList.add('hero--static');
      return;
    }
    contextLost = false;
    layout(true);
    render();
    updateRunning();
  });

  // Called after settings change: push them to the shader and update what depends on them.
  function settingsChanged(keys) {
    uploadSettings();
    sizeRhombus();
    if (mode !== 'idle') clampToSection(pos);
    // sparkles follow the beam fan, so re-aim them when its height changes
    if (keys.includes('beamSpread')) for (const p of particles) spawnParticle(p, p.r);
    updateRunning();
  }

  // Editor API (see editor.js)
  Prism.hero = {
    defaults: DEFAULTS,
    get: () => ({ ...settings }),
    set(patch) {
      const applied = applyPatch(settings, patch);
      if (!applied.length) return;
      settingsChanged(applied);
      saveSettingsSoon();
    },
    reset() {
      Object.assign(settings, DEFAULTS);
      settingsChanged(Object.keys(DEFAULTS));
      saveSettings(); // nothing differs from the defaults now, so this clears storage
    },
  };

  // don't lose a pending save when the page goes away
  window.addEventListener('pagehide', () => saveTimer && saveSettings());

  layout();
  render();

  new ResizeObserver(() => {
    if (layout()) render();
  }).observe(section);

  // Calls `handler` when a media query starts or stops matching. Safari < 14 only has the
  // older addListener API.
  function onMediaChange(query, handler) {
    if (query.addEventListener) query.addEventListener('change', handler);
    else query.addListener(handler);
  }

  // Moving the window to a screen with another pixel ratio doesn't resize the section,
  // so watch the ratio itself (the query only matches the current ratio, so re-arm it).
  function watchPixelRatio() {
    const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const handler = () => {
      if (query.removeEventListener) query.removeEventListener('change', handler);
      else query.removeListener(handler);
      if (layout()) render();
      watchPixelRatio();
    };
    onMediaChange(query, handler);
  }
  watchPixelRatio();

  onMediaChange(reduceMotion, updateRunning);

  // only animate while the hero is on screen
  new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    updateRunning();
  }).observe(section);
})();
