// La Historieta de Bitcoin, edición infinita sobre Nostr.
// Lector del tronco, navegador de ramas, editor de viñetas y curaduría.

import { CONFIG } from './config.js';
import genesis from './genesis.json';
import biblioteca from './library.svg';
import {
  FONDOS, MAX_ARTE, KIND_VINETA, KIND_ETIQUETA, ETIQUETA_NS, TAG_T,
  aHex, aNpub, eventosGenesis, leerVineta, armarHistoria, plantillaVineta, plantillaCanon, plantillaOcultar, validarRecibo, tag, tipoEtiqueta, moderacion, esUrl, leerReaccion, plantillaReaccion,
} from './model.js';
import { registrarBiblioteca, figuraVineta, globosDe, svgDeArte } from './render.js';
import bibliotecaExtra from './library-extra.svg';
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
  borradas: new Set(),   // "pubkey:id" de etiquetas que su curador borró (kind 5)
  zaps: new Map(),       // id viñeta -> sats (sólo recibos validados)
  recibos: new Map(),    // id -> recibo kind 9735 esperando a que llegue su viñeta
  recibosVistos: new Set(),
  facturas: new Set(),   // bolt11 ya sumadas (un pago cuenta una sola vez)
  moderacion: { ocultas: new Set(), silenciados: new Set() },
  likes: new Map(),      // id viñeta -> Map(pubkey -> reacción): una por persona
  sigueCurador: new Set(), // a quiénes siguen los curadores (kind 3): "gente conocida"
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
  const etiquetas = [...S.etiquetas.values()].filter((e) => !borrada(e));
  S.moderacion = moderacion(etiquetas, curadoresHex());
  const vinetas = [...S.eventos.values()].map(leerVineta).filter(Boolean).filter((v) => !estaOculta(v)).map(traducirGenesis);
  S.historia = armarHistoria({ vinetas, etiquetas, curadores: curadoresHex() });
  procesarRecibos();
}

const borrada = (e) => S.borradas.has(`${e.pubkey}:${e.id}`);
// Lo que ocultaron los curadores no se muestra (el génesis no se puede ocultar).
const estaOculta = (v) => !esGenesis(v) && (S.moderacion.ocultas.has(v.id) || S.moderacion.silenciados.has(v.pubkey));

// Un recibo de zap cuenta si es válido (NIP-57) y si lo firmó el servidor Lightning
// del destinatario. Si no, cualquiera podría inventar sats.
function procesarRecibos() {
  const porId = S.historia?.porId;
  if (!porId) return;
  for (const [id, ev] of S.recibos) {
    const r = validarRecibo(ev, { vinetas: porId, verificar: N.verifyEvent, satsDeFactura: N.getSatoshisAmountFromBolt11 });
    if (!r && !porId.has(tag(ev, 'e')?.[1])) continue; // todavía no llegó su viñeta
    S.recibos.delete(id);
    if (!r) continue;
    N.datosLnurl(ajustes.relays, r.destinatario).then((ln) => {
      if (!ln || ln.nostrPubkey !== r.proveedor || S.facturas.has(r.factura)) return;
      S.facturas.add(r.factura);
      S.zaps.set(r.vineta, (S.zaps.get(r.vineta) || 0) + r.sats);
      pedirRender();
    });
  }
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
    // Se anota aunque la etiqueta todavía no haya llegado: sólo vale para las del mismo curador.
    if (!curadoresHex().includes(ev.pubkey) || !N.verifyEvent(ev)) return false;
    let cambio = false;
    for (const t of ev.tags) {
      const k = `${ev.pubkey}:${t[1]}`;
      if (t[0] === 'e' && !S.borradas.has(k)) { S.borradas.add(k); cambio = true; }
    }
    return cambio;
  }
  if (ev.kind === 7) {
    const r = leerReaccion(ev);
    if (!r || !r.positiva || !N.verifyEvent(ev)) return false;
    if (!S.likes.has(r.vineta)) S.likes.set(r.vineta, new Map());
    const m = S.likes.get(r.vineta);
    if (m.has(r.pubkey)) return false;
    m.set(r.pubkey, r);
    return true;
  }
  if (ev.kind === 9735) {
    if (S.recibosVistos.has(ev.id)) return false;
    S.recibosVistos.add(ev.id);
    S.recibos.set(ev.id, ev);
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
    const [vs, ets, bor, contactos] = await Promise.all([
      N.consultar(relays, { kinds: [KIND_VINETA], '#t': [TAG_T], limit: 5000 }),
      cur.length ? N.consultar(relays, { kinds: [KIND_ETIQUETA], '#L': [ETIQUETA_NS], authors: cur, limit: 5000 }) : [],
      cur.length ? N.consultar(relays, { kinds: [5], authors: cur, '#k': [String(KIND_ETIQUETA)], limit: 2000 }) : [],
      cur.length ? N.consultar(relays, { kinds: [3], authors: cur }) : [],
    ]);
    S.sigueCurador = new Set(cur);
    const ultima = new Map();
    for (const c of contactos) if (!ultima.has(c.pubkey) || ultima.get(c.pubkey).created_at < c.created_at) ultima.set(c.pubkey, c);
    for (const c of ultima.values()) for (const t of c.tags) if (t[0] === 'p' && /^[0-9a-f]{64}$/.test(t[1] || '')) S.sigueCurador.add(t[1]);
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
    subs.push(N.suscribir(ajustes.relays, { kinds: [9735, 7], '#e': ids, since: desde }, (ev) => { if (agregarEvento(ev)) pedirRender(); }));
  }
}

async function cargarZaps() {
  const ids = [...S.eventos.keys()];
  for (let i = 0; i < ids.length; i += 150) {
    try {
      const evs = await N.consultar(ajustes.relays, { kinds: [9735, 7], '#e': ids.slice(i, i + 150), limit: 5000 });
      evs.forEach(agregarEvento);
    } catch (e) { /* relays sin respuesta */ }
  }
  pedirRender();
}

