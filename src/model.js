// Modelo de datos de la historieta sobre Nostr.
// Este archivo no toca el DOM: lo usan la app (navegador) y el script del génesis (Node).
//
// Tipos de evento:
//   kind 8333  Viñeta. Evento regular (no se edita: si querés cambiar algo, publicás otra).
//              content = JSON { v, fondo, epigrafe:{b,t}, arte, globos:[{t,lado}], alt }
//              tags:
//                ["t", "historieta-bitcoin"]            para encontrarlas
//                ["capitulo", "<n>", "<título>"]        a qué capítulo pertenece
//                ["e", "<id>", "<relay>", "anterior"]   la viñeta que esta continúa
//                ["p", "<pubkey>", "<relay>"]           su autor, para que le llegue el aviso
//                ["genesis", "<i>"]                     sólo las 254 originales, en orden
//                ["r", "<url>"]                         fuentes (una por tag)
//                ["zap", "<pubkey>", "<relay>", "<peso>"]  reparto de zaps (NIP-57)
//                ["alt", "..."]                         descripción para otros clientes (NIP-31)
//                ["L", "ISO-639-1"], ["l", "<es|en>", "ISO-639-1"]  idioma (NIP-32; el génesis no lo lleva)
//   kind 1985  Etiqueta de canon (NIP-32), firmada por un curador:
//                ["L", "historieta-bitcoin"], ["l", "canon", "historieta-bitcoin"],
//                ["e", "<id de la viñeta>"], ["k", "8333"]
//   kind 1985  Etiqueta de moderación, firmada por un curador: oculta una viñeta o a un autor.
//                ["L", "historieta-bitcoin"], ["l", "oculta", "historieta-bitcoin"],
//                ["e", "<id de la viñeta>"] y/o ["p", "<pubkey del autor>"], ["k", "8333"]
//   kind 5     Un curador revoca una etiqueta suya (canon u oculta).
//   kind 9735  Recibos de zap (NIP-57): suman los sats de cada viñeta.

import { getEventHash } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';

export const KIND_VINETA = 8333;
export const KIND_ETIQUETA = 1985;
export const ETIQUETA_NS = 'historieta-bitcoin';
export const TAG_T = 'historieta-bitcoin';

export const FONDOS = {
  p1: '#BFE3F5', p2: '#FFE9A8', p3: '#C9EBD3', p4: '#F9CDC8', p5: '#D9D2F2', p6: '#EADBC8', noche: '#23214a',
};

export const MAX_ARTE = 24000; // caracteres de SVG por viñeta
export const MAX_TEXTO = 400;

// --- Claves ---
export function aHex(clave) {
  if (!clave) return null;
  clave = String(clave).trim();
  if (/^[0-9a-f]{64}$/i.test(clave)) return clave.toLowerCase();
  try {
    const d = nip19.decode(clave);
    if (d.type === 'npub') return d.data;
    if (d.type === 'nprofile') return d.data.pubkey;
  } catch (e) { /* clave inválida */ }
  return null;
}
export function aNpub(hex) {
  try { return nip19.npubEncode(hex); } catch (e) { return hex; }
}

// --- Construcción de eventos ---
export function contenidoVineta(v) {
  return JSON.stringify({
    v: 1,
    fondo: v.fondo,
    epigrafe: { b: v.epigrafe?.b || '', t: v.epigrafe?.t || '' },
    arte: v.arte || '',
    globos: (v.globos || []).filter((g) => g.t && g.t.trim()),
    alt: v.alt || '',
  });
}

const PREFIJO_ALT = { es: 'Viñeta de La Historieta de Bitcoin', en: 'Panel from The Bitcoin Comic' };
function textoAlt(v, idioma) {
  const e = [v.epigrafe?.b, v.epigrafe?.t].filter(Boolean).join(' ');
  return `${PREFIJO_ALT[idioma] || PREFIJO_ALT.es}: ${e}`.slice(0, 280);
}

