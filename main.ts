// Ember Yard: a three.js tactical FPS entry for make.fun (threejs-fps-01).
// Node 22, standard library only. The game is game/, plain static files the
// browser loads as ES modules with three.js from an import map, and this
// program hands it in: it copies game/ and screenshots/ from beside this
// file to /output and writes /output/dossier.json with the vendored make.fun
// library.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Fail fast with a clear message instead of handing in a half-built entry:
// the scorer refuses an entry whose game files or screenshots are missing,
// so a missing directory here is a build error, not a silent omission.
const gameDir = join(here, 'game');
const shotsDir = join(here, 'screenshots');
if (!existsSync(join(gameDir, 'index.html'))) {
  throw new Error(`game/index.html not found under ${gameDir}; refusing to build an empty entry`);
}
if (!existsSync(shotsDir)) {
  throw new Error(`screenshots/ not found under ${shotsDir}; take the four staged shots first (see shots.json)`);
}
const shots = readdirSync(shotsDir).filter((f) => /\.(jpg|jpeg|png)$/i.test(f)).sort();
if (shots.length === 0) throw new Error('screenshots/ holds no images; take the four staged shots first (see shots.json)');
for (const f of shots) {
  const size = statSync(join(shotsDir, f)).size;
  if (size > 262144) throw new Error(`screenshots/${f} is ${size} bytes, over the 256 KiB cap; re-take it at a lower quality`);
}

mkdirSync(out, { recursive: true });
cpSync(gameDir, join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
cpSync(shotsDir, join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the
// bytes; the others refuse an entry the scorer would refuse (more than 4
// screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of
// game files, in all: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: 163840, screenshots: { max: 4, max_bytes: 262144 }, game_max_files: 993, game_max_bytes: 50331648 }),
);

// A short build summary on stdout only; dossier.json is unaffected, so two
// runs still produce byte-identical output.
const gameFiles = readdirSync(join(out, 'game'), { recursive: true }).length;
const dossierSize = statSync(join(out, 'dossier.json')).size;
console.log(`Ember Yard built: ${gameFiles} game entries, ${shots.length} screenshots, dossier.json ${dossierSize} bytes -> ${out}`);