// Trae de los relays una viñeta, su anterior y sus continuaciones (con sus zaps).
// Sirve para los enlaces directos y para las viñetas que no entraron en la carga inicial.
const alrededorPedido = new Set();
const buscando = new Set();
async function cargarAlrededor(id, pistas = []) {
  if (!/^[0-9a-f]{64}$/.test(id) || alrededorPedido.has(id)) return;
  alrededorPedido.add(id);
  buscando.add(id);
  const relays = [...new Set([...ajustes.relays, ...pistas])];
  const nuevos = [];
  const sumar = (evs) => { for (const ev of evs) if (ev.kind === KIND_VINETA && agregarEvento(ev)) nuevos.push(ev); };
  try {
    const [propia, hijos] = await Promise.all([
      S.eventos.has(id) ? [] : N.consultar(relays, { ids: [id] }),
      N.consultar(relays, { kinds: [KIND_VINETA], '#e': [id], limit: 500 }),
    ]);
    sumar(propia); sumar(hijos);
    const ant = S.eventos.has(id) ? leerVineta(S.eventos.get(id))?.anterior : null;
    if (ant && !S.eventos.has(ant)) sumar(await N.consultar(relays, { ids: [ant] }));
    if (nuevos.length) {
      (await N.consultar(relays, { kinds: [9735, 7], '#e': nuevos.map((e) => e.id), limit: 2000 })).forEach(agregarEvento);
      N.cargarPerfiles(relays, nuevos.map((e) => e.pubkey)).then(() => render());
    }
  } catch (e) {
    alrededorPedido.delete(id); // se reintenta la próxima vez
  }
  buscando.delete(id);
  pedirRender();
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
const likesDe = (v) => S.likes.get(v.id)?.size || 0;
const meGusta = (v) => { const s = N.sesion(); return !!s && !!S.likes.get(v.id)?.has(s.pubkey); };
// Para ordenar: primero los sats, después los me gusta.
const apoyo = (a, b) => (satsDe(b) - satsDe(a)) || (likesDe(b) - likesDe(a));
const esCurador = () => { const s = N.sesion(); return !!s && curadoresHex().includes(s.pubkey); };
const capituloDe = (v) => v.capitulo || { n: 0, titulo: '' };
// Del génesis de verdad: el tag "genesis" sólo vale si lo firmó la autora.
const esGenesis = (v) => v.genesis != null && v.pubkey === autoraHex();

function estadoDe(v) {
  if (enTronco(v)) return { clase: 'canon', texto: t('Tronco') };
  if (S.historia?.cola && v.anterior === S.historia.cola.id) return { clase: 'candidata', texto: t('Candidata') };
  return { clase: 'rama', texto: t('Rama') };
}

// Las ramas de una viñeta: todo lo que la continúa, menos la viñeta que sigue en el tronco.
const ramasDe = (v) => hijosDe(v).filter((x) => !(enTronco(v) && enTronco(x)));

function pieDe(v, { mostrarEstado = false } = {}) {
  const n = ramasDe(v).length;
  const autor = t(esGenesis(v) ? 'génesis · {nombre}' : 'por {nombre}', { nombre: N.nombreCorto(v.pubkey) });
  const est = estadoDe(v);
  return h('div', { class: 'pie' },
    mostrarEstado ? h('span', { class: `sello ${est.clase}` }, est.texto) : null,
    v.idioma && v.idioma !== idioma() ? h('span', { class: 'sello', title: t('Escrita en {idioma}', { idioma: NOMBRE_IDIOMA[v.idioma] ? t(NOMBRE_IDIOMA[v.idioma]) : v.idioma }), lang: v.idioma }, v.idioma.toUpperCase()) : null,
    h('a', { class: 'quien', href: `#${aNpub(v.pubkey)}`, title: t('Ver todo lo de {nombre}', { nombre: N.nombreCorto(v.pubkey) }) }, autor),
    h('button', { class: 'zap', type: 'button', title: t('Zapear esta viñeta'), onclick: () => abrirZap(v) }, `⚡ ${fmt(satsDe(v))}`),
    h('button', { class: `like${meGusta(v) ? ' sel' : ''}`, type: 'button', 'aria-pressed': String(meGusta(v)), title: t(meGusta(v) ? 'Ya te gusta (tocá para sacarlo)' : 'Me gusta'), onclick: () => alternarLike(v) }, `♥ ${fmt(likesDe(v))}`),
    h('button', { type: 'button', title: t('Ver continuaciones'), onclick: () => irA('v', v) }, t(n === 1 ? '↳ {n} rama' : '↳ {n} ramas', { n })),
    h('button', { type: 'button', title: t('Escribir lo que sigue'), onclick: () => continuar(v) }, t('✎ Seguir')),
    h('button', { type: 'button', title: t('Compartir'), 'aria-label': t('Compartir'), onclick: () => abrirCompartir(v) }, '↗'),
  );
}

async function alternarLike(v) {
  if (!N.sesion()) { abrirEntrar(() => alternarLike(v)); return; }
  const yo = N.sesion().pubkey;
  try {
    const previa = S.likes.get(v.id)?.get(yo);
    if (previa) {
      const ev = await N.firmar({ kind: 5, created_at: Math.floor(Date.now() / 1000), content: '', tags: [['e', previa.id], ['k', '7']] });
      S.likes.get(v.id).delete(yo);
      render();
      await N.publicar(ajustes.relays, ev);
    } else {
      const ev = await N.firmar(plantillaReaccion(v, ajustes.relays[0]));
      agregarEvento(ev);
      render();
      await N.publicar(ajustes.relays, ev);
    }
  } catch (e) { toast(e.message); }
}

// ---------- Compartir ----------
const enlaceDe = (v) => `${location.origin}${location.pathname}#${N.neventDe(v, ajustes.relays)}`;

function abrirCompartir(v, { recien = false } = {}) {
  const url = enlaceDe(v);
  const nevent = N.neventDe(v, ajustes.relays);
  const resumen = [v.epigrafe.b, v.epigrafe.t].filter(Boolean).join(' ').slice(0, 200);
  const mia = N.sesion()?.pubkey === v.pubkey;
  const texto = h('textarea', { class: 'campo', rows: 5, maxlength: 1000 },
    `${t(mia ? 'Sumé una viñeta a La Historieta de Bitcoin, la historieta que escribimos entre todos sobre Nostr ⚡' : 'Una viñeta de La Historieta de Bitcoin, la historieta que escribimos entre todos sobre Nostr ⚡')}\n\n«${resumen}»\n\n${url}`);
  const inUrl = h('input', { class: 'campo', value: url, readonly: true, onfocus: (e) => e.target.select() });
  abrirDialogo([
    h('h3', {}, recien ? t('¡Publicada! Contale a tu gente') : t('Compartir esta viñeta')),
    h('div', { class: 'mini' }, figuraVineta(v)),
    inUrl,
    h('div', { class: 'fila' },
      h('button', { class: 'btn chico', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(url); toast(t('Enlace copiado.')); } catch (e) { inUrl.select(); toast(t('No pude copiar: seleccioná el texto.')); } } }, t('Copiar enlace')),
      navigator.share ? h('button', { class: 'btn chico blanco', type: 'button', onclick: () => navigator.share({ title: t('La Historieta de Bitcoin'), text: resumen, url }).catch(() => {}) }, t('Compartir…')) : null),
    h('div', { class: 'grupo' }, h('b', {}, t('Publicar una nota en Nostr')),
      h('span', { class: 'muted' }, t('Sale en Damus, Primal y el resto de los clientes, con la viñeta citada.')),
      texto,
      h('button', { class: 'btn chico', type: 'button', onclick: async (e) => {
        if (!N.sesion()) { abrirEntrar(() => abrirCompartir(v, { recien })); return; }
        e.currentTarget.disabled = true;
        try {
          const relay = ajustes.relays[0];
          const nota = await N.firmar({
            kind: 1, created_at: Math.floor(Date.now() / 1000),
            content: `${texto.value.trim()}\n\nnostr:${nevent}`,
            tags: [['q', v.id, relay, v.pubkey], ['p', v.pubkey], ['t', 'historietabitcoin'], ['t', 'bitcoin'], ['t', 'nostr']],
          });
          const r = await N.publicar(ajustes.relays, nota);
          cerrarDialogo();
          toast(t('Nota publicada. Llegó a {ok} de {total} relays.', r));
        } catch (err) { toast(err.message); e.currentTarget.disabled = false; }
      } }, t(N.sesion() ? 'Publicar nota' : 'Entrar y publicar nota'))),
  ]);
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
  const comunidad = todas.filter((v) => !esGenesis(v));
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
      extra || null,
      esCurador() && !esGenesis(v) ? accionesModeracion(v) : null));
}