/** Plantilla (sin firmar) de una viñeta nueva. */
// `idioma` es opcional: el génesis se arma sin él para que sus ids no cambien.
export function plantillaVineta(v, { anterior, capitulo, fuentes = [], zaps = [], created_at, idioma }) {
  const tags = [['t', TAG_T]];
  if (capitulo) tags.push(['capitulo', String(capitulo.n), capitulo.titulo || '']);
  if (anterior) tags.push(['e', anterior.id, anterior.relay || '', 'anterior']);
  // Menciona al autor de la viñeta anterior: le llega la notificación en su cliente de Nostr.
  if (anterior?.pubkey && /^[0-9a-f]{64}$/.test(anterior.pubkey)) tags.push(['p', anterior.pubkey, anterior.relay || '']);
  for (const url of fuentes) if (url) tags.push(['r', url]);
  for (const z of zaps) tags.push(['zap', z.pubkey, z.relay || '', String(z.peso)]);
  if (idioma) tags.push(['L', 'ISO-639-1'], ['l', idioma, 'ISO-639-1']);
  tags.push(['alt', textoAlt(v, idioma)]);
  return {
    kind: KIND_VINETA,
    created_at: created_at ?? Math.floor(Date.now() / 1000),
    tags,
    content: contenidoVineta(v),
  };
}

/**
 * Las 254 viñetas originales, como eventos con fecha fija.
 * Como el contenido y la fecha son siempre iguales, los ids sólo dependen de la
 * clave de la autora: la app los calcula sola, sin buscarlos en los relays.
 */
export function eventosGenesis(genesis, pubkey, createdAt) {
  const caps = Object.fromEntries(genesis.capitulos.map((c) => [c.n, c]));
  const out = [];
  let anterior = null;
  for (const v of genesis.vinetas) {
    const t = plantillaVineta(v, {
      anterior: anterior ? { id: anterior.id } : null,
      capitulo: caps[v.cap],
      created_at: createdAt + v.i,
    });
    t.tags.splice(1, 0, ['genesis', String(v.i)]);
    const ev = { ...t, pubkey };
    ev.id = getEventHash(ev);
    out.push(ev);
    anterior = ev;
  }
  return out;
}

export function plantillaCanon(vineta) {
  return {
    kind: KIND_ETIQUETA,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['L', ETIQUETA_NS],
      ['l', 'canon', ETIQUETA_NS],
      ['e', vineta.id],
      ['p', vineta.pubkey],
      ['k', String(KIND_VINETA)],
    ],
    content: '',
  };
}

/** Etiqueta para ocultar una viñeta ({ vineta }) o todo lo de un autor ({ pubkey }). */
export function plantillaOcultar({ vineta, pubkey }) {
  const tags = [['L', ETIQUETA_NS], ['l', 'oculta', ETIQUETA_NS]];
  if (vineta) tags.push(['e', vineta.id]);
  if (pubkey) tags.push(['p', pubkey]);
  tags.push(['k', String(KIND_VINETA)]);
  return { kind: KIND_ETIQUETA, created_at: Math.floor(Date.now() / 1000), tags, content: '' };
}

// --- Lectura ---
/** Una URL http(s) con dominio (sirve para las fuentes). */
export function esUrl(s) {
  try { const u = new URL(String(s || '')); return /^https?:$/.test(u.protocol) && !!u.hostname; } catch (e) { return false; }
}

export function tag(ev, nombre) {
  return ev.tags.find((t) => t[0] === nombre);
}

/** Tipo de una etiqueta NIP-32 de la historieta: 'canon', 'oculta' o null. */
export function tipoEtiqueta(ev) {
  return ev.tags.find((t) => t[0] === 'l' && t[2] === ETIQUETA_NS)?.[1] || null;
}

