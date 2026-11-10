// La Historieta de Bitcoin, edición infinita sobre Nostr.
// Lector del tronco, navegador de ramas, editor de viñetas y curaduría.

import { CONFIG } from './config.js';
import genesis from './genesis.json';
import biblioteca from './library.svg';
import {
  FONDOS, KIND_VINETA, KIND_ETIQUETA, ETIQUETA_NS, TAG_T,
  aHex, aNpub, eventosGenesis, leerVineta, armarHistoria, plantillaVineta, plantillaCanon, satsDeRecibo, tag,
} from './model.js';
import { registrarBiblioteca, figuraVineta } from './render.js';
import * as N from './nostr.js';
import * as E from './editor.js';
import QRCode from 'qrcode';
import genesisEn from './genesis-en.json';
import genesisArreglos from './genesis-arreglos.json';
import { t, idioma, locale, cambiarIdioma, IDIOMAS, NOMBRE_IDIOMA } from './i18n.js';

// ---------- Ajustes ----------
const CLAVE_AJUSTES = 'historieta.ajustes';
function cargarAjustes() {
  let a = {};
  try { a = JSON.parse(localStorage.getItem(CLAVE_AJUSTES) || '{}'); } catch (e) { /* sin storage */ }
  return {
    relays: a.relays?.length ? a.relays : CONFIG.relays,
    curadores: a.curadores?.length ? a.curadores : CONFIG.curadores,
  };
}
let ajustes = cargarAjustes();
const curadoresHex = () => ajustes.curadores.map(aHex).filter(Boolean);
const autoraHex = () => curadoresHex()[0] || null;

// ---------- Estado ----------
const S = {
  eventos: new Map(),    // id -> evento kind 8333
  etiquetas: new Map(),  // id -> evento kind 1985
  borradas: new Set(),   // ids de etiquetas borradas (kind 5 de curadores)
  zaps: new Map(),       // id viñeta -> sats
  recibos: new Set(),
  historia: null,
  vista: 'leer',
  pagina: 0,
  paginas: [],
  foco: null,            // viñeta abierta en la vista de ramas
  padre: null,           // viñeta que va a continuar el editor
  conectado: false,
};

const $ = (s, el = document) => el.querySelector(s);
const h = (tag, attrs = {}, ...hijos) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of hijos.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
};
const fmt = (n) => n.toLocaleString(locale());

function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- Datos ----------
function sembrarGenesis() {
  const autora = autoraHex();
  if (!autora) return;
  for (const ev of eventosGenesis(genesis, autora, CONFIG.genesisCreatedAt)) {
    if (!S.eventos.has(ev.id)) S.eventos.set(ev.id, { ...ev, _local: true });
  }
}

// El génesis está firmado en español. En otro idioma se muestra traducido
// (desde genesis-en.json) sin tocar los eventos, así los ids no cambian.
const traducirArte = (arte) => arte.replace(/>([^<>]+)</g, (m, x) => `>${genesisEn.arte[x] ?? x}<`);
function traducirGenesis(v) {
  if (idioma() === 'es') {
    // En algunas viñetas del génesis la negrita va en medio de la frase (la extracción la dejó afuera).
    const arreglo = v.genesis != null && v.pubkey === autoraHex() && genesisArreglos.vinetas[v.genesis];
    return arreglo ? { ...v, epigrafe: { ...v.epigrafe, t: arreglo, enLinea: true } } : v;
  }
  // Los capítulos del génesis se traducen también en las viñetas de la comunidad que siguen en ellos.
  const cap = v.capitulo && capsGenesis[v.capitulo.n]?.titulo === v.capitulo.titulo && genesisEn.capitulos[v.capitulo.n];
  if (cap) v = { ...v, capitulo: { ...v.capitulo, titulo: cap.titulo } };
  if (v.genesis == null || v.pubkey !== autoraHex()) return v;
  const tr = genesisEn.vinetas[v.genesis];
  if (!tr) return v;
  return {
    ...v,
    epigrafe: { b: tr.b ?? v.epigrafe.b, t: tr.t ?? v.epigrafe.t },
    globos: v.globos.map((g, k) => ({ ...g, t: tr.globos?.[k] ?? g.t })),
    alt: tr.alt ?? v.alt,
    arte: traducirArte(v.arte),
  };
}

function recalcular() {
  const vinetas = [...S.eventos.values()].map(leerVineta).filter(Boolean).map(traducirGenesis);
  const etiquetas = [...S.etiquetas.values()].filter((e) => !S.borradas.has(e.id));
  S.historia = armarHistoria({ vinetas, etiquetas, curadores: curadoresHex() });
}

function agregarEvento(ev) {
  if (ev.kind === KIND_VINETA) {
    if (!N.verifyEvent(ev)) return false;
    const previo = S.eventos.get(ev.id);
    S.eventos.set(ev.id, ev); // el firmado reemplaza al local del génesis
    return !previo || previo._local;
  }
  if (ev.kind === KIND_ETIQUETA) {
    if (S.etiquetas.has(ev.id) || !curadoresHex().includes(ev.pubkey) || !N.verifyEvent(ev)) return false;
    S.etiquetas.set(ev.id, ev);
    return true;
  }
  if (ev.kind === 5) {
    if (!curadoresHex().includes(ev.pubkey)) return false;
    let cambio = false;
    for (const t of ev.tags) if (t[0] === 'e' && S.etiquetas.get(t[1])?.pubkey === ev.pubkey) { S.borradas.add(t[1]); cambio = true; }
    return cambio;
  }
  if (ev.kind === 9735) {
    if (S.recibos.has(ev.id)) return false;
    S.recibos.add(ev.id);
    const id = tag(ev, 'e')?.[1];
    if (!id) return false;
    S.zaps.set(id, (S.zaps.get(id) || 0) + satsDeRecibo(ev, N.getSatoshisAmountFromBolt11));
    return true;
  }
  return false;
}

let renderPendiente = null;
function pedirRender() {
  clearTimeout(renderPendiente);
  renderPendiente = setTimeout(() => { recalcular(); render(); if (S.conectado) suscribirZaps(Math.floor(Date.now() / 1000) - 60); }, 120);
}

let subs = [];
async function conectar() {
  subs.forEach((s) => s.close());
  subs = [];
  const relays = ajustes.relays;
  const cur = curadoresHex();
  $('#estado').textContent = t('Conectando…');
  try {
    const [vs, ets, bor] = await Promise.all([
      N.consultar(relays, { kinds: [KIND_VINETA], '#t': [TAG_T], limit: 5000 }),
      cur.length ? N.consultar(relays, { kinds: [KIND_ETIQUETA], '#L': [ETIQUETA_NS], authors: cur, limit: 5000 }) : [],
      cur.length ? N.consultar(relays, { kinds: [5], authors: cur, '#k': [String(KIND_ETIQUETA)], limit: 2000 }) : [],
    ]);
    [...vs, ...ets].forEach(agregarEvento);
    bor.forEach(agregarEvento);
    S.conectado = true;
  } catch (e) {
    console.warn(e);
  }
  recalcular();
  render();
  await cargarZaps();
  const autores = [...S.eventos.values()].map((e) => e.pubkey);
  N.cargarPerfiles(relays, autores).then(() => render());

  const ahora = Math.floor(Date.now() / 1000);
  subs.push(N.suscribir(relays, { kinds: [KIND_VINETA], '#t': [TAG_T], since: ahora }, (ev) => {
    if (agregarEvento(ev)) { N.cargarPerfiles(relays, [ev.pubkey]).then(() => render()); pedirRender(); }
  }));
  if (cur.length) {
    subs.push(N.suscribir(relays, { kinds: [KIND_ETIQUETA, 5], authors: cur, since: ahora }, (ev) => { if (agregarEvento(ev)) pedirRender(); }));
  }
  suscribirZaps(ahora);
  actualizarEstado();
}

