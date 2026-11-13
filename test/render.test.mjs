// Pruebas del filtro de SVG: lo que llega de los relays no puede meter scripts,
// links, imágenes externas ni eventos.
// Uso: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

const ventana = new Window();
globalThis.document = ventana.document;
globalThis.DOMParser = ventana.DOMParser;
const { registrarBiblioteca, svgDeArte, figuraVineta } = await import('../src/render.js');
registrarBiblioteca('<symbol id="sat-happy"></symbol><symbol id="o-coin"></symbol><pattern id="dots"></pattern>');

const limpio = (arte) => svgDeArte(arte, 'alt').innerHTML;

test('deja pasar las piezas de la biblioteca y las formas simples', () => {
  const s = limpio('<use href="#sat-happy" x="10" y="20" width="50" height="60"/><rect x="1" y="2" width="3" height="4" fill="#fff"/>');
  assert.match(s, /<use href="#sat-happy" x="10" y="20" width="50" height="60"/);
  assert.match(s, /<rect x="1" y="2" width="3" height="4" fill="#fff"/);
});

test('saca scripts, foreignObject, image, a y animaciones', () => {
  const s = limpio('<script>alert(1)</script><foreignObject><div>x</div></foreignObject><image href="https://evil/x.png"/><a href="javascript:alert(1)"><rect/></a><animate attributeName="href" to="javascript:alert(1)"/><set attributeName="onload"/>');
  for (const malo of ['script', 'foreignObject', 'image', '<a', 'animate', '<set', 'alert', 'evil']) assert.ok(!s.includes(malo), `quedó "${malo}": ${s}`);
});

test('saca los atributos de eventos', () => {
  const s = limpio('<rect onload="alert(1)" onclick="alert(1)" x="1"/>');
  assert.ok(!/on(load|click)/i.test(s), s);
  assert.match(s, /x="1"/);
});

test('href sólo puede apuntar a piezas de la biblioteca', () => {
  assert.ok(!limpio('<use href="https://evil/sprite.svg#a"/>').includes('evil'));
  assert.ok(!limpio('<use href="#no-existe"/>').includes('no-existe'));
  assert.ok(!limpio('<use href="data:image/svg+xml,&lt;svg/&gt;"/>').includes('data:'));
  assert.ok(!limpio('<use xlink:href="https://evil/x.svg#a" xmlns:xlink="http://www.w3.org/1999/xlink"/>').includes('evil'));
});

test('url() sólo a patrones de la biblioteca, nunca a afuera', () => {
  assert.match(limpio('<rect fill="url(#dots)"/>'), /fill="url\(#dots\)"/);
  assert.ok(!limpio('<rect fill="url(https://evil/x)"/>').includes('evil'));
  assert.ok(!limpio('<rect fill="url(#otro)"/>').includes('otro'));
});

test('style: sólo color, fill, stroke y opacity con valores simples', () => {
  const s = limpio('<rect style="fill:#f00;background:blue;stroke:red;color:var(--p1);position:fixed"/>');
  assert.ok(!s.includes('background') && !s.includes('position'), s);
  assert.match(s, /fill:#f00/);
  assert.match(s, /stroke:red/);
  // Con un url() externo se descarta el style entero.
  const u = limpio('<rect style="fill:#f00;background:url(https://evil/x)"/>');
  assert.ok(!u.includes('evil') && !u.includes('style'), u);
});

test('el texto queda como texto, no como markup', () => {
  const s = limpio('<text x="1">&lt;img src=x onerror=alert(1)&gt;</text>');
  assert.ok(!s.includes('<img'), s);
});

test('un SVG roto no rompe nada: queda sólo el fondo', () => {
  const svg = svgDeArte('<rect><circle></rect>', 'alt');
  assert.equal(svg.childNodes.length, 1);
  assert.equal(svg.firstChild.getAttribute('href'), '#base');
});

test('la viñeta pone el epígrafe y los globos como texto', () => {
  const fig = figuraVineta({ id: 'x', fondo: 'p1', epigrafe: { b: '<b>1983.</b>', t: '<script>x</script>' }, arte: '', globos: [{ t: '<img src=x>', lado: 'izq' }], alt: '' });
  assert.ok(!fig.querySelector('script') && !fig.querySelector('img'));
  assert.equal(fig.querySelector('.bubble').textContent, '<img src=x>');
});
