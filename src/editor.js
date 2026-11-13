// Editor de viñetas: armás la escena con las piezas de la biblioteca,
// escribís el epígrafe y el globo, y sale el mismo formato que las originales.

import { t } from './i18n.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const TINTA = '#1b1838';
const FUENTE_TITULO = 'Bowlby One, Arial Black, sans-serif';
const FUENTE_MANO = 'Patrick Hand, Comic Sans MS, sans-serif';

export const CATALOGO = [
  { ref: 'sat-happy', nombre: 'Sat contento', w: 134, h: 150, vb: '0 0 210 235' },
  { ref: 'sat-surprised', nombre: 'Sat sorprendido', w: 134, h: 150, vb: '0 0 210 235' },
  { ref: 'sat-think', nombre: 'Sat pensativo', w: 134, h: 150, vb: '0 0 210 235' },
  { ref: 'sat-worry', nombre: 'Sat preocupado', w: 134, h: 150, vb: '0 0 210 235' },
  { ref: 'o-coin', nombre: 'una moneda', w: 72, h: 72, vb: '0 0 60 60' },
  { ref: 'o-bank', nombre: 'un banco', w: 140, h: 140, vb: '0 0 140 140' },
  { ref: 'o-pc', nombre: 'una computadora', w: 130, h: 130, vb: '0 0 140 140' },
  { ref: 'o-env', nombre: 'un sobre', w: 150, h: 118, vb: '0 0 140 110' },
  { ref: 'o-person', nombre: 'una persona', w: 72, h: 120, vb: '0 0 60 100' },
  { ref: 'o-hood', nombre: 'alguien encapuchado', w: 72, h: 120, vb: '0 0 60 100' },
  { ref: 'o-piece', nombre: 'una pieza de rompecabezas', w: 80, h: 78, vb: '0 0 72 70', color: true },
  { ref: 'o-hourglass', nombre: 'un reloj de arena', w: 80, h: 90, vb: '0 0 80 90' },
  { ref: 'o-kiosk', nombre: 'un kiosco', w: 100, h: 112, vb: '0 0 90 100' },
  // Piezas nuevas (library-extra.svg)
  { ref: 'o-bolt', nombre: 'un rayo', w: 60, h: 90, vb: '0 0 60 90' },
  { ref: 'o-block', nombre: 'un bloque', w: 96, h: 96, vb: '0 0 90 90' },
  { ref: 'o-node', nombre: 'un nodo', w: 84, h: 116, vb: '0 0 80 110' },
  { ref: 'o-pick', nombre: 'un pico de minero', w: 100, h: 100, vb: '0 0 100 100' },
  { ref: 'o-phone', nombre: 'un celular', w: 66, h: 110, vb: '0 0 60 100' },
  { ref: 'o-key', nombre: 'una llave', w: 110, h: 50, vb: '0 0 110 50' },
  { ref: 'o-paper', nombre: 'un documento', w: 76, h: 97, vb: '0 0 72 92' },
  { ref: 'o-pizza', nombre: 'una porción de pizza', w: 90, h: 84, vb: '0 0 90 84' },
  { ref: 'o-chart', nombre: 'un gráfico', w: 110, h: 88, vb: '0 0 100 80' },
];
const PORREF = Object.fromEntries(CATALOGO.map((c) => [c.ref, c]));

export const COLORES = ['#FFD84D', '#F7931A', '#2B59C3', '#E5484D', '#7CE0A3', '#ffffff', '#1b1838', '#BFE3F5', '#F9CDC8'];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r1 = (n) => Math.round(n * 10) / 10;
const r3 = (n) => Math.round(n * 1000) / 1000;

