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
//                ["genesis", "<i>"]                     sólo las 254 originales, en orden
//                ["r", "<url>"]                         fuentes (una por tag)
//                ["zap", "<pubkey>", "<relay>", "<peso>"]  reparto de zaps (NIP-57)
//                ["alt", "..."]                         descripción para otros clientes (NIP-31)
//                ["L", "ISO-639-1"], ["l", "<es|en>", "ISO-639-1"]  idioma (NIP-32; el génesis no lo lleva)
//   kind 1985  Etiqueta de canon (NIP-32), firmada por un curador:
//                ["L", "historieta-bitcoin"], ["l", "canon", "historieta-bitcoin"],
//                ["e", "<id de la viñeta>"], ["k", "8333"]
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

// --- Lectura ---
export function tag(ev, nombre) {
  return ev.tags.find((t) => t[0] === nombre);
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
    fuentes: ev.tags.filter((t) => t[0] === 'r' && /^https?:\/\//.test(t[1] || '')).map((t) => t[1]).slice(0, 5),
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
    if (!curSet.has(e.pubkey)) continue;
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

/** Sats de un recibo de zap (kind 9735), leyendo el monto de la factura. */
export function satsDeRecibo(ev, satsDeFactura) {
  const b = tag(ev, 'bolt11')?.[1];
  if (b) {
    try { return satsDeFactura(b); } catch (e) { /* sigue */ }
  }
  try {
    const req = JSON.parse(tag(ev, 'description')?.[1] || '{}');
    const a = req.tags?.find((t) => t[0] === 'amount')?.[1];
    if (a) return Math.floor(parseInt(a, 10) / 1000);
  } catch (e) { /* nada */ }
  return 0;
}
