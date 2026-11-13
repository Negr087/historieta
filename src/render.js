// Dibujo de viñetas y limpieza del SVG que llega de los relays.
// Cualquiera puede publicar una viñeta, así que el arte se filtra con una lista
// blanca: sólo formas simples, texto y piezas de la biblioteca. Nada de scripts,
// links, imágenes externas ni eventos.

const SVGNS = 'http://www.w3.org/2000/svg';

const ELEMENTOS = new Set(['g', 'use', 'rect', 'circle', 'ellipse', 'path', 'polyline', 'polygon', 'line', 'text', 'tspan']);
const ATRIBUTOS = new Set([
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'd', 'points', 'transform',
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin',
  'stroke-dasharray', 'opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor',
  'letter-spacing', 'paint-order', 'dx', 'dy', 'href', 'style',
]);
const PROPS_ESTILO = new Set(['color', 'fill', 'stroke', 'opacity']);
const VALOR_SEGURO = /^(#[0-9a-f]{3,8}|[a-z]+|var\(--[a-z0-9-]+\)|-?[0-9.]+%?)$/i;

let PIEZAS = new Set();
export function registrarBiblioteca(svgDefs) {
  const ids = [...svgDefs.matchAll(/id="([a-z0-9-]+)"/gi)].map((m) => m[1]);
  PIEZAS = new Set(ids);
}

function valorSeguro(nombre, valor) {
  if (/url\s*\(|javascript:|expression|@import|<|>/i.test(valor)) {
    // url(#dots) y url(#glow) son de la biblioteca: se permiten.
    const m = valor.match(/^url\(#([a-z0-9-]+)\)$/i);
    return m && PIEZAS.has(m[1]) ? valor : null;
  }
  if (nombre === 'href') {
    const id = valor.startsWith('#') ? valor.slice(1) : null;
    return id && PIEZAS.has(id) ? valor : null;
  }
  if (nombre === 'style') {
    const partes = valor.split(';').map((s) => s.trim()).filter(Boolean);
    const ok = partes.filter((p) => {
      const [k, ...v] = p.split(':');
      return PROPS_ESTILO.has(k.trim().toLowerCase()) && VALOR_SEGURO.test(v.join(':').trim());
    });
    return ok.length ? ok.join(';') : null;
  }
  return valor.length > 4000 ? null : valor;
}

function limpiarNodo(origen, destino, doc, profundidad) {
  if (profundidad > 12) return;
  for (const n of origen.childNodes) {
    if (n.nodeType === 3) {
      destino.appendChild(doc.createTextNode(n.nodeValue));
      continue;
    }
    if (n.nodeType !== 1) continue;
    const nombre = n.localName.toLowerCase();
    if (!ELEMENTOS.has(nombre)) continue;
    const el = doc.createElementNS(SVGNS, nombre);
    for (const a of n.attributes) {
      const an = a.localName.toLowerCase();
      if (!ATRIBUTOS.has(an)) continue;
      const v = valorSeguro(an, a.value);
      if (v != null) el.setAttribute(an, v);
    }
    if (nombre === 'use' && !el.getAttribute('href')) continue;
    limpiarNodo(n, el, doc, profundidad + 1);
    destino.appendChild(el);
  }
}

/** Devuelve un <svg> de 400x300 con el fondo base y el arte filtrado. */
export function svgDeArte(arte, alt) {
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('viewBox', '0 0 400 300');
  svg.setAttribute('role', 'img');
  if (alt) svg.setAttribute('aria-label', alt);
  const base = document.createElementNS(SVGNS, 'use');
  base.setAttribute('href', '#base');
  svg.appendChild(base);
  const parsed = new DOMParser().parseFromString(`<svg xmlns="${SVGNS}">${arte || ''}</svg>`, 'image/svg+xml');
  if (!parsed.querySelector('parsererror')) limpiarNodo(parsed.documentElement, svg, document, 0);
  return svg;
}

/**
 * Los globos de una viñeta como <p class="bubble">. Si son dos, van uno de cada
 * lado (si vinieron del mismo, el segundo pasa al otro) y más angostos.
 */
export function globosDe(globos) {
  const dos = globos.filter((g) => g.t).slice(0, 2);
  const lados = dos.map((g) => (g.lado === 'izq' ? 'izq' : 'der'));
  if (lados.length === 2 && lados[0] === lados[1]) lados[1] = lados[0] === 'izq' ? 'der' : 'izq';
  return dos.map((g, i) => {
    const p = document.createElement('p');
    p.className = `bubble ${lados[i] === 'izq' ? 'b-l' : 'b-r'}${dos.length === 2 ? ' angosto' : ''}`;
    p.textContent = g.t;
    return p;
  });
}

/** Arma el <figure> de una viñeta, con el mismo estilo que la historieta original. */
export function figuraVineta(v, { pie } = {}) {
  const fig = document.createElement('figure');
  fig.className = 'panel';
  fig.style.setProperty('--bg', `var(--${v.fondo})`);
  fig.dataset.id = v.id || '';
  const cap = document.createElement('figcaption');
  cap.className = 'cap';
  const b = document.createElement('b');
  b.textContent = v.epigrafe.b;
  if (v.epigrafe.enLinea) {
    // Negrita en medio de la frase, donde dice {b} (sólo arreglos locales del génesis).
    const [antes, despues = ''] = v.epigrafe.t.split('{b}');
    cap.append(antes, b, despues);
  } else {
    if (v.epigrafe.b) cap.append(b, ' ');
    cap.append(v.epigrafe.t);
  }
  const art = document.createElement('div');
  art.className = 'art';
  art.appendChild(svgDeArte(v.arte, v.alt));
  for (const p of globosDe(v.globos)) art.appendChild(p);
  fig.append(cap, art);
  if (pie) fig.appendChild(pie);
  return fig;
}