export function nuevaCapa(tipo, ref) {
  if (tipo === 'pieza') {
    const c = PORREF[ref];
    const x = ref.startsWith('sat') ? 252 : 40;
    return { tipo, ref, x, y: 262 - c.h + (ref.startsWith('sat') ? 8 : 0), w: c.w, h: c.h, espejo: false, color: c.color ? '#FFD84D' : null };
  }
  if (tipo === 'cartel') return { tipo, x: 40, y: 40, w: 150, h: 34, texto: t('CARTEL'), color: '#FFD84D', tam: 16 };
  if (tipo === 'texto') return { tipo, x: 200, y: 80, texto: t('Texto'), color: TINTA, tam: 26, w: 0, h: 0 };
  if (tipo === 'caja') return { tipo, x: 150, y: 150, w: 100, h: 70, color: '#ffffff' };
  if (tipo === 'circulo') return { tipo, x: 170, y: 120, w: 70, h: 70, color: '#F7931A' };
  throw new Error(`Tipo desconocido: ${tipo}`);
}

/** Markup SVG de una capa (lo mismo que se guarda en el evento). */
export function svgCapa(c) {
  const t = (v) => r1(v);
  switch (c.tipo) {
    case 'pieza': {
      const estilo = c.color ? ` style="color:${c.color}"` : '';
      if (c.espejo) {
        return `<g transform="translate(${t(c.x + c.w)} ${t(c.y)}) scale(-1 1)"><use href="#${c.ref}" x="0" y="0" width="${t(c.w)}" height="${t(c.h)}"${estilo}/></g>`;
      }
      return `<use href="#${c.ref}" x="${t(c.x)}" y="${t(c.y)}" width="${t(c.w)}" height="${t(c.h)}"${estilo}/>`;
    }
    case 'cartel':
      return `<g><rect x="${t(c.x)}" y="${t(c.y)}" width="${t(c.w)}" height="${t(c.h)}" rx="4" fill="${c.color}" stroke="${TINTA}" stroke-width="3.5"/>`
        + `<text x="${t(c.x + c.w / 2)}" y="${t(c.y + c.h / 2 + c.tam * 0.36)}" text-anchor="middle" font-family="${FUENTE_TITULO}" font-size="${c.tam}" fill="${TINTA}">${esc(c.texto)}</text></g>`;
    case 'texto':
      return `<text x="${t(c.x)}" y="${t(c.y)}" text-anchor="middle" font-family="${FUENTE_MANO}" font-size="${c.tam}" fill="${c.color}" stroke="#ffffff" stroke-width="5" paint-order="stroke">${esc(c.texto)}</text>`;
    case 'caja':
      return `<rect x="${t(c.x)}" y="${t(c.y)}" width="${t(c.w)}" height="${t(c.h)}" rx="8" fill="${c.color}" stroke="${TINTA}" stroke-width="3.5"/>`;
    case 'circulo':
      return `<circle cx="${t(c.x + c.w / 2)}" cy="${t(c.y + c.h / 2)}" r="${t(c.w / 2)}" fill="${c.color}" stroke="${TINTA}" stroke-width="3.5"/>`;
    case 'crudo': {
      // Un pedazo de otra viñeta (remix): se encaja su caja original (bb) en x, y, w, h.
      const sx = c.w / c.bb.w; const sy = c.h / c.bb.h;
      const ox = c.espejo ? c.x + c.w : c.x;
      const fx = c.espejo ? -sx : sx;
      return `<g transform="translate(${t(ox)} ${t(c.y)}) scale(${r3(fx)} ${r3(sy)}) translate(${t(-c.bb.x)} ${t(-c.bb.y)})">${c.svg}</g>`;
    }
    default:
      return '';
  }
}

export function arteDeCapas(capas) { return capas.map(svgCapa).join('\n'); }

