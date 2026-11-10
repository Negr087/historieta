// Arma dist/index.html: un solo archivo con todo adentro (JS, CSS, génesis y piezas).
// Uso: node build.mjs   (o npm run build)

import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { EN } from './src/i18n.js';

// Avisa si algún texto de la interfaz no tiene traducción al inglés.
{
  const claves = new Set();
  for (const f of readdirSync('src').filter((x) => /\.(js|html)$/.test(x))) {
    const s = readFileSync(`src/${f}`, 'utf8');
    for (const m of s.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) claves.add(m[1]);
    for (const m of s.matchAll(/\bt\([^'()]*\?\s*'([^']*)'\s*:\s*'([^']*)'/g)) { claves.add(m[1]); claves.add(m[2]); }
    for (const m of s.matchAll(/data-i18n(?:-\w+)?="([^"]*)"/g)) claves.add(m[1]);
    if (f === 'editor.js') for (const m of s.matchAll(/nombre: '([^']*)'/g)) claves.add(m[1]);
  }
  const faltan = [...claves].filter((k) => !(k in EN));
  if (faltan.length) console.warn(`Faltan ${faltan.length} traducciones al inglés en src/i18n.js:\n  ${faltan.join('\n  ')}`);
}

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
