/*
 * Hero editor — a small panel (toggle in the top-left corner) for live-tuning the
 * prism hero: colors, rhombus shape and size, and motion. Talks to window.prismHero
 * (defined in hero.js); changes apply instantly and are remembered in this browser.
 */
(() => {
  const hero = window.prismHero;
  const section = document.querySelector('.hero');
  if (!hero || !section) return; // static fallback: nothing to edit

  const pct = (v) => `${Math.round(v * 100)}%`;
  const num = (v) => v.toFixed(2);

  const SECTIONS = [
    {
      title: 'Rhombus shape',
      open: true,
      controls: [
        { key: 'gemSize', label: 'Size', min: 0.5, max: 2, step: 0.05, format: pct },
        { key: 'gemWidth', label: 'Width', min: 0.4, max: 1.2, step: 0.01, format: pct },
        { key: 'gemPinch', label: 'Side curve', min: 0, max: 0.9, step: 0.01, format: pct },
      ],
    },
    {
      title: 'Rhombus colors',
      open: true,
      controls: [
        { key: 'gemBody', label: 'Body', type: 'color' },
        { key: 'gemHighlight', label: 'Highlight', type: 'color' },
        { key: 'gemDeep', label: 'Deep band', type: 'color' },
        { key: 'gemShadow', label: 'Shadow', type: 'color' },
        { key: 'gemSpread', label: 'Warm spread', min: 0, max: 1.5, step: 0.05, format: pct },
      ],
    },
    {
      title: 'Rhombus motion',
      controls: [
        { key: 'spinSpeed', label: 'Spin speed', min: 0, max: 3, step: 0.05, format: num },
        { key: 'gemFlow', label: 'Gradient flow', min: 0, max: 1.5, step: 0.05, format: num },
        { key: 'gemCurve', label: 'Band curve', min: 0, max: 1.2, step: 0.05, format: num },
      ],
    },
    {
      title: 'Light beams',
      controls: [
        { key: 'beamMain', label: 'Main', type: 'color' },
        { key: 'beamSecondary', label: 'Secondary', type: 'color' },
        { key: 'beamDeep', label: 'Deep', type: 'color' },
        { key: 'beamCore', label: 'Core', type: 'color' },
        { key: 'fringe', label: 'Rainbow edges', min: 0, max: 1.5, step: 0.05, format: pct },
        { key: 'brightness', label: 'Brightness', min: 1, max: 4.5, step: 0.05, format: num },
      ],
    },
    {
      title: 'Beam motion',
      controls: [
        { key: 'swingSpeed', label: 'Swing speed', min: 0, max: 5, step: 0.05, format: num },
        { key: 'swingScale', label: 'Swing amount', min: 0, max: 3, step: 0.05, format: num },
        { key: 'curl', label: 'Curl', min: 0, max: 0.8, step: 0.01, format: num },
        { key: 'flowSpeed', label: 'Stream speed', min: 0, max: 2, step: 0.05, format: num },
      ],
    },
    {
      title: 'Background',
      controls: [{ key: 'background', label: 'Color', type: 'color' }],
    },
  ];

  const el = (tag, props = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), props);
    for (const child of [].concat(children)) node.append(child);
    return node;
  };

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  const toggle = el('button', {
    type: 'button',
    className: 'editor-toggle',
    title: 'Customize',
    innerHTML: `
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none"
           stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <path d="M4 7h10M18 7h2M4 17h4M12 17h8"/>
        <circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>
      </svg>`,
  });
  toggle.setAttribute('aria-label', 'Customize hero');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'hero-editor');

  const panel = el('aside', { className: 'editor', id: 'hero-editor' });
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Customize hero');
  panel.inert = true;

  const closeBtn = el('button', { type: 'button', className: 'editor__close', innerHTML: '&times;' });
  closeBtn.setAttribute('aria-label', 'Close');

  const inputs = new Map(); // key -> { input, sync() }

  function rangeRow(c) {
    const id = `editor-${c.key}`;
    const out = el('output', { className: 'editor__value', htmlFor: id });
    const input = el('input', { type: 'range', id, min: c.min, max: c.max, step: c.step });
    const sync = () => {
      input.value = hero.get()[c.key];
      out.textContent = c.format(Number(input.value));
    };
    input.addEventListener('input', () => {
      out.textContent = c.format(Number(input.value));
      hero.set({ [c.key]: Number(input.value) });
    });
    inputs.set(c.key, { sync });
    return el('div', { className: 'editor__row editor__row--range' }, [
      el('label', { htmlFor: id, textContent: c.label }),
      out,
      input,
    ]);
  }

  function colorRow(c) {
    const id = `editor-${c.key}`;
    const hex = el('span', { className: 'editor__value' });
    const input = el('input', { type: 'color', id, className: 'editor__swatch' });
    const sync = () => {
      input.value = hero.get()[c.key];
      hex.textContent = input.value.toUpperCase();
    };
    input.addEventListener('input', () => {
      hex.textContent = input.value.toUpperCase();
      hero.set({ [c.key]: input.value });
    });
    inputs.set(c.key, { sync });
    return el('div', { className: 'editor__row editor__row--color' }, [
      el('label', { htmlFor: id, textContent: c.label }),
      hex,
      input,
    ]);
  }

  const body = el(
    'div',
    { className: 'editor__body' },
    SECTIONS.map((sec) =>
      el('details', { className: 'editor__section', open: !!sec.open }, [
        el('summary', { textContent: sec.title }),
        el(
          'div',
          { className: 'editor__controls' },
          sec.controls.map((c) => (c.type === 'color' ? colorRow(c) : rangeRow(c))),
        ),
      ]),
    ),
  );

  const resetBtn = el('button', { type: 'button', className: 'editor__btn', textContent: 'Reset' });
  const copyBtn = el('button', {
    type: 'button',
    className: 'editor__btn editor__btn--primary',
    textContent: 'Copy settings',
  });

  panel.append(
    el('header', { className: 'editor__header' }, [el('h2', { textContent: 'Customize' }), closeBtn]),
    body,
    el('footer', { className: 'editor__footer' }, [resetBtn, copyBtn]),
  );
  section.append(toggle, panel);

  const syncAll = () => inputs.forEach(({ sync }) => sync());
  syncAll();

  // ---------------------------------------------------------------------------
  // Behaviour
  // ---------------------------------------------------------------------------

  function setOpen(open) {
    panel.classList.toggle('is-open', open);
    panel.inert = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.classList.toggle('is-active', open);
    if (open) panel.querySelector('input, summary, button')?.focus({ preventScroll: true });
    else if (panel.contains(document.activeElement)) toggle.focus({ preventScroll: true });
  }

  toggle.addEventListener('click', () => setOpen(!panel.classList.contains('is-open')));
  closeBtn.addEventListener('click', () => setOpen(false));
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });

  resetBtn.addEventListener('click', () => {
    hero.reset();
    syncAll();
  });

  let copyTimer = 0;
  copyBtn.addEventListener('click', async () => {
    const json = JSON.stringify(hero.get(), null, 2);
    let ok = false;
    try {
      await navigator.clipboard.writeText(json);
      ok = true;
    } catch {
      // clipboard blocked: fall back to a hidden textarea + execCommand
      const ta = el('textarea', { value: json });
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.append(ta);
      ta.select();
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      ta.remove();
    }
    copyBtn.textContent = ok ? 'Copied ✓' : 'Copy failed';
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copyBtn.textContent = 'Copy settings'), 1600);
  });
})();