export function altDeCapas(capas) {
  const partes = capas.map((c) => {
    if (c.tipo === 'pieza') return PORREF[c.ref] && t(PORREF[c.ref].nombre);
    if (c.tipo === 'cartel') return t('un cartel que dice «{x}»', { x: c.texto });
    if (c.tipo === 'texto') return t('el texto «{x}»', { x: c.texto });
    return null;
  }).filter(Boolean);
  if (!partes.length) return '';
  const s = partes.length > 1 ? t('{lista} y {ultimo}', { lista: partes.slice(0, -1).join(', '), ultimo: partes.at(-1) }) : partes[0];
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Medidas aproximadas de un texto, para poder arrastrarlo y marcarlo. */
function cajaTexto(c) {
  const w = Math.max(20, c.texto.length * c.tam * 0.5);
  return { x: c.x - w / 2, y: c.y - c.tam * 0.85, w, h: c.tam * 1.1 };
}
export function cajaDe(c) { return c.tipo === 'texto' ? cajaTexto(c) : { x: c.x, y: c.y, w: c.w, h: c.h }; }

/**
 * Hace interactivo el <svg> del lienzo: arrastrar capas con mouse o dedo.
 * `estado` = { capas, sel }, `alCambiar()` se llama en cada movimiento.
 */
export function activarArrastre(svg, estado, alCambiar, alSeleccionar) {
  let drag = null;
  const punto = (e) => {
    const p = svg.createSVGPoint();
    p.x = e.clientX; p.y = e.clientY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  };
  svg.addEventListener('pointerdown', (e) => {
    const capa = e.target.closest('[data-capa]');
    if (!capa) { alSeleccionar(null); return; }
    const i = parseInt(capa.dataset.capa, 10);
    alSeleccionar(i);
    const p = punto(e);
    const c = estado.capas[i];
    drag = { i, dx: p.x - c.x, dy: p.y - c.y };
    svg.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = punto(e);
    const c = estado.capas[drag.i];
    c.x = Math.max(-200, Math.min(560, p.x - drag.dx));
    c.y = Math.max(-200, Math.min(460, p.y - drag.dy));
    alCambiar(true);
  });
  const fin = () => { if (drag) { drag = null; alCambiar(false); } };
  svg.addEventListener('pointerup', fin);
  svg.addEventListener('pointercancel', fin);
}

/** Dibuja las capas dentro del svg del lienzo (con marcas para tocar y arrastrar). */
export function dibujarLienzo(svg, estado) {
  while (svg.childNodes.length > 1) svg.removeChild(svg.lastChild); // deja el #base
  estado.capas.forEach((c, i) => {
    const g = document.createElementNS(SVGNS, 'g');
    g.setAttribute('class', `capa${estado.sel === i ? ' sel' : ''}`);
    g.dataset.capa = String(i);
    const tmp = new DOMParser().parseFromString(`<svg xmlns="${SVGNS}">${svgCapa(c)}</svg>`, 'image/svg+xml');
    for (const n of [...tmp.documentElement.childNodes]) g.appendChild(document.importNode(n, true));
    // Zona invisible para que sea fácil agarrar la pieza.
    const b = cajaDe(c);
    const hit = document.createElementNS(SVGNS, 'rect');
    hit.setAttribute('x', b.x); hit.setAttribute('y', b.y); hit.setAttribute('width', b.w); hit.setAttribute('height', b.h);
    hit.setAttribute('fill', 'transparent');
    g.appendChild(hit);
    svg.appendChild(g);
  });
  if (estado.sel != null && estado.capas[estado.sel]) {
    const b = cajaDe(estado.capas[estado.sel]);
    const m = document.createElementNS(SVGNS, 'rect');
    m.setAttribute('class', 'marco');
    m.setAttribute('x', b.x - 4); m.setAttribute('y', b.y - 4); m.setAttribute('width', b.w + 8); m.setAttribute('height', b.h + 8);
    m.setAttribute('rx', 6);
    svg.appendChild(m);
  }
}

/**
 * Remix: convierte el dibujo de una viñeta (un <svg> ya filtrado y metido en la
 * página, para poder medirlo) en capas del editor. Lo que el editor sabe armar
 * vuelve como pieza, cartel, texto, caja o círculo; el resto queda como capa
 * "crudo", que igual se puede mover, agrandar, espejar y borrar.
 */
export function capasDeArte(svg) {
  const capas = [];
  const num = (el, a) => parseFloat(el.getAttribute(a)) || 0;
  const ref = (el) => (el.getAttribute('href') || '').replace(/^#/, '');
  for (const el of [...svg.children]) {
    const tag = el.localName;
    if (tag === 'use' && ref(el) === 'base') continue;
    // Pieza del catálogo, derecha o espejada (como las guarda el editor).
    const espejada = tag === 'g' && /^translate\(([-\d.]+) ([-\d.]+)\) scale\(-1 1\)$/.exec(el.getAttribute('transform') || '');
    const uso = tag === 'use' && !el.getAttribute('transform') ? el
      : espejada && el.children.length === 1 && el.firstElementChild.localName === 'use' ? el.firstElementChild : null;
    if (uso && PORREF[ref(uso)]) {
      const w = num(uso, 'width') || PORREF[ref(uso)].w; const h = num(uso, 'height') || PORREF[ref(uso)].h;
      const color = (uso.getAttribute('style') || '').match(/color:\s*(#[0-9a-f]{3,8})/i)?.[1] || null;
      capas.push(espejada
        ? { tipo: 'pieza', ref: ref(uso), x: parseFloat(espejada[1]) - w, y: parseFloat(espejada[2]), w, h, espejo: true, color }
        : { tipo: 'pieza', ref: ref(uso), x: num(uso, 'x'), y: num(uso, 'y'), w, h, espejo: false, color });
      continue;
    }
    // Cartel del editor: <g><rect rx=4/><text/></g>
    if (tag === 'g' && !el.getAttribute('transform') && el.children.length === 2 && el.children[0].localName === 'rect' && el.children[1].localName === 'text') {
      const [r, tx] = el.children;
      capas.push({ tipo: 'cartel', x: num(r, 'x'), y: num(r, 'y'), w: num(r, 'width'), h: num(r, 'height'), texto: tx.textContent.slice(0, 40), color: r.getAttribute('fill') || '#FFD84D', tam: num(tx, 'font-size') || 16 });
      continue;
    }
    // Texto del editor (con borde blanco).
    if (tag === 'text' && el.getAttribute('paint-order') === 'stroke' && !el.getAttribute('transform') && !el.children.length) {
      capas.push({ tipo: 'texto', x: num(el, 'x'), y: num(el, 'y'), texto: el.textContent.slice(0, 40), color: el.getAttribute('fill') || TINTA, tam: num(el, 'font-size') || 26, w: 0, h: 0 });
      continue;
    }
    // Cualquier otra cosa: se mide (con sus transformaciones) y queda como está.
    const g = document.createElementNS(SVGNS, 'g');
    g.appendChild(el.cloneNode(true));
    svg.appendChild(g);
    let bb = null;
    try { bb = g.getBBox(); } catch (e) { /* no se puede medir */ }
    g.remove();
    if (!bb || !(bb.width > 0.5) || !(bb.height > 0.5)) continue;
    capas.push({ tipo: 'crudo', svg: el.outerHTML, bb: { x: bb.x, y: bb.y, w: bb.width, h: bb.height }, x: bb.x, y: bb.y, w: bb.width, h: bb.height, espejo: false });
  }
  return capas;
}

/** Escena inicial de una viñeta nueva. */
export function escenaInicial() {
  return {
    fondo: 'p1',
    capas: [nuevaCapa('pieza', 'sat-think')],
    sel: 0,
    epigrafe: { b: '', t: '' },
    globos: [{ t: '', lado: 'der' }, { t: '', lado: 'izq' }],
    fuentes: ['', '', ''],
    alt: '',
    altManual: false,
  };
}

export function escalar(c, factor) {
  if (c.tipo === 'texto') { c.tam = Math.max(8, Math.min(90, c.tam * factor)); return; }
  const cx = c.x + c.w / 2; const cy = c.y + c.h / 2;
  // Mismo factor en los dos ejes, para no deformar.
  const f = factor > 1
    ? Math.min(factor, Math.max(1, 600 / Math.max(c.w, c.h)))
    : Math.max(factor, Math.min(1, 10 / Math.min(c.w, c.h)));
  c.w *= f; c.h *= f;
  if (c.tipo === 'cartel') c.tam = Math.max(8, Math.min(60, c.tam * f));
  c.x = cx - c.w / 2; c.y = cy - c.h / 2;
}

export { PORREF };
