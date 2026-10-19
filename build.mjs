// Costruisce la PWA in dist/ (oppure in docs/ con --docs, la copia pronta da usare senza Node)
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const radice = path.dirname(new URL(import.meta.url).pathname);
const dist = path.join(radice, process.argv.includes('--docs') ? 'docs' : 'dist');
const nm = (...p) => path.join(radice, 'node_modules', ...p);

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'fonts'), { recursive: true });

await build({
  entryPoints: [path.join(radice, 'src/app/main.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020', 'safari14'],
  minify: true,
  outfile: path.join(dist, 'app.js'),
  logLevel: 'warning',
});

// File statici (index.html, manifest, css, icone)
fs.cpSync(path.join(radice, 'public'), dist, { recursive: true });

// sql.js (script + wasm), cercato da store.js nella stessa cartella
for (const f of ['sql-wasm.js', 'sql-wasm.wasm']) fs.copyFileSync(nm('sql.js', 'dist', f), path.join(dist, f));

// Font Manrope (solo caratteri latini, pesi usati dall'app)
for (const peso of [400, 500, 600, 700, 800]) {
  const f = `manrope-latin-${peso}-normal.woff2`;
  fs.copyFileSync(nm('@fontsource', 'manrope', 'files', f), path.join(dist, 'fonts', f));
}

// Service worker: elenco dei file da tenere offline + versione che cambia a ogni modifica
function elencaFile(dir, base = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = path.posix.join(base, e.name);
    return e.isDirectory() ? elencaFile(path.join(dir, e.name), rel) : [rel];
  });
}
const file = elencaFile(dist).filter((f) => f !== 'sw.js').sort();
const hash = crypto.createHash('sha1');
for (const f of file) hash.update(f).update(fs.readFileSync(path.join(dist, f)));
const versione = hash.digest('hex').slice(0, 10);
const sw = fs.readFileSync(path.join(radice, 'src/sw.js'), 'utf8')
  .replace('__VERSIONE__', versione)
  .replace('__FILE__', JSON.stringify(['./', ...file.map((f) => `./${f}`)]));
fs.writeFileSync(path.join(dist, 'sw.js'), sw);

console.log(`dist/ pronta: ${file.length} file, versione ${versione}`);
