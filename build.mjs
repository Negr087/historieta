// Arma dist/index.html: un solo archivo con todo adentro (JS, CSS, génesis y piezas).
// Uso: node build.mjs   (o npm run build)

import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const r = await build({
  entryPoints: ['src/app.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  loader: { '.svg': 'text', '.json': 'json' },
  legalComments: 'none',
});

const css = readFileSync('src/estilo-original.css', 'utf8') + '\n' + readFileSync('src/estilo-app.css', 'utf8');
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync('src/index.html', 'utf8')
  .replace('/*ESTILOS*/', () => css)
  .replace('/*APP*/', () => js);

mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);
console.log(`dist/index.html listo (${Math.round(html.length / 1024)} KB)`);
