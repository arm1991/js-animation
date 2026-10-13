/*
 * Settings schema for the prism hero: every editable value, its label, and its allowed range.
 *
 * The editor builds its panel from this list, and hero.js uses it to validate values coming
 * from the editor or from localStorage. Default values live in constants.js.
 *
 * format: how the editor displays a number — 'pct' (0.5 -> 50%) or 'num' (0.50).
 */
window.Prism = window.Prism || {};

Prism.controls = [
  {
    title: 'Rhombus shape',
    open: true,
    controls: [
      { key: 'gemSize', label: 'Size', min: 0.5, max: 2, step: 0.05, format: 'pct' },
      { key: 'gemWidth', label: 'Width', min: 0.4, max: 1.2, step: 0.01, format: 'pct' },
      { key: 'gemPinch', label: 'Side curve', min: 0, max: 0.9, step: 0.01, format: 'pct' },
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
      { key: 'gemSpread', label: 'Warm spread', min: 0, max: 1.5, step: 0.05, format: 'pct' },
    ],
  },
  {
    title: 'Rhombus motion',
    controls: [
      { key: 'spinSpeed', label: 'Spin speed', min: 0, max: 3, step: 0.05, format: 'num' },
      { key: 'gemFlow', label: 'Gradient flow', min: 0, max: 1.5, step: 0.05, format: 'num' },
      { key: 'gemCurve', label: 'Band curve', min: 0, max: 1.2, step: 0.05, format: 'num' },
    ],
  },
  {
    title: 'Light beams',
    controls: [
      { key: 'beamMain', label: 'Main', type: 'color' },
      { key: 'beamSecondary', label: 'Secondary', type: 'color' },
      { key: 'beamDeep', label: 'Deep', type: 'color' },
      { key: 'beamCore', label: 'Core', type: 'color' },
      { key: 'beamSpread', label: 'Beam height', min: 0.2, max: 1.6, step: 0.05, format: 'pct' },
      { key: 'fringe', label: 'Rainbow edges', min: 0, max: 1.5, step: 0.05, format: 'pct' },
      { key: 'brightness', label: 'Brightness', min: 1, max: 4.5, step: 0.05, format: 'num' },
    ],
  },
  {
    title: 'Beam motion',
    controls: [
      { key: 'swingSpeed', label: 'Swing speed', min: 0, max: 5, step: 0.05, format: 'num' },
      { key: 'swingScale', label: 'Swing amount', min: 0, max: 3, step: 0.05, format: 'num' },
      { key: 'curl', label: 'Curl', min: 0, max: 0.8, step: 0.01, format: 'num' },
      { key: 'flowSpeed', label: 'Stream speed', min: 0, max: 2, step: 0.05, format: 'num' },
    ],
  },
  {
    title: 'Background',
    controls: [{ key: 'background', label: 'Color', type: 'color' }],
  },
];