/** Viñetas y autores que ocultaron los curadores (las etiquetas ya vienen filtradas). */
export function moderacion(etiquetas, curadores) {
  const curSet = new Set(curadores);
  const ocultas = new Set();
  const silenciados = new Set();
  for (const e of etiquetas) {
    if (!curSet.has(e.pubkey) || tipoEtiqueta(e) !== 'oculta') continue;
    for (const t of e.tags) {
      if (t[0] === 'e' && t[1]) ocultas.add(t[1]);
      if (t[0] === 'p' && t[1] && !curSet.has(t[1])) silenciados.add(t[1]); // a un curador no se lo silencia
    }
  }
  return { ocultas, silenciados };
}

/** Convierte un evento kind 8333 en una viñeta, o null si no es válida. */
export function leerVineta(ev) {
  if (!ev || ev.kind !== KIND_VINETA) return null;
  let c;
  try { c = JSON.parse(ev.content); } catch (e) { return null; }
  if (!c || typeof c !== 'object') return null;
  const capT = tag(ev, 'capitulo');
  const ant = ev.tags.find((t) => t[0] === 'e' && t[3] === 'anterior') || tag(ev, 'e');
  const gen = tag(ev, 'genesis');
  const corto = (s, n = MAX_TEXTO) => String(s || '').slice(0, n);
  return {
    id: ev.id,
    pubkey: ev.pubkey,
    created_at: ev.created_at,
    fondo: FONDOS[c.fondo] ? c.fondo : 'p1',
    epigrafe: { b: corto(c.epigrafe?.b, 80), t: corto(c.epigrafe?.t) },
    arte: String(c.arte || '').slice(0, MAX_ARTE),
    globos: Array.isArray(c.globos)
      ? c.globos.slice(0, 2).map((g) => ({ t: corto(g?.t, 200), lado: g?.lado === 'izq' ? 'izq' : 'der' }))
      : [],
    alt: corto(c.alt, 300),
    capitulo: capT ? { n: parseInt(capT[1], 10) || 0, titulo: corto(capT[2], 80) } : null,
    anterior: ant ? ant[1] : null,
    genesis: gen ? parseInt(gen[1], 10) : null,
    idioma: (ev.tags.find((t) => t[0] === 'l' && t[2] === 'ISO-639-1' && /^[a-z]{2}$/.test(t[1] || '')) || [])[1] || null,
    fuentes: ev.tags.filter((t) => t[0] === 'r' && esUrl(t[1])).map((t) => t[1]).slice(0, 5),
    zaps: ev.tags.filter((t) => t[0] === 'zap' && /^[0-9a-f]{64}$/.test(t[1] || ''))
      .map((t) => ({ pubkey: t[1], relay: t[2], peso: Math.max(0, parseFloat(t[3]) || 0) })),
    evento: ev,
  };
}

/**
 * Arma el tronco (canon) y el árbol de ramas.
 * - El tronco empieza con el génesis (viñetas de la curadora principal con tag "genesis").
 * - Después sigue con las viñetas que un curador etiquetó como canon y que continúan
 *   a la última viñeta del tronco. Si hay varias, gana la etiquetada primero.
 * - Todo lo demás es una rama que cuelga de la viñeta que continúa.
 */