function accionesModeracion(v) {
  return h('span', { class: 'moderar' },
    h('button', { class: 'btn chico ghost', type: 'button', title: t('Nadie la va a ver en la app (podés deshacerlo desde Curaduría).'), onclick: () => ocultar({ vineta: v }) }, t('Ocultar')),
    N.sesion()?.pubkey !== v.pubkey && !curadoresHex().includes(v.pubkey)
      ? h('button', { class: 'btn chico ghost', type: 'button', title: t('Oculta todas sus viñetas, también las que publique después.'), onclick: () => ocultar({ pubkey: v.pubkey }) }, t('Silenciar autor'))
      : null);
}

// "Gente conocida": la siguen los curadores o ya tiene viñetas en el tronco.
const esConocido = (pubkey) => S.sigueCurador.has(pubkey) || S.historia.tronco.some((v) => v.pubkey === pubkey && !esGenesis(v));
const CLAVE_FILTRO = 'historieta.soloConocidos';
function soloConocidos() { try { return localStorage.getItem(CLAVE_FILTRO) === '1'; } catch (e) { return false; } }

function renderRamas() {
  const H = S.historia;
  const cont = $('#vista-ramas');
  cont.innerHTML = '';
  const todas = [...H.porId.values()].filter((v) => !esGenesis(v)).sort((a, b) => b.created_at - a.created_at);
  const filtrar = soloConocidos();
  const comunidad = filtrar ? todas.filter((v) => esConocido(v.pubkey)) : todas;
  const filtro = h('label', { class: 'filtro' },
    h('input', { type: 'checkbox', checked: filtrar, onchange: (e) => { try { localStorage.setItem(CLAVE_FILTRO, e.target.checked ? '1' : '0'); } catch (err) { /* nada */ } renderRamas(); } }),
    t('Sólo gente conocida (la siguen los curadores o ya está en el tronco)'),
    filtrar && todas.length > comunidad.length ? h('span', { class: 'muted' }, t(' · {n} ocultas por el filtro', { n: todas.length - comunidad.length })) : null);
  cont.append(h('div', { class: 'hoja' },
    h('div', {},
      h('p', { class: 'eyebrow' }, t('Ramas y propuestas')),
      h('h2', { class: 'h-title' }, t('Lo último que sumó la comunidad')),
      h('p', { class: 'lead' }, t('Cada viñeta continúa a otra. Las que aprueban los curadores pasan al tronco; el resto forma ramas: historias alternativas, chistes y episodios que cuelgan de la historia principal.')),
      filtro),
    comunidad.length
      ? h('div', { class: 'lista' }, comunidad.slice(0, 120).map((v) => tarjeta(v)))
      : h('div', { class: 'vacio' }, t('Todavía no hay viñetas de la comunidad. '), h('button', { class: 'btn chico', type: 'button', onclick: () => continuar(H.cola) }, t('Hacé la primera')))));
}

function renderFoco() {
  const v = S.foco;
  const cont = $('#vista-v');
  cont.innerHTML = '';
  if (!v) {
    const msj = S._focoPendiente && buscando.has(S._focoPendiente) ? t('Buscando la viñeta en los relays…') : t('No encontré esa viñeta.');
    cont.append(h('div', { class: 'hoja' }, h('div', { class: 'vacio' }, msj)));
    return;
  }
  cargarAlrededor(v.id);
  const hijos = hijosDe(v).slice().sort((a, b) => (enTronco(b) - enTronco(a)) || apoyo(a, b) || (a.created_at - b.created_at));
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
          h('button', { class: 'btn chico', type: 'button', onclick: () => continuar(v) }, t('✎ Continuar desde acá')),
          v.arte ? h('button', { class: 'btn chico blanco', type: 'button', title: t('Abre el editor con este dibujo para que lo cambies'), onclick: () => usarComoBase(v) }, t('Usar este dibujo')) : null),
        v.fuentes.length ? h('p', { class: 'muted' }, t('Fuentes: '), ...v.fuentes.map((f) => h('a', { href: f, target: '_blank', rel: 'noopener noreferrer' }, `${hostDe(f)} `))) : null,
        mapaRamas(v)),
      h('div', {},
        h('h3', {}, hijos.length ? t(hijos.length === 1 ? '{n} continuación' : '{n} continuaciones', { n: hijos.length }) : t('Sin continuaciones todavía')),
        hijos.length
          ? h('div', { class: 'lista' }, hijos.map((hj) => tarjeta(hj, h('button', { class: 'btn chico ghost', type: 'button', onclick: () => irA('v', hj) }, t('Seguir esta rama →')))))
          : h('div', { class: 'vacio' }, t('Nadie siguió desde acá. '), h('button', { class: 'btn chico', type: 'button', onclick: () => continuar(v) }, t('Escribí lo que sigue')))))));
}