// Los recibos de zap no siempre dicen el tipo de evento: se escuchan por id de viñeta.
const zapsEscuchados = new Set();
function suscribirZaps(desde) {
  const nuevos = [...S.eventos.keys()].filter((id) => !zapsEscuchados.has(id));
  for (let i = 0; i < nuevos.length; i += 500) {
    const ids = nuevos.slice(i, i + 500);
    ids.forEach((id) => zapsEscuchados.add(id));
    subs.push(N.suscribir(ajustes.relays, { kinds: [9735], '#e': ids, since: desde }, (ev) => { if (agregarEvento(ev)) pedirRender(); }));
  }
}

async function cargarZaps() {
  const ids = [...S.eventos.keys()];
  for (let i = 0; i < ids.length; i += 150) {
    try {
      const evs = await N.consultar(ajustes.relays, { kinds: [9735], '#e': ids.slice(i, i + 150), limit: 5000 });
      evs.forEach(agregarEvento);
    } catch (e) { /* relays sin respuesta */ }
  }
  render();
}

function actualizarEstado() {
  const est = N.estadoRelays(ajustes.relays);
  const ok = est.filter((r) => r.ok).length;
  const el = $('#estado');
  el.innerHTML = '';
  el.append(h('span', { class: `dot${ok ? ' on' : ''}` }), `${ok}/${est.length} relays`);
}
setInterval(actualizarEstado, 5000);

// ---------- Helpers de viñetas ----------
const enTronco = (v) => S.historia?.enTronco.has(v.id);
const hijosDe = (v) => S.historia?.hijos.get(v.id) || [];
const satsDe = (v) => S.zaps.get(v.id) || 0;
const esCurador = () => { const s = N.sesion(); return !!s && curadoresHex().includes(s.pubkey); };
const capituloDe = (v) => v.capitulo || { n: 0, titulo: '' };

function estadoDe(v) {
  if (enTronco(v)) return { clase: 'canon', texto: t('Tronco') };
  if (S.historia?.cola && v.anterior === S.historia.cola.id) return { clase: 'candidata', texto: t('Candidata') };
  return { clase: 'rama', texto: t('Rama') };
}

// Las ramas de una viñeta: todo lo que la continúa, menos la viñeta que sigue en el tronco.
const ramasDe = (v) => hijosDe(v).filter((x) => !(enTronco(v) && enTronco(x)));

function pieDe(v, { mostrarEstado = false } = {}) {
  const n = ramasDe(v).length;
  const autor = t(v.genesis != null ? 'génesis · {nombre}' : 'por {nombre}', { nombre: N.nombreCorto(v.pubkey) });
  const est = estadoDe(v);
  return h('div', { class: 'pie' },
    mostrarEstado ? h('span', { class: `sello ${est.clase}` }, est.texto) : null,
    v.idioma && v.idioma !== idioma() ? h('span', { class: 'sello', title: t('Escrita en {idioma}', { idioma: NOMBRE_IDIOMA[v.idioma] ? t(NOMBRE_IDIOMA[v.idioma]) : v.idioma }), lang: v.idioma }, v.idioma.toUpperCase()) : null,
    h('span', { class: 'quien', title: aNpub(v.pubkey) }, autor),
    h('button', { class: 'zap', type: 'button', title: t('Zapear esta viñeta'), onclick: () => abrirZap(v) }, `⚡ ${fmt(satsDe(v))}`),
    h('button', { type: 'button', title: t('Ver continuaciones'), onclick: () => irA('v', v) }, t(n === 1 ? '↳ {n} rama' : '↳ {n} ramas', { n })),
    h('button', { type: 'button', title: t('Escribir lo que sigue'), onclick: () => continuar(v) }, t('✎ Seguir')),
  );
}

function figura(v, opts) { return figuraVineta(v, { pie: pieDe(v, opts) }); }

// ---------- Lector ----------
function construirPaginas() {
  const H = S.historia;
  const paginas = [{ tipo: 'portada' }, { tipo: 'sat' }, { tipo: 'indice' }];
  const caps = [];
  const porCap = new Map();
  for (const v of H.tronco) {
    const c = capituloDe(v);
    if (!porCap.has(c.n)) { porCap.set(c.n, []); caps.push(c); }
    porCap.get(c.n).push(v);
  }
  const inicioCap = new Map();
  for (const c of caps) {
    const vs = porCap.get(c.n);
    const total = Math.ceil(vs.length / 4);
    inicioCap.set(c.n, paginas.length);
    for (let p = 0; p < total; p++) paginas.push({ tipo: 'cap', cap: c, pag: p + 1, total, vinetas: vs.slice(p * 4, p * 4 + 4) });
  }
  paginas.push({ tipo: 'fin' });
  S.paginas = paginas;
  S.caps = caps;
  S.inicioCap = inicioCap;
}

const capsGenesis = Object.fromEntries(genesis.capitulos.map((c) => [c.n, c]));
const infoCap = (n) => (capsGenesis[n] && idioma() !== 'es' && genesisEn.capitulos[n] ? { ...capsGenesis[n], ...genesisEn.capitulos[n] } : capsGenesis[n]);

function paginaPortada() {
  const n = S.caps.length;
  return h('section', { class: 'page cover' },
    h('div', { class: 'burst', 'aria-hidden': 'true' }),
    h('div', { class: 'cover-inner' },
      h('p', { class: 'issue' }, t('Edición infinita · {n} capítulos y contando', { n })),
      h('h1', { class: 'logo' }, 'BITCOIN'),
      h('p', { class: 'tagline' }, t('LA HISTORIETA')),
      h('div', { html: `<svg class="cover-sat" viewBox="0 0 210 235" role="img" aria-label="${t('Sat, una moneda naranja con brazos y piernas, haciendo un pulgar arriba')}"><use href="#sat-happy"/></svg>` }),
      h('p', { class: 'cover-sub' }, t('De los cypherpunks a hoy. Y desde hoy, la escribimos entre todos sobre Nostr.')),
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onclick: () => irPagina(1) }, t('Empezar a leer')),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => continuar(S.historia.cola) }, t('Sumar una viñeta')),
      ),
    ));
}