export function armarHistoria({ vinetas, etiquetas, curadores }) {
  const porId = new Map(vinetas.map((v) => [v.id, v]));
  const curSet = new Set(curadores);
  const autora = curadores[0];

  // Primera fecha de canon por viñeta (sólo etiquetas de curadores, sin revocar).
  const canonDesde = new Map();
  for (const e of etiquetas) {
    if (!curSet.has(e.pubkey) || tipoEtiqueta(e) !== 'canon') continue;
    const id = tag(e, 'e')?.[1];
    if (!id) continue;
    if (!canonDesde.has(id) || canonDesde.get(id) > e.created_at) canonDesde.set(id, e.created_at);
  }

  const hijos = new Map();
  for (const v of vinetas) {
    if (!v.anterior) continue;
    if (!hijos.has(v.anterior)) hijos.set(v.anterior, []);
    hijos.get(v.anterior).push(v);
  }

  const tronco = vinetas
    .filter((v) => v.genesis != null && v.pubkey === autora)
    .sort((a, b) => a.genesis - b.genesis);

  const enTronco = new Set(tronco.map((v) => v.id));
  let cola = tronco[tronco.length - 1];
  for (let guard = 0; cola && guard < 100000; guard++) {
    const cands = (hijos.get(cola.id) || []).filter((h) => canonDesde.has(h.id) && !enTronco.has(h.id));
    if (!cands.length) break;
    cands.sort((a, b) => canonDesde.get(a.id) - canonDesde.get(b.id));
    cola = cands[0];
    tronco.push(cola);
    enTronco.add(cola.id);
  }

  return { porId, hijos, tronco, enTronco, canonDesde, cola: tronco[tronco.length - 1] || null };
}

/** Reacción (kind 7, NIP-25): la viñeta es el último tag "e". "-" es un no me gusta. */
export function leerReaccion(ev) {
  if (!ev || ev.kind !== 7) return null;
  const es = ev.tags.filter((t) => t[0] === 'e' && /^[0-9a-f]{64}$/.test(t[1] || ''));
  if (!es.length) return null;
  return { vineta: es.at(-1)[1], pubkey: ev.pubkey, positiva: ev.content.trim() !== '-', created_at: ev.created_at, id: ev.id };
}

export function plantillaReaccion(vineta, relay = '') {
  return {
    kind: 7, created_at: Math.floor(Date.now() / 1000), content: '+',
    tags: [['e', vineta.id, relay], ['p', vineta.pubkey], ['k', String(KIND_VINETA)]],
  };
}

/**
 * Valida un recibo de zap (kind 9735) según NIP-57, sin red:
 * - el recibo y el pedido (kind 9734, en "description") tienen firmas válidas,
 * - los dos apuntan a la misma viñeta y al mismo destinatario,
 * - el monto de la factura coincide con el pedido (si el pedido dice monto),
 * - el destinatario es uno de los que cobran esa viñeta (su reparto, o su autor).
 * Falta un chequeo que sí necesita red: que `proveedor` (quien firmó el recibo)
 * sea el `nostrPubkey` del LNURL del destinatario. Eso lo hace la app.
 * Devuelve { vineta, destinatario, proveedor, sats, factura } o null.
 */
export function validarRecibo(ev, { vinetas, verificar, satsDeFactura }) {
  if (!ev || ev.kind !== 9735 || !verificar(ev)) return null;
  const id = tag(ev, 'e')?.[1];
  const destinatario = tag(ev, 'p')?.[1];
  const factura = tag(ev, 'bolt11')?.[1];
  if (!id || !destinatario || !factura) return null;
  const v = vinetas.get(id);
  if (!v) return null;
  const cobran = v.zaps.length ? v.zaps.map((z) => z.pubkey) : [v.pubkey];
  if (!cobran.includes(destinatario)) return null;
  let pedido;
  try { pedido = JSON.parse(tag(ev, 'description')?.[1] || ''); } catch (e) { return null; }
  if (!pedido || pedido.kind !== 9734 || !Array.isArray(pedido.tags) || !verificar(pedido)) return null;
  if (tag(pedido, 'e')?.[1] !== id || tag(pedido, 'p')?.[1] !== destinatario) return null;
  let msats;
  try { msats = satsDeFactura(factura) * 1000; } catch (e) { return null; }
  if (!(msats > 0)) return null;
  const pedidoMsats = tag(pedido, 'amount')?.[1];
  if (pedidoMsats && parseInt(pedidoMsats, 10) !== msats) return null;
  return { vineta: id, destinatario, proveedor: ev.pubkey, sats: Math.floor(msats / 1000), factura };
}