// ---------- Perfil de autor ----------
const autorPedido = new Set();
async function cargarDeAutor(pk) {
  if (autorPedido.has(pk)) return;
  autorPedido.add(pk);
  N.cargarPerfiles(ajustes.relays, [pk]).then(() => render());
  try {
    const evs = await N.consultar(ajustes.relays, { kinds: [KIND_VINETA], authors: [pk], '#t': [TAG_T], limit: 1000 });
    const nuevos = evs.filter(agregarEvento);
    for (let i = 0; i < nuevos.length; i += 150) {
      (await N.consultar(ajustes.relays, { kinds: [9735, 7], '#e': nuevos.slice(i, i + 150).map((e) => e.id), limit: 5000 })).forEach(agregarEvento);
    }
  } catch (e) { autorPedido.delete(pk); }
  pedirRender();
}

function renderAutor() {
  const pk = S.autor;
  const cont = $('#vista-autor');
  cont.innerHTML = '';
  if (!pk) { cont.append(h('div', { class: 'hoja' }, h('div', { class: 'vacio' }, t('No encontré a esa persona.')))); return; }
  cargarDeAutor(pk);
  const p = N.perfil(pk);
  const suyas = [...S.historia.porId.values()].filter((v) => v.pubkey === pk).sort((a, b) => b.created_at - a.created_at);
  const enElTronco = suyas.filter((v) => enTronco(v)).length;
  const sats = suyas.reduce((a, v) => a + satsDe(v), 0);
  const likes = suyas.reduce((a, v) => a + likesDe(v), 0);
  const yo = N.sesion()?.pubkey === pk;
  const silenciado = S.moderacion.silenciados.has(pk);
  cont.append(h('div', { class: 'hoja' },
    h('div', {},
      h('p', { class: 'eyebrow' }, yo ? t('Tu perfil') : curadoresHex().includes(pk) ? t('Curaduría') : t('Autor')),
      h('h2', { class: 'h-title' }, N.nombreCorto(pk)),
      p?.about ? h('p', { class: 'lead' }, String(p.about).slice(0, 300)) : null,
      h('p', { class: 'factura' }, aNpub(pk))),
    silenciado ? h('div', { class: 'aviso' }, t('Los curadores silenciaron a esta persona: sus viñetas no se muestran.')) : null,
    h('div', { class: 'stats' },
      h('span', {}, h('b', {}, fmt(suyas.length)), t(' viñetas')),
      h('span', {}, h('b', {}, fmt(enElTronco)), t(' en el tronco')),
      h('span', {}, h('b', {}, fmt(sats)), t(' sats en zaps')),
      h('span', {}, h('b', {}, fmt(likes)), t(' me gusta'))),
    suyas.length
      ? h('div', { class: 'lista' }, suyas.slice(0, 200).map((v) => tarjeta(v)))
      : h('div', { class: 'vacio' }, autorPedido.has(pk) && !S.conectado ? t('Buscando sus viñetas…') : t('Todavía no publicó viñetas.'),
        yo ? h('button', { class: 'btn chico', type: 'button', onclick: () => continuar(S.historia.cola) }, t('Hacé tu primera viñeta')) : null)));
}

// ---------- Mapa de ramas ----------
// El camino desde el tronco hasta la viñeta, y el árbol de lo que sigue (3 niveles).
function mapaRamas(v) {
  const porId = S.historia.porId;
  const camino = [];
  // Una viñeta del tronco no necesita camino: ya está en la historia principal.
  for (let x = !enTronco(v) && v.anterior ? porId.get(v.anterior) : null; x && camino.length < 40; x = x.anterior ? porId.get(x.anterior) : null) {
    camino.unshift(x);
    if (enTronco(x)) break;
  }
  const memo = new Map();
  const total = (y, prof = 0) => {
    if (memo.has(y.id)) return memo.get(y.id);
    const n = prof > 60 ? 0 : hijosDe(y).reduce((a, x) => a + 1 + total(x, prof + 1), 0);
    memo.set(y.id, n);
    return n;
  };
  const orden = (a, b) => (enTronco(b) - enTronco(a)) || apoyo(a, b) || (a.created_at - b.created_at);
  const nodo = (y) => h('button', {
    class: `nodo ${estadoDe(y).clase}${y.id === v.id ? ' actual' : ''}`, type: 'button',
    'aria-current': y.id === v.id ? 'true' : null, title: [y.epigrafe.b, y.epigrafe.t].filter(Boolean).join(' '),
    onclick: () => irA('v', y),
  }, h('span', { class: 'punto', 'aria-hidden': 'true' }), (y.epigrafe.b || y.epigrafe.t || '…').slice(0, 40),
  satsDe(y) ? h('small', {}, ` ⚡${fmt(satsDe(y))}`) : null);
  const rama = (y, prof) => {
    const hs = hijosDe(y).slice().sort(orden);
    if (!hs.length) return null;
    const visibles = hs.slice(0, 6);
    return h('ul', {}, visibles.map((x) => {
      const debajo = total(x);
      return h('li', {}, nodo(x),
        prof < 3 ? rama(x, prof + 1) : debajo ? h('button', { class: 'mas', type: 'button', onclick: () => irA('v', x) }, t('+{n} más', { n: debajo })) : null);
    }), hs.length > visibles.length ? h('li', {}, h('button', { class: 'mas', type: 'button', onclick: () => irA('v', y) }, t('+{n} continuaciones más', { n: hs.length - visibles.length }))) : null);
  };
  return h('nav', { class: 'mapa', 'aria-label': t('Mapa de ramas') },
    h('h3', {}, t('Mapa de ramas')),
    camino.length ? h('ol', { class: 'desde' }, camino.map((x) => h('li', {}, nodo(x)))) : null,
    h('ul', { class: 'arbol' }, h('li', {}, nodo(v), rama(v, 1))));
}