function paginaSat() {
  const poses = [['sat-happy', 'p2', 'Contento', 'Cuando algo sale bien.'], ['sat-surprised', 'p1', 'Sorprendido', 'Ante un récord o un giro.'],
    ['sat-think', 'p3', 'Pensativo', 'Cuando hay que hacer cuentas.'], ['sat-worry', 'p4', 'Preocupado', 'Cuando un intermediario se cae.']]
    .map(([ref, bg, n, d]) => [ref, bg, t(n), t(d)]);
  return h('section', { class: 'page' },
    h('header', {},
      h('p', { class: 'eyebrow' }, t('Ficha del personaje')),
      h('h2', { class: 'h-title' }, t('Conocé a Sat')),
      h('p', { class: 'lead' }, t('Sat es una moneda naranja curiosa que te acompaña en cada época. Su nombre viene del satoshi, la unidad más chica de bitcoin: un bitcoin son 100.000.000 de sats.'))),
    h('div', { class: 'poses' }, poses.map(([ref, bg, nombre, d]) => {
      const f = h('figure', { class: 'pose', style: `--bg:var(--${bg})` });
      f.innerHTML = `<svg viewBox="0 0 210 235" role="img" aria-label="${t('Sat {pose}', { pose: nombre.toLowerCase() })}"><use href="#${ref}"/></svg>`;
      f.append(h('figcaption', {}, h('b', {}, nombre), d));
      return f;
    })),
    h('dl', { class: 'sheet-facts' },
      h('div', {}, h('dt', {}, t('Altura')), h('dd', {}, t('Una moneda grande y dos piernitas.'))),
      h('div', {}, h('dt', {}, t('Superpoder')), h('dd', {}, t('Hacer preguntas incómodas.'))),
      h('div', {}, h('dt', {}, t('Debilidad')), h('dd', {}, t('Los puntos únicos de falla.')))));
}

function paginaIndice() {
  const grupos = [];
  for (const c of S.caps) {
    const g = infoCap(c.n)?.grupo || t('La historia sigue (comunidad)');
    let gr = grupos.find((x) => x.nombre === g);
    if (!gr) { gr = { nombre: g, caps: [] }; grupos.push(gr); }
    gr.caps.push(c);
  }
  return h('section', { class: 'page' },
    h('header', {},
      h('p', { class: 'eyebrow' }, t('Índice')),
      h('h2', { class: 'h-title' }, t('{n} capítulos y una historia que no termina', { n: S.caps.length })),
      h('p', { class: 'lead' }, t('Los primeros 23 capítulos son el génesis. Lo que viene después lo escribe la comunidad, viñeta por viñeta, y queda firmado en Nostr.'))),
    h('div', { class: 'toc' }, grupos.map((g) => h('section', {},
      h('h3', {}, g.nombre),
      h('ol', {}, g.caps.map((c) => h('li', { class: 'ready' },
        h('button', { type: 'button', onclick: () => irPagina(S.inicioCap.get(c.n)) },
          h('span', { class: 'n' }, String(c.n)),
          h('span', { class: 't' }, c.titulo || t('Capítulo {n}', { n: c.n })),
          h('span', { class: 'y' }, infoCap(c.n)?.anios || t('comunidad'))))))))));
}

function paginaCapitulo(p) {
  const anios = infoCap(p.cap.n)?.anios;
  return h('section', { class: 'page' },
    h('header', { class: 'running' },
      h('div', {},
        h('p', { class: 'eyebrow' }, t('Capítulo {n}', { n: p.cap.n })),
        h('h2', { class: 'h-title' }, p.cap.titulo || t('Capítulo {n}', { n: p.cap.n }))),
      h('span', { class: 'years' }, `${anios ? `${anios} · ` : ''}${t('pág. {p} de {total}', { p: p.pag, total: p.total })}`)),
    h('div', { class: 'grid' }, p.vinetas.map((v) => figura(v))));
}

function paginaFin() {
  const H = S.historia;
  const todas = [...H.porId.values()];
  const comunidad = todas.filter((v) => v.genesis == null);
  const autores = new Set(comunidad.map((v) => v.pubkey));
  return h('section', { class: 'page end' },
    h('p', { class: 'eyebrow' }, t('Hasta acá llegó el tronco: {n} viñetas', { n: fmt(H.tronco.length) })),
    h('p', { class: 'to-be' }, t('CONTINUARÁ')),
    h('div', { html: `<svg viewBox="0 0 210 235" role="img" aria-label="${t('Sat sorprendido, con los brazos en alto')}"><use href="#sat-surprised"/></svg>` }),
    h('p', { class: 'next-ch' }, h('b', {}, t('La historia sigue')), t('Bitcoin todavía se está escribiendo, y esta historieta también. La próxima viñeta la podés hacer vos.')),
    h('div', { class: 'stats' },
      h('span', {}, h('b', {}, fmt(comunidad.length)), t(' viñetas de la comunidad')),
      h('span', {}, h('b', {}, fmt(autores.size)), t(' autores')),
      h('span', {}, h('b', {}, fmt([...S.zaps.values()].reduce((a, b) => a + b, 0))), t(' sats en zaps'))),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: () => continuar(H.cola) }, t('Sumar la próxima viñeta')),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => irA('ramas') }, t('Ver las ramas')),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => irPagina(2) }, t('Índice'))));
}

function renderLector() {
  construirPaginas();
  S.pagina = Math.max(0, Math.min(S.pagina, S.paginas.length - 1));
  const p = S.paginas[S.pagina];
  const cont = $('#vista-leer');
  cont.innerHTML = '';
  const el = p.tipo === 'portada' ? paginaPortada() : p.tipo === 'sat' ? paginaSat() : p.tipo === 'indice' ? paginaIndice()
    : p.tipo === 'fin' ? paginaFin() : paginaCapitulo(p);
  if (renderLector.anim) { el.classList.add(renderLector.anim); renderLector.anim = null; }
  cont.append(el);
  $('#count').textContent = `${S.pagina + 1} / ${S.paginas.length}`;
  $('#prev').disabled = S.pagina === 0;
  $('#next').disabled = S.pagina === S.paginas.length - 1;
  $('#label').textContent = p.tipo === 'cap' ? t('Cap. {n} · {titulo}', { n: p.cap.n, titulo: p.cap.titulo }) : t({ portada: 'Portada', sat: 'Conocé a Sat', indice: 'Índice', fin: 'Continuará' }[p.tipo]);
}

function irPagina(n) {
  if (n == null) return;
  renderLector.anim = n >= S.pagina ? 'in-fwd' : 'in-back';
  S.pagina = n;
  if (S.vista !== 'leer') irA('leer'); else { renderLector(); $('#stage').scrollTop = 0; }
  try { history.replaceState(null, '', `#pag-${n}`); } catch (e) { location.hash = `pag-${n}`; }
}

// ---------- Ramas ----------
function tarjeta(v, extra) {
  const ant = v.anterior ? S.historia.porId.get(v.anterior) : null;
  return h('div', { class: 'tarjeta' },
    figura(v, { mostrarEstado: true }),
    h('div', { class: 'meta' },
      ant ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); irA('v', ant); } }, t('↰ sigue a: {x}', { x: ant.epigrafe.b || ant.epigrafe.t.slice(0, 40) })) : null,
      v.fuentes.length ? h('span', {}, '· ', ...v.fuentes.map((f, i) => h('a', { href: f, target: '_blank', rel: 'noopener noreferrer' }, t('fuente {n} ', { n: i + 1 })))) : null,
      extra || null));
}

