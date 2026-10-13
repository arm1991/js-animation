/*
 * Default settings for the prism hero.
 *
 * These are the values the page starts with (and what "Reset" in the editor returns to).
 * Tip: tune things live in the editor panel, press "Copy settings", and paste the result
 * over the object below to make it the new default.
 *
 * Colors are hex strings; everything else is a number.
 */
window.Prism = window.Prism || {};

Prism.defaults = {
  // Rhombus shape & size
  gemSize: 1.15, // × the default height
  gemWidth: 0.74, // width relative to height
  gemPinch: 0.9, // how far the sides curve in (0 = straight-sided diamond)

  // Rhombus colors
  gemBody: '#ff6b0f',
  gemHighlight: '#ffdbad',
  gemDeep: '#ff470a',
  gemShadow: '#2e0901',
  gemSpread: 1, // strength of the warm red -> yellow spread

  // Rhombus motion
  spinSpeed: 0.9, // radians per second (colors travel right -> left)
  gemFlow: 1, // gradient flowing over the rhombus on its own
  gemCurve: 0.5, // how much the bands arc (0 = straight)

  // Light beams
  beamMain: '#ff6b0f',
  beamSecondary: '#ff801a',
  beamDeep: '#ff420a',
  beamCore: '#ff9e3d',
  beamSpread: 0.45, // beam height: vertical spread of the fan (1 = the ribbons' designed angles, lower = tighter)
  fringe: 1, // rainbow edges on the beams
  brightness: 3,

  // Beam motion
  swingSpeed: 0.8, // how fast ribbons swing up/down
  swingScale: 2, // how far they swing
  curl: 0.8, // how much ribbons arc/curl over their length
  flowSpeed: 0.6, // how fast strands and sheen stream outward

  // Page
  background: '#040303',
};