function hostDe(url) {
  try { return new URL(url).hostname || url; } catch (e) { return url; }
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
  const cands = H.cola ? hijosDe(H.cola).filter((v) => !enTronco(v)).sort(apoyo) : [];
  const yo = N.sesion().pubkey;
  const misEtiquetas = [...S.etiquetas.values()].filter((e) => e.pubkey === yo && !borrada(e) && tipoEtiqueta(e) === 'canon');
  const misOcultas = [...S.etiquetas.values()].filter((e) => e.pubkey === yo && !borrada(e) && tipoEtiqueta(e) === 'oculta')
    .sort((a, b) => b.created_at - a.created_at);
  const canonComunidad = H.tronco.filter((v) => !esGenesis(v));
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
      return tarjeta(v, mias.length ? h('button', { class: 'btn chico rojo', type: 'button', onclick: () => revocar(mias, t('Sale del canon'), t('Listo, salió del canon.')) }, t('Quitar del canon')) : null);
    })) : h('div', { class: 'vacio' }, t('Todavía no aprobaste viñetas de la comunidad.')),
    h('h3', {}, t('Lo que ocultaste ({n})', { n: misOcultas.length })),
    misOcultas.length ? h('ul', { class: 'ocultas' }, misOcultas.map((e) => {
      const id = tag(e, 'e')?.[1];
      const pk = tag(e, 'p')?.[1];
      const ev = id && S.eventos.get(id);
      const desc = pk
        ? t('Autor silenciado: {nombre}', { nombre: N.nombreCorto(pk) })
        : t('Viñeta: «{x}»', { x: (ev && (leerVineta(ev)?.epigrafe.t || leerVineta(ev)?.epigrafe.b)?.slice(0, 80)) || id?.slice(0, 12) });
      return h('li', {}, h('span', {}, desc),
        h('button', { class: 'btn chico blanco', type: 'button', onclick: () => revocar([e], t('Vuelve a mostrarse'), t('Listo, se vuelve a mostrar.')) }, t('Volver a mostrar')));
    })) : h('div', { class: 'vacio' }, t('No ocultaste nada.'))));
}

