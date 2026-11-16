// Ember Yard palette: a dusk dockyard. One dusk sky, slate concrete, rusted
// steel, amber work-lights and a teal accent for the defenders' side. Every
// colour in the scene comes from this file so the look stays deliberate.
//
// Round 2: the palette now also owns the spike, the low-health warning and
// the HUD's team colours, and it can push the CSS side of the theme itself
// (applyTheme) so index.html and the 3D scene can never drift apart again.
// Existing keys are unchanged — world.js, actors.js and combat.js read them.

// --- 3D scene colours (hex numbers for three.js) ---------------------------
export const PALETTE = {
  // Sky and atmosphere.
  skyTop: 0x2b3a55,
  skyMid: 0x6b4a5a, // new: the dusk band between zenith and horizon
  skyHorizon: 0xd98a3d,
  fog: 0x3a3f4a,
  // Ground and structures.
  ground: 0x4a4d52,
  groundDark: 0x3a3d42, // new: shadowed ground patches and trench floors
  groundLine: 0x33363b,
  wall: 0x6b6f75,
  wallDark: 0x54575d,
  wallTop: 0x7d8187, // new: sunlit wall caps so boxes read in 3D
  containerTeal: 0x2e6f6a,
  containerRust: 0x9a5a2e,
  containerAmber: 0xc78a2e,
  crate: 0x8a6f4d,
  crateDark: 0x6e5638,
  // Lights and accents.
  accent: 0xf0a830,
  accentDim: 0xb57d22, // new: the same amber, one stop darker, for emissive trims
  lampGlow: 0xffc861, // new: warm work-light colour (was hardcoded in combat.js)
  // Sites and teams.
  siteA: 0x2e6f6a,
  siteB: 0x9a5a2e,
  enemy: 0xc23b2e,
  enemyDark: 0x8e2a20, // new: enemy vest shadow colour
  ally: 0x3f8f5f,
  allyDark: 0x2c6b45, // new: ally vest shadow colour
  player: 0xe9e6df,
  // Combat feedback.
  tracer: 0xffd27a,
  muzzle: 0xffc861,
  smoke: 0x9aa0a8,
  sparkHot: 0xff6a2a, // new: explosion sparks (was a literal in combat.js)
  sparkCold: 0xbfc4cc, // new: wall-impact sparks
  // The spike: bright amber so a dropped spike is findable at a glance,
  // with a red pulse while it counts down.
  spike: 0xf0a830,
  spikeGlow: 0xffd27a,
  spikeDanger: 0xe0533d,
};

// --- CSS-side colours, kept in step with the 3D palette ---------------------
export const CSS = {
  canvas: '#14161a',
  surface: '#1e2228',
  surfaceRaised: '#262b32', // new: buy cards and hover states sit one step up
  hairline: '#2c323a',
  ink: '#e9e6df',
  muted: '#98a0a8',
  accent: '#f0a830',
  accentSoft: '#c78a2e', // new: amber for secondary text, not just highlights
  danger: '#e0533d',
  dangerSoft: '#8e2a20', // new: danger backgrounds that don't shout
  ally: '#57b981',
  enemy: '#e0533d',
  health: '#e9e6df',
  armor: '#7fb3d5',
  spike: '#f0a830', // new: dropped-spike prompt and minimap marker
  focus: '#f0a830', // new: keyboard-focus ring, same amber as everything else
};

// Team colours in one place, for the HUD, minimap and bot meshes.
export const TEAM = {
  us: { main: CSS.ally, dark: '#2c6b45', label: 'Your team' },
  them: { main: CSS.enemy, dark: '#8e2a20', label: 'Enemy team' },
};

// Push the CSS palette into the document as custom properties, so the
// stylesheet in index.html reads the same values this file declares.
// Called once from main.js; index.html's :root block stays as the fallback
// for the first paint before the module loads.
export function applyTheme(root = document.documentElement) {
  for (const [key, value] of Object.entries(CSS)) {
    root.style.setProperty(`--${key}`, value);
  }
}

// A colour as a CSS hex string, for canvas 2D work (the minimap) that needs
// strings where three.js wants numbers.
export function hexString(hex) {
  return `#${hex.toString(16).padStart(6, '0')}`;
}
