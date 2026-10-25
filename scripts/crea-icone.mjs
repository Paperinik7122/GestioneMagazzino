// Genera le icone della PWA in public/icons/ dai disegni SVG (node scripts/crea-icone.mjs, serve playwright).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const qui = dirname(fileURLToPath(import.meta.url));
const OUT = join(qui, '..', 'public', 'icons');
const svg = (p) => readFileSync(p, 'utf8');
const LAVORI = [
  ['icon-192.png', 192, join(OUT, 'icon.svg')],
  ['icon-512.png', 512, join(OUT, 'icon.svg')],
  ['icon-maskable-512.png', 512, join(qui, 'icona-maskable.svg')],
  ['apple-touch-icon.png', 180, join(OUT, 'icon.svg')],
  ['favicon-32.png', 32, join(qui, 'icona-favicon.svg')],
];
const b = await chromium.launch();
for (const [nome, n, src] of LAVORI) {
  const p = await b.newPage({ viewport: { width: n, height: n } });
  await p.setContent(`<body style="margin:0">${svg(src).replace('<svg ', `<svg width="${n}" height="${n}" `)}</body>`);
  await p.screenshot({ path: join(OUT, nome), clip: { x: 0, y: 0, width: n, height: n } });
  await p.close();
}
await b.close();
console.log('icone create');