async function ocultar(que) {
  try {
    const ev = await N.firmar(plantillaOcultar(que));
    const r = await N.publicar(ajustes.relays, ev);
    agregarEvento(ev);
    recalcular(); render();
    toast(t('Oculto. Llegó a {ok} de {total} relays.', r));
  } catch (e) { toast(e.message); }
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

async function revocar(etiquetas, motivo, aviso) {
  try {
    const ev = await N.firmar({ kind: 5, created_at: Math.floor(Date.now() / 1000), content: motivo, tags: [...etiquetas.map((e) => ['e', e.id]), ['k', String(KIND_ETIQUETA)]] });
    await N.publicar(ajustes.relays, ev);
    agregarEvento(ev);
    recalcular(); render();
    toast(aviso);
  } catch (e) { toast(e.message); }
}

// ---------- Editor ----------
const CLAVE_BORRADOR = 'historieta.borrador';
let esc = null;
function cargarBorrador() {
  try {
    const b = JSON.parse(localStorage.getItem(CLAVE_BORRADOR) || 'null');
    if (b?.capas) {
      const e = { ...E.escenaInicial(), ...b, sel: null };
      if (b.globo && !b.globos) e.globos = [b.globo, { t: '', lado: b.globo.lado === 'izq' ? 'der' : 'izq' }];
      delete e.globo;
      return e;
    }
  } catch (e) { /* nada */ }
  return E.escenaInicial();
}

// Deshacer / rehacer: fotos del dibujo y los textos, una por cambio terminado.
const hist = { atras: [], adelante: [], ultimo: null };
const foto = () => JSON.stringify({ fondo: esc.fondo, capas: esc.capas, globos: esc.globos, epigrafe: esc.epigrafe });
function reiniciarHistorial() { hist.atras = []; hist.adelante = []; hist.ultimo = esc ? foto() : null; }
function registrarCambio() {
  const f = foto();
  if (f === hist.ultimo) return;
  if (hist.ultimo) hist.atras.push(hist.ultimo);
  if (hist.atras.length > 100) hist.atras.shift();
  hist.adelante = [];
  hist.ultimo = f;
}
function moverHistorial(desde, hacia) {
  if (!desde.length) return;
  hacia.push(hist.ultimo);
  hist.ultimo = desde.pop();
  Object.assign(esc, JSON.parse(hist.ultimo), { sel: null });
  guardarBorrador();
  renderCrear(true);
}
const deshacer = () => moverHistorial(hist.atras, hist.adelante);
const rehacer = () => moverHistorial(hist.adelante, hist.atras);

// Remix: el dibujo de una viñeta pasa al editor como punto de partida.
function usarComoBase(v) {
  const svg = svgDeArte(v.arte, '');
  svg.setAttribute('style', 'position:absolute;left:-9999px;top:0;width:400px;height:300px');
  document.body.append(svg);
  const capas = E.capasDeArte(svg);
  svg.remove();
  if (!esc) esc = cargarBorrador();
  const hayAlgo = esc.capas.length > 1 || esc.epigrafe.t.trim() || esc.epigrafe.b.trim();
  if (hayAlgo && !confirm(t('Esto reemplaza el dibujo que tenías en el editor. ¿Seguimos?'))) return;
  esc = { ...E.escenaInicial(), fondo: v.fondo, capas, sel: null, alt: v.alt, altManual: !!v.alt };
  guardarBorrador();
  reiniciarHistorial();
  renderCrear.clave = null;
  continuar(v);
  toast(t('Listo: el dibujo está en el editor. Cambialo como quieras.'));
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

// El editor sólo se rearma si cambia lo que muestra (la viñeta que continúa, la sesión
// o el idioma). Si no, cada zap o viñeta que llega te sacaría el cursor del campo.
function renderCrear(forzar) {
  if (!esc) esc = cargarBorrador();
  const padre = S.padreElegido && S.padre && S.historia.porId.get(S.padre.id) ? S.padre : S.historia.cola;
  const cont = $('#vista-crear');
  const clave = [padre?.id, N.sesion()?.pubkey, idioma(), maxCapitulo()].join('|');
  if (!forzar && renderCrear.clave === clave && cont.childElementCount) return;
  renderCrear.clave = clave;
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
  svg.setAttribute('tabindex', '0');
  svg.setAttribute('aria-label', t('Lienzo: tocá una pieza para elegirla. Con el teclado: flechas para mover, + y − para el tamaño, Supr para borrar.'));
  art.append(svg);
  fig.append(cap, art);
  if (hist.ultimo == null) reiniciarHistorial();

  const actualizar = (soloLienzo) => {
    fig.style.setProperty('--bg', `var(--${esc.fondo})`);
    cap.innerHTML = '';
    if (esc.epigrafe.b) cap.append(h('b', {}, esc.epigrafe.b), ' ');
    cap.append(esc.epigrafe.t || (esc.epigrafe.b ? '' : t('Escribí el epígrafe…')));
    art.querySelectorAll('.bubble').forEach((b) => b.remove());
    art.append(...globosDe(esc.globos));
    E.dibujarLienzo(svg, esc);
    if (!esc.altManual) { esc.alt = E.altDeCapas(esc.capas); const a = $('#ed-alt'); if (a) a.value = esc.alt; }
    if (!soloLienzo) { guardarBorrador(); pintarSeleccion(); registrarCambio(); pintarHistorial(); }
  };
  const btnDeshacer = h('button', { class: 'btn chico blanco', type: 'button', title: 'Ctrl+Z', onclick: deshacer }, t('↶ Deshacer'));
  const btnRehacer = h('button', { class: 'btn chico blanco', type: 'button', title: 'Ctrl+Shift+Z', onclick: rehacer }, t('↷ Rehacer'));
  const pintarHistorial = () => { btnDeshacer.disabled = !hist.atras.length; btnRehacer.disabled = !hist.adelante.length; };

  // Teclado: con una pieza elegida, flechas mueven (Shift: más), + y − cambian el tamaño, Supr borra.
  renderCrear.tecla = (e) => {
    if (/input|textarea|select/i.test(document.activeElement?.tagName || '') || $('#velo').hidden === false) return;
    const z = e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey);
    if (z) { e.preventDefault(); if (e.shiftKey) rehacer(); else deshacer(); return; }
    if (e.key.toLowerCase() === 'y' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); rehacer(); return; }
    const c = esc.capas[esc.sel];
    if (!c) return;
    const paso = e.shiftKey ? 10 : 2;
    const mov = { ArrowLeft: [-paso, 0], ArrowRight: [paso, 0], ArrowUp: [0, -paso], ArrowDown: [0, paso] }[e.key];
    if (mov) { e.preventDefault(); c.x += mov[0]; c.y += mov[1]; actualizar(true); clearTimeout(renderCrear.tTecla); renderCrear.tTecla = setTimeout(() => actualizar(), 400); return; }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); E.escalar(c, 1.08); actualizar(); return; }
    if (e.key === '-' || e.key === '_') { e.preventDefault(); E.escalar(c, 1 / 1.08); actualizar(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); esc.capas.splice(esc.sel, 1); esc.sel = null; actualizar(); return; }
    if (e.key === 'Escape') { esc.sel = null; actualizar(); }
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
        c.tipo === 'pieza' || c.tipo === 'crudo' ? h('button', { class: 'btn chico blanco', type: 'button', onclick: () => { c.espejo = !c.espejo; redibujar(); } }, t('⇋ Espejar')) : null),
      h('div', { class: 'fila' },
        h('button', { class: 'btn chico blanco', type: 'button', onclick: () => { const [x] = esc.capas.splice(esc.sel, 1); esc.capas.push(x); esc.sel = esc.capas.length - 1; redibujar(); } }, t('Al frente')),
        h('button', { class: 'btn chico blanco', type: 'button', onclick: () => { const [x] = esc.capas.splice(esc.sel, 1); esc.capas.unshift(x); esc.sel = 0; redibujar(); } }, t('Al fondo')),
        h('button', { class: 'btn chico rojo', type: 'button', onclick: () => { esc.capas.splice(esc.sel, 1); esc.sel = null; redibujar(); } }, t('Borrar'))),
    );
    if (c.tipo === 'cartel' || c.tipo === 'texto') {
      sel.append(h('label', { class: 'campo' }, t('Texto'), h('input', { value: c.texto, maxlength: 40, oninput: (e) => { c.texto = e.target.value; actualizar(true); guardarBorrador(); }, onchange: () => { registrarCambio(); pintarHistorial(); } })));
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
  const alTerminar = () => { registrarCambio(); pintarHistorial(); };
  const inLead = h('input', { value: esc.epigrafe.b, maxlength: 60, placeholder: t('Ej.: Abril de 2028.'), oninput: (e) => { esc.epigrafe.b = e.target.value; actualizar(true); guardarBorrador(); }, onchange: alTerminar });
  const inTexto = h('textarea', { maxlength: 300, placeholder: t('Qué pasó, en una o dos frases.'), oninput: (e) => { esc.epigrafe.t = e.target.value; actualizar(true); guardarBorrador(); }, onchange: alTerminar }, esc.epigrafe.t);
  const globoCampos = esc.globos.map((g, i) => [
    h('input', { value: g.t, maxlength: 120, placeholder: t(i === 0 ? 'Lo que dice Sat (opcional)' : 'Otro personaje responde (opcional)'), 'aria-label': t('Globo {n}', { n: i + 1 }), oninput: (e) => { g.t = e.target.value; actualizar(true); guardarBorrador(); }, onchange: alTerminar }),
    h('select', { 'aria-label': t('Lado del globo {n}', { n: i + 1 }), onchange: (e) => { g.lado = e.target.value; actualizar(); } },
      h('option', { value: 'der', selected: g.lado !== 'izq' }, t('Globo a la derecha')),
      h('option', { value: 'izq', selected: g.lado === 'izq' }, t('Globo a la izquierda'))),
  ]).flat();
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
        h('div', { class: 'fila' }, btnDeshacer, btnRehacer),
        h('p', { class: 'muted' }, t('Arrastrá las piezas para ubicarlas (o elegí una y usá las flechas). Lo que ves acá es exactamente lo que se publica.'))),
      h('div', { class: 'controles' },
        h('div', { class: 'grupo' }, h('b', {}, t('Continúa a')), padreMini,
          h('button', { class: 'btn chico blanco', type: 'button', onclick: () => irA('v', padre) }, t('Elegir otra viñeta desde las ramas'))),
        h('div', { class: 'grupo' }, h('b', {}, t('Piezas')), piezas),
        sel,
        h('div', { class: 'grupo' }, h('b', {}, t('Fondo')), fondos),
        h('div', { class: 'grupo' }, h('b', {}, t('Epígrafe')), campo(t('Fecha o título corto (va en negrita)'), inLead), campo(t('Texto'), inTexto), campo(t('Idioma de la viñeta'), inIdioma)),
        h('div', { class: 'grupo' }, h('b', {}, t('Globos')), h('span', { class: 'muted' }, t('Si usás los dos, van uno de cada lado.')), ...globoCampos),
        h('div', { class: 'grupo' }, h('b', {}, t('Capítulo')), capSelect, inCapTitulo),
        h('div', { class: 'grupo' }, h('b', {}, t('Fuentes')), h('span', { class: 'muted' }, t('Es historia: para entrar al tronco, sumá de dónde sale el dato.')), ...inFuentes),
        h('div', { class: 'grupo' }, h('b', {}, t('Descripción del dibujo')), h('span', { class: 'muted' }, t('Para lectores de pantalla y otros clientes de Nostr.')), inAlt),
        h('div', { class: 'fila' }, btnPublicar,
          h('button', { class: 'btn ghost', type: 'button', onclick: () => { esc = E.escenaInicial(); guardarBorrador(); reiniciarHistorial(); renderCrear(true); } }, t('Empezar de cero')))))));
  actualizar();
  pintarHistorial();
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
    globos: esc.globos.filter((g) => g.t.trim()).map((g) => ({ t: g.t.trim(), lado: g.lado })),
    alt: esc.alt.trim(),
  };
  if (datos.arte.length > MAX_ARTE) { toast(t('El dibujo es demasiado grande: sacá algunas piezas.'), 5000); return; }
  try {
    const plantilla = plantillaVineta(datos, { anterior: { id: padre.id, relay, pubkey: padre.pubkey !== yo ? padre.pubkey : null }, capitulo, fuentes: esc.fuentes.filter(esUrl), zaps, idioma: esc.idioma || idioma() });
    const ev = await N.firmar(plantilla);
    const r = await N.publicar(ajustes.relays, ev);
    if (!r.ok) throw new Error(t('Ningún relay aceptó la viñeta. {e}', { e: r.errores[0] || '' }));
    agregarEvento(ev);
    recalcular();
    suscribirZaps(ev.created_at - 60);
    esc = E.escenaInicial();
    guardarBorrador();
    reiniciarHistorial();
    renderCrear.clave = null;
    toast(t('¡Publicada! Llegó a {ok} de {total} relays.', r));
    const nueva = S.historia.porId.get(ev.id) || leerVineta(ev);
    irA('v', nueva);
    abrirCompartir(nueva, { recien: true });
  } catch (e) { toast(e.message, 5000); }
}