function renderRamas() {
  const H = S.historia;
  const cont = $('#vista-ramas');
  cont.innerHTML = '';
  const comunidad = [...H.porId.values()].filter((v) => v.genesis == null).sort((a, b) => b.created_at - a.created_at);
  cont.append(h('div', { class: 'hoja' },
    h('div', {},
      h('p', { class: 'eyebrow' }, t('Ramas y propuestas')),
      h('h2', { class: 'h-title' }, t('Lo último que sumó la comunidad')),
      h('p', { class: 'lead' }, t('Cada viñeta continúa a otra. Las que aprueban los curadores pasan al tronco; el resto forma ramas: historias alternativas, chistes y episodios que cuelgan de la historia principal.'))),
    comunidad.length
      ? h('div', { class: 'lista' }, comunidad.slice(0, 120).map((v) => tarjeta(v)))
      : h('div', { class: 'vacio' }, t('Todavía no hay viñetas de la comunidad. '), h('button', { class: 'btn chico', type: 'button', onclick: () => continuar(H.cola) }, t('Hacé la primera')))));
}

function renderFoco() {
  const v = S.foco;
  const cont = $('#vista-v');
  cont.innerHTML = '';
  if (!v) { cont.append(h('div', { class: 'hoja' }, h('div', { class: 'vacio' }, t('No encontré esa viñeta.')))); return; }
  const hijos = hijosDe(v).slice().sort((a, b) => (enTronco(b) - enTronco(a)) || (satsDe(b) - satsDe(a)) || (a.created_at - b.created_at));
  const ant = v.anterior ? S.historia.porId.get(v.anterior) : null;
  cont.append(h('div', { class: 'hoja' },
    h('div', {},
      h('p', { class: 'eyebrow' }, t('Capítulo {n} · {titulo}', capituloDe(v))),
      h('h2', { class: 'h-title' }, t('Esta viñeta y lo que sigue'))),
    h('div', { class: 'camino' },
      h('div', { class: 'tarjeta' },
        figura(v, { mostrarEstado: true }),
        h('div', { class: 'fila' },
          ant ? h('button', { class: 'btn chico blanco', type: 'button', onclick: () => irA('v', ant) }, t('↰ Anterior')) : null,
          h('button', { class: 'btn chico', type: 'button', onclick: () => continuar(v) }, t('✎ Continuar desde acá'))),
        v.fuentes.length ? h('p', { class: 'muted' }, t('Fuentes: '), ...v.fuentes.map((f) => h('a', { href: f, target: '_blank', rel: 'noopener noreferrer' }, `${new URL(f).hostname} `))) : null),
      h('div', {},
        h('h3', {}, hijos.length ? t(hijos.length === 1 ? '{n} continuación' : '{n} continuaciones', { n: hijos.length }) : t('Sin continuaciones todavía')),
        hijos.length
          ? h('div', { class: 'lista' }, hijos.map((hj) => tarjeta(hj, h('button', { class: 'btn chico ghost', type: 'button', onclick: () => irA('v', hj) }, t('Seguir esta rama →')))))
          : h('div', { class: 'vacio' }, t('Nadie siguió desde acá. '), h('button', { class: 'btn chico', type: 'button', onclick: () => continuar(v) }, t('Escribí lo que sigue')))))));
}

// ---------- Curaduría ----------
function renderCurar() {
  const H = S.historia;
  const cont = $('#vista-curar');
  cont.innerHTML = '';
  if (!esCurador()) {
    cont.append(h('div', { class: 'hoja' }, h('div', { class: 'vacio' }, t('Esta sección es para los curadores de la historieta. Entrá con una de sus identidades.'))));
    return;
  }
  const cands = H.cola ? hijosDe(H.cola).filter((v) => !enTronco(v)).sort((a, b) => satsDe(b) - satsDe(a)) : [];
  const yo = N.sesion().pubkey;
  const misEtiquetas = [...S.etiquetas.values()].filter((e) => e.pubkey === yo && !S.borradas.has(e.id));
  const canonComunidad = H.tronco.filter((v) => v.genesis == null);
  cont.append(h('div', { class: 'hoja' },
    h('div', {},
      h('p', { class: 'eyebrow' }, t('Curaduría')),
      h('h2', { class: 'h-title' }, t('Qué entra al tronco')),
      h('p', { class: 'lead' }, t('Las candidatas son las viñetas que continúan la última del tronco. Al aprobar una, firmás una etiqueta de canon (NIP-32) y pasa a ser la nueva punta: las siguientes candidatas tienen que continuarla a ella.'))),
    h('h3', {}, t('Candidatas ({n})', { n: cands.length })),
    cands.length ? h('div', { class: 'lista' }, cands.map((v) => tarjeta(v, h('button', { class: 'btn chico', type: 'button', onclick: () => aprobar(v) }, t('✓ Aprobar como canon')))))
      : h('div', { class: 'vacio' }, t('No hay candidatas nuevas para la punta del tronco.')),
    h('h3', {}, t('Canon de la comunidad ({n})', { n: canonComunidad.length })),
    canonComunidad.length ? h('div', { class: 'lista' }, canonComunidad.slice().reverse().map((v) => {
      const mias = misEtiquetas.filter((e) => tag(e, 'e')?.[1] === v.id);
      return tarjeta(v, mias.length ? h('button', { class: 'btn chico rojo', type: 'button', onclick: () => revocar(mias) }, t('Quitar del canon')) : null);
    })) : h('div', { class: 'vacio' }, t('Todavía no aprobaste viñetas de la comunidad.'))));
}

async function aprobar(v) {
  try {
    const ev = await N.firmar(plantillaCanon(v));
    const r = await N.publicar(ajustes.relays, ev);
    agregarEvento(ev);
    recalcular(); render();
    toast(t('Aprobada. Llegó a {ok} de {total} relays.', r));
  } catch (e) { toast(e.message); }
}

async function revocar(etiquetas) {
  try {
    const ev = await N.firmar({ kind: 5, created_at: Math.floor(Date.now() / 1000), content: t('Sale del canon'), tags: [...etiquetas.map((e) => ['e', e.id]), ['k', String(KIND_ETIQUETA)]] });
    await N.publicar(ajustes.relays, ev);
    agregarEvento(ev);
    recalcular(); render();
    toast(t('Listo, salió del canon.'));
  } catch (e) { toast(e.message); }
}

// ---------- Editor ----------
const CLAVE_BORRADOR = 'historieta.borrador';
let esc = null;
function cargarBorrador() {
  try { const b = JSON.parse(localStorage.getItem(CLAVE_BORRADOR) || 'null'); if (b?.capas) return { ...E.escenaInicial(), ...b, sel: null }; } catch (e) { /* nada */ }
  return E.escenaInicial();
}
function guardarBorrador() { try { localStorage.setItem(CLAVE_BORRADOR, JSON.stringify({ ...esc, sel: null })); } catch (e) { /* nada */ } }