// ---------- Diálogos ----------
let alCerrarDialogo = null;
function abrirDialogo(contenido, alCerrar) {
  alCerrarDialogo?.();
  alCerrarDialogo = alCerrar || null;
  const velo = $('#velo');
  const d = $('#dialogo');
  d.innerHTML = '';
  d.append(...contenido, h('button', { class: 'btn ghost chico', type: 'button', onclick: cerrarDialogo }, t('Cerrar')));
  velo.hidden = false;
  d.querySelector('button, input')?.focus();
}
function cerrarDialogo() {
  $('#velo').hidden = true;
  const f = alCerrarDialogo; alCerrarDialogo = null; f?.();
}

function abrirEntrar(despues) {
  const listo = (s) => { cerrarDialogo(); render(); toast(t('Hola, {nombre}.', { nombre: N.nombreCorto(s.pubkey) })); N.cargarPerfiles(ajustes.relays, [s.pubkey]).then(render); despues?.(); };
  const inNsec = h('input', { class: 'campo', type: 'password', placeholder: 'nsec1…', autocomplete: 'off' });
  abrirDialogo([
    h('h3', {}, t('Entrar con Nostr')),
    h('p', { class: 'muted' }, t('Tu identidad firma cada viñeta que publicás. Nadie puede editarla ni hacerse pasar por vos.')),
    h('button', { class: 'opcion', type: 'button', onclick: async () => { try { listo(await N.entrarConExtension()); } catch (e) { toast(e.message); } } },
      h('b', {}, t('Usar mi extensión')), t(N.hayExtension() ? 'Alby, nos2x, Keys.band u otra extensión NIP-07.' : 'No detecté ninguna extensión en este navegador.')),
    h('button', { class: 'opcion', type: 'button', onclick: () => abrirFirmanteRemoto(listo) },
      h('b', {}, t('Usar un firmante remoto')), t('Amber en el celular, nsec.app o tu propio bunker (NIP-46). Tu clave nunca pasa por esta página.')),
    h('button', { class: 'opcion', type: 'button', onclick: () => listo(N.crearClaveLocal()) },
      h('b', {}, t('Crear una identidad nueva acá')), t('Para quien todavía no usa Nostr. Se guarda en este navegador: después la podés exportar desde Ajustes.')),
    h('div', { class: 'grupo' }, h('b', {}, t('Ya tengo una clave')),
      h('span', { class: 'muted' }, t('Pegarla en una web es riesgoso: mejor usá una extensión.')), inNsec,
      h('button', { class: 'btn chico blanco', type: 'button', onclick: () => { try { listo(N.importarNsec(inNsec.value)); } catch (e) { toast(e.message); } } }, t('Entrar con esta clave'))),
  ]);
}

// NIP-46: un QR nostrconnect:// para escanear, o pegar un bunker://.
function abrirFirmanteRemoto(listo) {
  const nc = N.esperarNostrConnect();
  const estado = h('p', { class: 'muted', 'aria-live': 'polite' }, t('Esperando que aceptes desde tu firmante…'));
  const img = h('img', { alt: t('Código QR para conectar tu firmante') });
  QRCode.toDataURL(nc.uri, { margin: 1, width: 480 }).then((u) => { img.src = u; });
  const inBunker = h('input', { class: 'campo', placeholder: 'bunker://…', autocomplete: 'off' });
  let hecho = false;
  const terminar = (s) => { if (hecho) return; hecho = true; nc.cancelar(); listo(s); };
  nc.listo.then(terminar).catch(() => { /* cancelado o vencido */ });
  abrirDialogo([
    h('h3', {}, t('Firmante remoto')),
    h('p', { class: 'muted' }, t('Escaneá el código con Amber (o tocá el botón si estás en el celular), o pegá el enlace en nsec.app.')),
    h('div', { class: 'qr' }, img),
    h('div', { class: 'fila' },
      h('a', { class: 'btn chico', href: nc.uri }, t('Abrir en la app firmante')),
      h('button', { class: 'btn chico blanco', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(nc.uri); toast(t('Enlace copiado.')); } catch (e) { toast(t('No pude copiar: seleccioná el texto.')); } } }, t('Copiar enlace'))),
    estado,
    h('div', { class: 'grupo' }, h('b', {}, t('¿Tenés un enlace bunker://?')), inBunker,
      h('button', { class: 'btn chico blanco', type: 'button', onclick: async (e) => {
        e.currentTarget.disabled = true;
        estado.textContent = t('Conectando con el firmante…');
        try { terminar(await N.entrarConBunker(inBunker.value)); } catch (err) { estado.textContent = err.message; e.currentTarget.disabled = false; }
      } }, t('Conectar'))),
  ], () => nc.cancelar());
}

// Si el firmante remoto pide aprobar algo en su web, aparece un aviso con el enlace.
N.cuandoPidaAutorizacion((url) => {
  if (!/^https:\/\//.test(url)) return;
  document.querySelector('.autorizar')?.remove();
  const aviso = h('div', { class: 'autorizar', role: 'alert' },
    h('span', {}, t('Tu firmante pide que apruebes esta firma.')),
    h('a', { class: 'btn chico', href: url, target: '_blank', rel: 'noopener noreferrer', onclick: () => setTimeout(() => aviso.remove(), 500) }, t('Aprobar')),
    h('button', { class: 'btn chico ghost', type: 'button', onclick: () => aviso.remove() }, '✕'));
  document.body.append(aviso);
});

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
      h('button', { class: 'btn chico blanco', type: 'button', onclick: () => { cerrarDialogo(); irA('autor', s.pubkey); } }, t('Ver mi perfil y mis viñetas')),
      s.tipo === 'bunker' ? h('span', { class: 'muted' }, t('Firmás con un firmante remoto (NIP-46).')) : null,
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
        // Si alguien del reparto no tiene dirección Lightning, su parte va a los demás.
        const cobran = await Promise.all(partes().map(async (p) => [p.pubkey, await N.datosLnurl(ajustes.relays, p.pubkey)]));
        const sin = new Set(cobran.filter(([, ln]) => !ln).map(([pk]) => pk));
        const lista = N.repartir(v, monto, sin);
        if (!lista.length) throw new Error(t('Nadie en esta viñeta tiene una dirección Lightning que acepte zaps.'));
        const facturas = [];
        for (const p of lista) facturas.push(await N.pedirFactura({ relays: ajustes.relays, vineta: v, destinatario: p.pubkey, sats: p.sats, comentario: inComentario.value }));
        salida.innerHTML = '';
        if (sin.size) salida.append(h('p', { class: 'muted' }, t('{nombres} no tiene dirección Lightning: su parte va a los demás.', { nombres: [...sin].map(N.nombreCorto).join(', ') })));
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
  if (vista === 'v' && v) hash = N.neventDe(v, ajustes.relays) || `v-${v.id}`;
  if (vista === 'autor') { S.autor = v; hash = aNpub(v); }
  if (vista === 'leer') hash = `pag-${S.pagina}`;
  try { history.replaceState(null, '', `#${hash}`); } catch (e) { /* nada */ }
  render();
  $('#stage').scrollTop = 0;
}

function leerHash() {
  const hs = location.hash.slice(1);
  if (hs.startsWith('pag-')) { S.vista = 'leer'; S.pagina = parseInt(hs.slice(4), 10) || 0; return; }
  // #npub1… o #nprofile1…: el perfil de un autor.
  if (/^n(pub|profile)1/.test(hs)) {
    S.vista = 'autor'; S.autor = aHex(hs);
    return;
  }
  // #nevent1… (lo que comparte la app), #note1… o el viejo #v-<id o prefijo>.
  const enlace = hs.startsWith('v-') ? { id: hs.slice(2).toLowerCase(), relays: [] } : N.leerEnlace(hs);
  if (enlace?.id) {
    const v = S.historia?.porId.get(enlace.id) || [...(S.historia?.porId.values() || [])].find((x) => x.id.startsWith(enlace.id));
    S.vista = 'v'; S.foco = v || null; S._focoPendiente = v ? null : enlace.id;
    if (!v) cargarAlrededor(enlace.id, enlace.relays);
    return;
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
  for (const id of ['leer', 'ramas', 'v', 'crear', 'curar', 'autor']) $(`#vista-${id}`).hidden = S.vista !== id;
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
  else if (S.vista === 'autor') { $('#label').textContent = S.autor ? N.nombreCorto(S.autor) : t('Autor'); renderAutor(); }
}

function reiniciar() {
  zapsEscuchados.clear(); alrededorPedido.clear(); autorPedido.clear();
  S.eventos.clear(); S.etiquetas.clear(); S.borradas.clear(); S.zaps.clear(); S.likes.clear(); S.recibos.clear(); S.recibosVistos.clear(); S.facturas.clear();
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
  document.getElementById('biblioteca').innerHTML = `<defs>${biblioteca}${bibliotecaExtra}</defs>`;
  registrarBiblioteca(biblioteca + bibliotecaExtra);
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
    if (S.vista === 'crear' && renderCrear.tecla && $('#velo').hidden) { renderCrear.tecla(e); if (e.defaultPrevented) return; }
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

// PWA: se puede instalar y leer sin conexión (sólo en https o en localhost).
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { /* sin service worker */ }));
}