// Si no se eligió una viñeta puntual, el editor sigue siempre a la punta del tronco
// (que puede moverse mientras llegan datos de los relays).
function continuar(v) {
  S.padreElegido = !!v && v.id !== S.historia?.cola?.id;
  S.padre = S.padreElegido ? v : null;
  irA('crear');
}

function maxCapitulo() {
  let m = 0;
  for (const v of S.historia.porId.values()) m = Math.max(m, capituloDe(v).n);
  return m;
}

function renderCrear() {
  if (!esc) esc = cargarBorrador();
  const padre = S.padreElegido && S.padre && S.historia.porId.get(S.padre.id) ? S.padre : S.historia.cola;
  const cont = $('#vista-crear');
  cont.innerHTML = '';
  if (!padre) {
    cont.append(h('div', { class: 'hoja' }, h('div', { class: 'aviso' }, h('b', {}, t('Falta configurar la curadora. ')), t('Poné tu npub en Ajustes (o en src/config.js) para cargar el génesis y poder continuar la historia.'))));
    return;
  }
  const capPadre = capituloDe(padre);
  if (!esc.capitulo) esc.capitulo = { modo: 'mismo', titulo: '' };
  if (!esc.idioma) esc.idioma = idioma();

  // Lienzo: la misma figura que se va a publicar, con las capas interactivas.
  const fig = h('figure', { class: 'panel' });
  const cap = h('figcaption', { class: 'cap' });
  const art = h('div', { class: 'art' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 400 300');
  svg.innerHTML = '<use href="#base"/>';
  const globo = h('p', { class: 'bubble' });
  art.append(svg, globo);
  fig.append(cap, art);

  const actualizar = (soloLienzo) => {
    fig.style.setProperty('--bg', `var(--${esc.fondo})`);
    cap.innerHTML = '';
    if (esc.epigrafe.b) cap.append(h('b', {}, esc.epigrafe.b), ' ');
    cap.append(esc.epigrafe.t || (esc.epigrafe.b ? '' : t('Escribí el epígrafe…')));
    globo.textContent = esc.globo.t;
    globo.hidden = !esc.globo.t;
    globo.className = `bubble ${esc.globo.lado === 'izq' ? 'b-l' : 'b-r'}`;
    E.dibujarLienzo(svg, esc);
    if (!esc.altManual) { esc.alt = E.altDeCapas(esc.capas); const a = $('#ed-alt'); if (a) a.value = esc.alt; }
    if (!soloLienzo) { guardarBorrador(); pintarSeleccion(); }
  };

  E.activarArrastre(svg, esc, (moviendo) => actualizar(moviendo), (i) => { esc.sel = i; actualizar(); });

  // --- Controles ---
  const sel = h('div', { class: 'grupo', id: 'ed-sel' });
  function pintarSeleccion() {
    sel.innerHTML = '';
    const c = esc.capas[esc.sel];
    sel.append(h('b', {}, t('Pieza elegida')));
    if (!c) { sel.append(h('span', { class: 'muted' }, t('Tocá una pieza del dibujo para moverla, agrandarla o borrarla.'))); return; }
    const redibujar = () => { actualizar(); };
    sel.append(
      h('div', { class: 'fila' },
        h('button', { class: 'btn chico blanco', type: 'button', onclick: () => { E.escalar(c, 0.88); redibujar(); } }, t('− Achicar')),
        h('button', { class: 'btn chico blanco', type: 'button', onclick: () => { E.escalar(c, 1.12); redibujar(); } }, t('+ Agrandar')),
        c.tipo === 'pieza' ? h('button', { class: 'btn chico blanco', type: 'button', onclick: () => { c.espejo = !c.espejo; redibujar(); } }, t('⇋ Espejar')) : null),
      h('div', { class: 'fila' },
        h('button', { class: 'btn chico blanco', type: 'button', onclick: () => { const [x] = esc.capas.splice(esc.sel, 1); esc.capas.push(x); esc.sel = esc.capas.length - 1; redibujar(); } }, t('Al frente')),
        h('button', { class: 'btn chico blanco', type: 'button', onclick: () => { const [x] = esc.capas.splice(esc.sel, 1); esc.capas.unshift(x); esc.sel = 0; redibujar(); } }, t('Al fondo')),
        h('button', { class: 'btn chico rojo', type: 'button', onclick: () => { esc.capas.splice(esc.sel, 1); esc.sel = null; redibujar(); } }, t('Borrar'))),
    );
    if (c.tipo === 'cartel' || c.tipo === 'texto') {
      sel.append(h('label', { class: 'campo' }, t('Texto'), h('input', { value: c.texto, maxlength: 40, oninput: (e) => { c.texto = e.target.value; actualizar(true); guardarBorrador(); } })));
    }
    if (c.color !== null && c.color !== undefined) {
      sel.append(h('div', { class: 'fondos', role: 'group', 'aria-label': t('Color') }, E.COLORES.map((col) => h('button', {
        type: 'button', style: `background:${col}`, 'aria-pressed': String(c.color === col), title: col, onclick: () => { c.color = col; redibujar(); },
      }))));
    }
  }

  const piezas = h('div', { class: 'piezas' },
    E.CATALOGO.map((p) => {
      const b = h('button', { type: 'button', title: t('Agregar {x}', { x: t(p.nombre) }), onclick: () => { esc.capas.push(E.nuevaCapa('pieza', p.ref)); esc.sel = esc.capas.length - 1; actualizar(); } });
      b.innerHTML = `<svg viewBox="${p.vb}" aria-hidden="true"><use href="#${p.ref}" style="color:#FFD84D"/></svg>`;
      return b;
    }),
    [['cartel', 'Cartel'], ['texto', 'Texto'], ['caja', 'Caja'], ['circulo', 'Círculo']].map(([tipo, n]) => h('button', {
      type: 'button', title: t('Agregar {x}', { x: t(n.toLowerCase()) }), onclick: () => { esc.capas.push(E.nuevaCapa(tipo)); esc.sel = esc.capas.length - 1; actualizar(); },
    }, h('span', {}, t(n)))),
  );

  const fondos = h('div', { class: 'fondos', role: 'group', 'aria-label': t('Fondo') }, Object.entries(FONDOS).map(([k, col]) => h('button', {
    type: 'button', style: `background:${col}`, title: k, 'aria-pressed': String(esc.fondo === k),
    onclick: (e) => { esc.fondo = k; fondos.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); actualizar(); },
  })));

  const campo = (etiqueta, el) => h('label', { class: 'campo' }, etiqueta, el);
  const inLead = h('input', { value: esc.epigrafe.b, maxlength: 60, placeholder: t('Ej.: Abril de 2028.'), oninput: (e) => { esc.epigrafe.b = e.target.value; actualizar(true); guardarBorrador(); } });
  const inTexto = h('textarea', { maxlength: 300, placeholder: t('Qué pasó, en una o dos frases.'), oninput: (e) => { esc.epigrafe.t = e.target.value; actualizar(true); guardarBorrador(); } }, esc.epigrafe.t);
  const inGlobo = h('input', { value: esc.globo.t, maxlength: 120, placeholder: t('Lo que dice Sat (opcional)'), oninput: (e) => { esc.globo.t = e.target.value; actualizar(true); guardarBorrador(); } });
  const inLado = h('select', { onchange: (e) => { esc.globo.lado = e.target.value; actualizar(true); guardarBorrador(); } },
    h('option', { value: 'der', selected: esc.globo.lado !== 'izq' }, t('Globo a la derecha')),
    h('option', { value: 'izq', selected: esc.globo.lado === 'izq' }, t('Globo a la izquierda')));
  const inIdioma = h('select', { 'aria-label': t('Idioma de la viñeta'), onchange: (e) => { esc.idioma = e.target.value; guardarBorrador(); } },
    Object.entries(IDIOMAS).map(([k, nombre]) => h('option', { value: k, selected: esc.idioma === k }, nombre)));
  const inFuentes = esc.fuentes.map((f, i) => h('input', { type: 'url', value: f, placeholder: 'https://…', oninput: (e) => { esc.fuentes[i] = e.target.value.trim(); guardarBorrador(); } }));
  const inAlt = h('textarea', { id: 'ed-alt', maxlength: 300, oninput: (e) => { esc.alt = e.target.value; esc.altManual = true; guardarBorrador(); } }, esc.alt);

  const capSelect = h('select', { onchange: (e) => { esc.capitulo.modo = e.target.value; inCapTitulo.hidden = e.target.value !== 'nuevo'; guardarBorrador(); } },
    h('option', { value: 'mismo', selected: esc.capitulo.modo !== 'nuevo' }, t('Sigue en el capítulo {n}: {titulo}', capPadre)),
    h('option', { value: 'nuevo', selected: esc.capitulo.modo === 'nuevo' }, t('Empieza el capítulo {n}', { n: maxCapitulo() + 1 })));
  const inCapTitulo = h('input', { value: esc.capitulo.titulo, maxlength: 60, placeholder: t('Título del capítulo nuevo'), hidden: esc.capitulo.modo !== 'nuevo', oninput: (e) => { esc.capitulo.titulo = e.target.value; guardarBorrador(); } });

  const btnPublicar = h('button', { class: 'btn', type: 'button', onclick: () => publicarVineta(padre, capPadre) }, t(N.sesion() ? 'Firmar y publicar' : 'Entrar y publicar'));

  const padreMini = h('div', { class: 'mini' }, figuraVineta(padre));
  cont.append(h('div', { class: 'hoja' },
    h('div', {},
      h('p', { class: 'eyebrow' }, t(enTronco(padre) && padre.id === S.historia.cola?.id ? 'Continuás la punta del tronco' : 'Continuás una rama')),
      h('h2', { class: 'h-title' }, t('Nueva viñeta'))),
    h('div', { class: 'editor' },
      h('div', { class: 'lienzo' }, fig,
        h('p', { class: 'muted' }, t('Arrastrá las piezas para ubicarlas. Lo que ves acá es exactamente lo que se publica.'))),
      h('div', { class: 'controles' },
        h('div', { class: 'grupo' }, h('b', {}, t('Continúa a')), padreMini,
          h('button', { class: 'btn chico blanco', type: 'button', onclick: () => irA('v', padre) }, t('Elegir otra viñeta desde las ramas'))),
        h('div', { class: 'grupo' }, h('b', {}, t('Piezas')), piezas),
        sel,
        h('div', { class: 'grupo' }, h('b', {}, t('Fondo')), fondos),
        h('div', { class: 'grupo' }, h('b', {}, t('Epígrafe')), campo(t('Fecha o título corto (va en negrita)'), inLead), campo(t('Texto'), inTexto), campo(t('Idioma de la viñeta'), inIdioma)),
        h('div', { class: 'grupo' }, h('b', {}, t('Globo')), inGlobo, inLado),
        h('div', { class: 'grupo' }, h('b', {}, t('Capítulo')), capSelect, inCapTitulo),
        h('div', { class: 'grupo' }, h('b', {}, t('Fuentes')), h('span', { class: 'muted' }, t('Es historia: para entrar al tronco, sumá de dónde sale el dato.')), ...inFuentes),
        h('div', { class: 'grupo' }, h('b', {}, t('Descripción del dibujo')), h('span', { class: 'muted' }, t('Para lectores de pantalla y otros clientes de Nostr.')), inAlt),
        h('div', { class: 'fila' }, btnPublicar,
          h('button', { class: 'btn ghost', type: 'button', onclick: () => { esc = E.escenaInicial(); guardarBorrador(); renderCrear(); } }, t('Empezar de cero')))))));
  actualizar();
}

async function publicarVineta(padre, capPadre) {
  if (!N.sesion()) { abrirEntrar(() => publicarVineta(padre, capPadre)); return; }
  if (!esc.epigrafe.t.trim() && !esc.epigrafe.b.trim()) { toast(t('Falta el epígrafe: contá qué pasa en la viñeta.')); return; }
  if (!esc.capas.length) { toast(t('Agregá al menos una pieza al dibujo.')); return; }
  // Si sigue en el mismo capítulo, va el título tal como está firmado (no el traducido en pantalla).
  const capitulo = esc.capitulo.modo === 'nuevo'
    ? { n: maxCapitulo() + 1, titulo: esc.capitulo.titulo.trim() || t('Capítulo {n}', { n: maxCapitulo() + 1 }) }
    : (padre.evento && leerVineta(padre.evento)?.capitulo) || capPadre;
  const autora = autoraHex();
  const yo = N.sesion().pubkey;
  const relay = ajustes.relays[0];
  const zaps = autora && autora !== yo
    ? [{ pubkey: yo, relay, peso: CONFIG.reparto.autor }, { pubkey: autora, relay, peso: CONFIG.reparto.creadora }]
    : [];
  const datos = {
    fondo: esc.fondo,
    epigrafe: { b: esc.epigrafe.b.trim(), t: esc.epigrafe.t.trim() },
    arte: E.arteDeCapas(esc.capas),
    globos: esc.globo.t.trim() ? [{ t: esc.globo.t.trim(), lado: esc.globo.lado }] : [],
    alt: esc.alt.trim(),
  };
  try {
    const plantilla = plantillaVineta(datos, { anterior: { id: padre.id, relay }, capitulo, fuentes: esc.fuentes.filter((f) => /^https?:\/\//.test(f)), zaps, idioma: esc.idioma || idioma() });
    const ev = await N.firmar(plantilla);
    const r = await N.publicar(ajustes.relays, ev);
    if (!r.ok) throw new Error(t('Ningún relay aceptó la viñeta. {e}', { e: r.errores[0] || '' }));
    agregarEvento(ev);
    recalcular();
    suscribirZaps(ev.created_at - 60);
    esc = E.escenaInicial();
    guardarBorrador();
    toast(t('¡Publicada! Llegó a {ok} de {total} relays.', r));
    irA('v', leerVineta(ev));
  } catch (e) { toast(e.message, 5000); }
}

// ---------- Diálogos ----------
function abrirDialogo(contenido) {
  const velo = $('#velo');
  const d = $('#dialogo');
  d.innerHTML = '';
  d.append(...contenido, h('button', { class: 'btn ghost chico', type: 'button', onclick: cerrarDialogo }, t('Cerrar')));
  velo.hidden = false;
  d.querySelector('button, input')?.focus();
}
function cerrarDialogo() { $('#velo').hidden = true; }

function abrirEntrar(despues) {
  const listo = (s) => { cerrarDialogo(); render(); toast(t('Hola, {nombre}.', { nombre: N.nombreCorto(s.pubkey) })); N.cargarPerfiles(ajustes.relays, [s.pubkey]).then(render); despues?.(); };
  const inNsec = h('input', { class: 'campo', type: 'password', placeholder: 'nsec1…', autocomplete: 'off' });
  abrirDialogo([
    h('h3', {}, t('Entrar con Nostr')),
    h('p', { class: 'muted' }, t('Tu identidad firma cada viñeta que publicás. Nadie puede editarla ni hacerse pasar por vos.')),
    h('button', { class: 'opcion', type: 'button', onclick: async () => { try { listo(await N.entrarConExtension()); } catch (e) { toast(e.message); } } },
      h('b', {}, t('Usar mi extensión')), t(N.hayExtension() ? 'Alby, nos2x, Keys.band u otra extensión NIP-07.' : 'No detecté ninguna extensión en este navegador.')),
    h('button', { class: 'opcion', type: 'button', onclick: () => listo(N.crearClaveLocal()) },
      h('b', {}, t('Crear una identidad nueva acá')), t('Para quien todavía no usa Nostr. Se guarda en este navegador: después la podés exportar desde Ajustes.')),
    h('div', { class: 'grupo' }, h('b', {}, t('Ya tengo una clave')),
      h('span', { class: 'muted' }, t('Pegarla en una web es riesgoso: mejor usá una extensión.')), inNsec,
      h('button', { class: 'btn chico blanco', type: 'button', onclick: () => { try { listo(N.importarNsec(inNsec.value)); } catch (e) { toast(e.message); } } }, t('Entrar con esta clave'))),
  ]);
}

function abrirAjustes() {
  const s = N.sesion();
  const taRelays = h('textarea', { class: 'campo', rows: 5 }, ajustes.relays.join('\n'));
  const taCur = h('textarea', { class: 'campo', rows: 3 }, ajustes.curadores.join('\n'));
  const nsecBox = h('div', { class: 'factura', hidden: true });
  const selIdioma = h('select', { class: 'campo', onchange: (e) => elegirIdioma(e.target.value) },
    Object.entries(IDIOMAS).map(([k, nombre]) => h('option', { value: k, lang: k, selected: idioma() === k }, nombre)));
  abrirDialogo([
    h('h3', {}, t('Ajustes')),
    s ? h('div', { class: 'grupo' }, h('b', {}, t('Tu identidad')),
      h('span', { class: 'factura' }, aNpub(s.pubkey)),
      s.tipo === 'local' ? h('div', { class: 'fila' },
        h('button', { class: 'btn chico blanco', type: 'button', onclick: () => { nsecBox.textContent = N.exportarNsec(); nsecBox.hidden = false; } }, t('Mostrar mi clave privada')),
        h('span', { class: 'muted' }, t('Guardala en un lugar seguro: si borrás el navegador, se pierde.'))) : null,
      nsecBox,
      h('button', { class: 'btn chico rojo', type: 'button', onclick: () => { N.salir(); cerrarDialogo(); render(); } }, t('Salir'))) : null,
    h('label', { class: 'campo' }, t('Idioma'), selIdioma),
    h('label', { class: 'campo' }, t('Relays (uno por línea)'), taRelays),
    h('label', { class: 'campo' }, t('Curadores (npub, una por línea; la primera es la autora del génesis)'), taCur),
    h('div', { class: 'fila' },
      h('button', { class: 'btn chico', type: 'button', onclick: () => {
        const relays = taRelays.value.split(/\s+/).map((x) => x.trim()).filter((x) => /^wss?:\/\//.test(x));
        const curadores = taCur.value.split(/\s+/).map((x) => x.trim()).filter((x) => aHex(x));
        if (!relays.length) { toast(t('Poné al menos un relay (wss://…).')); return; }
        ajustes = { relays, curadores: curadores.length ? curadores : CONFIG.curadores };
        try { localStorage.setItem(CLAVE_AJUSTES, JSON.stringify(ajustes)); } catch (e) { /* nada */ }
        reiniciar();
        cerrarDialogo();
        toast(t('Ajustes guardados.'));
      } }, t('Guardar')),
      h('button', { class: 'btn chico blanco', type: 'button', onclick: () => { try { localStorage.removeItem(CLAVE_AJUSTES); } catch (e) { /* nada */ } ajustes = cargarAjustes(); reiniciar(); cerrarDialogo(); } }, t('Volver a los de fábrica'))),
  ]);
}

function abrirZap(v) {
  let monto = 100;
  const partes = () => N.repartir(v, monto);
  const resumen = h('p', { class: 'muted' });
  const pintarResumen = () => {
    resumen.textContent = partes().map((p) => t('{sats} sats a {nombre}', { sats: fmt(p.sats), nombre: N.nombreCorto(p.pubkey) })).join(' · ');
  };
  const inComentario = h('input', { class: 'campo', maxlength: 140, placeholder: t('Un comentario (opcional)') });
  const montos = h('div', { class: 'fila' }, [21, 100, 500, 1000, 5000].map((m) => h('button', {
    class: `chip${m === monto ? ' sel' : ''}`, type: 'button', 'aria-pressed': String(m === monto),
    onclick: (e) => { monto = m; montos.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); inOtro.value = ''; pintarResumen(); },
  }, `${fmt(m)}`)));
  const inOtro = h('input', { class: 'campo', type: 'number', min: 1, placeholder: t('Otro monto en sats'), oninput: (e) => { const n = parseInt(e.target.value, 10); if (n > 0) { monto = n; pintarResumen(); } } });
  const salida = h('div', { class: 'qr' });
  pintarResumen();
  N.cargarPerfiles(ajustes.relays, partes().map((p) => p.pubkey)).then(pintarResumen);
  abrirDialogo([
    h('h3', {}, t('⚡ Zapear esta viñeta')),
    v.zaps.length ? h('p', { class: 'muted' }, t('Esta viñeta reparte sus zaps entre su autor y la creadora de la historieta.')) : null,
    montos, inOtro, inComentario, resumen,
    h('button', { class: 'btn', type: 'button', onclick: async () => {
      salida.innerHTML = '';
      salida.append(h('p', {}, t('Pidiendo facturas…')));
      try {
        const facturas = [];
        for (const p of partes()) facturas.push(await N.pedirFactura({ relays: ajustes.relays, vineta: v, destinatario: p.pubkey, sats: p.sats, comentario: inComentario.value }));
        salida.innerHTML = '';
        let pagadas = 0;
        if (window.webln) {
          try { for (const f of facturas) { await N.pagarConWebLN(f.factura); pagadas++; } } catch (e) { /* sigue con QR */ }
        }
        if (pagadas === facturas.length) { salida.append(h('p', {}, t('¡Pagado! El zap aparece en unos segundos.'))); return; }
        for (const f of facturas.slice(pagadas)) {
          const img = h('img', { alt: t('Código QR de la factura para {nombre}', { nombre: N.nombreCorto(f.destinatario) }) });
          img.src = await QRCode.toDataURL(f.factura.toUpperCase(), { margin: 1, width: 480 });
          salida.append(
            h('p', {}, t('{sats} sats para {nombre}', { sats: fmt(f.sats), nombre: N.nombreCorto(f.destinatario) })), img,
            h('div', { class: 'factura' }, f.factura),
            h('div', { class: 'fila' },
              h('a', { class: 'btn chico', href: `lightning:${f.factura}` }, t('Abrir billetera')),
              h('button', { class: 'btn chico blanco', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(f.factura); toast(t('Factura copiada.')); } catch (e) { toast(t('No pude copiar: seleccioná el texto.')); } } }, t('Copiar'))));
        }
      } catch (e) { salida.innerHTML = ''; salida.append(h('p', {}, e.message)); }
    } }, t('Pedir factura')),
    salida,
  ]);
}

// ---------- Navegación ----------
function irA(vista, v) {
  S.vista = vista;
  if (vista === 'v') S.foco = v;
  let hash = vista;
  if (vista === 'v' && v) hash = `v-${v.id.slice(0, 16)}`;
  if (vista === 'leer') hash = `pag-${S.pagina}`;
  try { history.replaceState(null, '', `#${hash}`); } catch (e) { /* nada */ }
  render();
  $('#stage').scrollTop = 0;
}

function leerHash() {
  const hs = location.hash.slice(1);
  if (hs.startsWith('pag-')) { S.vista = 'leer'; S.pagina = parseInt(hs.slice(4), 10) || 0; return; }
  if (hs.startsWith('v-')) {
    const pref = hs.slice(2);
    const v = [...(S.historia?.porId.values() || [])].find((x) => x.id.startsWith(pref));
    S.vista = 'v'; S.foco = v || null; S._focoPendiente = v ? null : pref; return;
  }
  if (['ramas', 'crear', 'curar'].includes(hs)) S.vista = hs;
  if (hs === 'crear') S.padreElegido = false;
}

function render() {
  if (!S.historia) return;
  if (S._focoPendiente) {
    const v = [...S.historia.porId.values()].find((x) => x.id.startsWith(S._focoPendiente));
    if (v) { S.foco = v; S._focoPendiente = null; }
  }
  for (const id of ['leer', 'ramas', 'v', 'crear', 'curar']) $(`#vista-${id}`).hidden = S.vista !== id;
  $('#pager').hidden = S.vista !== 'leer';
  document.querySelectorAll('.nav [data-vista]').forEach((b) => {
    const activa = b.dataset.vista === S.vista || (b.dataset.vista === 'ramas' && S.vista === 'v');
    if (activa) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('#nav-curar').hidden = !esCurador();
  const s = N.sesion();
  $('#nav-yo').textContent = s ? N.nombreCorto(s.pubkey) : t('Entrar');
  $('#aviso').hidden = !!autoraHex();
  if (S.vista === 'leer') renderLector();
  else if (S.vista === 'ramas') { $('#label').textContent = t('Ramas'); renderRamas(); }
  else if (S.vista === 'v') { $('#label').textContent = t('Ramas'); renderFoco(); }
  else if (S.vista === 'crear') { $('#label').textContent = t('Nueva viñeta'); renderCrear(); }
  else if (S.vista === 'curar') { $('#label').textContent = t('Curaduría'); renderCurar(); }
}

function reiniciar() {
  zapsEscuchados.clear();
  S.eventos.clear(); S.etiquetas.clear(); S.borradas.clear(); S.zaps.clear(); S.recibos.clear();
  sembrarGenesis();
  recalcular();
  render();
  conectar();
}

// ---------- Idioma ----------
// Textos fijos de index.html: data-i18n (texto), -html, -aria, -title y -content.
function aplicarTextosFijos() {
  document.documentElement.lang = idioma();
  document.title = t('La Historieta de Bitcoin · edición infinita sobre Nostr');
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of document.querySelectorAll('[data-i18n-content]')) el.setAttribute('content', t(el.dataset.i18nContent));
  // El botón muestra el otro idioma: el que vas a elegir al tocarlo.
  const otro = idioma() === 'es' ? 'en' : 'es';
  const b = $('#nav-idioma');
  b.textContent = otro.toUpperCase();
  b.lang = otro;
  b.title = IDIOMAS[otro];
  b.setAttribute('aria-label', IDIOMAS[otro]);
}

function elegirIdioma(l) {
  if (l === idioma()) return;
  cambiarIdioma(l);
  aplicarTextosFijos();
  cerrarDialogo();
  recalcular();
  render();
  actualizarEstado();
}

// ---------- Arranque ----------
function iniciar() {
  aplicarTextosFijos();
  $('#nav-idioma').addEventListener('click', () => elegirIdioma(idioma() === 'es' ? 'en' : 'es'));
  document.getElementById('biblioteca').innerHTML = `<defs>${biblioteca}</defs>`;
  registrarBiblioteca(biblioteca);
  $('#prev').addEventListener('click', () => irPagina(S.pagina - 1));
  $('#next').addEventListener('click', () => irPagina(S.pagina + 1));
  document.querySelectorAll('.nav [data-vista]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.vista === 'crear') continuar(S.historia?.cola); else irA(b.dataset.vista);
  }));
  $('#nav-yo').addEventListener('click', () => (N.sesion() ? abrirAjustes() : abrirEntrar()));
  $('#nav-ajustes').addEventListener('click', abrirAjustes);
  window.addEventListener('hashchange', () => { leerHash(); render(); $('#stage').scrollTop = 0; });
  $('#velo').addEventListener('click', (e) => { if (e.target.id === 'velo') cerrarDialogo(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') cerrarDialogo();
    if (S.vista !== 'leer' || /input|textarea|select/i.test(document.activeElement?.tagName || '')) return;
    if (e.key === 'ArrowRight') irPagina(Math.min(S.pagina + 1, S.paginas.length - 1));
    else if (e.key === 'ArrowLeft') irPagina(Math.max(S.pagina - 1, 0));
  });
  let sx = 0; let sy = 0;
  const stage = $('#stage');
  stage.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY; }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    if (S.vista !== 'leer') return;
    const t = e.changedTouches[0]; const dx = t.clientX - sx; const dy = t.clientY - sy;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) irPagina(Math.max(0, Math.min(S.paginas.length - 1, S.pagina + (dx < 0 ? 1 : -1))));
  }, { passive: true });

  sembrarGenesis();
  recalcular();
  leerHash();
  render();
  N.restaurarSesion().then((s) => { if (s) { render(); N.cargarPerfiles(ajustes.relays, [s.pubkey]).then(render); } });
  conectar();
}

iniciar();
