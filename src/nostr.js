// Conexión con Nostr: relays, identidad, publicación y zaps.

import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import { getSatoshisAmountFromBolt11 } from 'nostr-tools/nip57';
import { bech32 } from '@scure/base';
import { BunkerSigner, parseBunkerInput, createNostrConnectURI } from 'nostr-tools/nip46';
import { bytesToHex, hexToBytes } from 'nostr-tools/utils';
import { t } from './i18n.js';

export const pool = new SimplePool();
export { getSatoshisAmountFromBolt11, verifyEvent };

// ---------- Identidad ----------
// Dos formas de firmar: la extensión del navegador (NIP-07: Alby, nos2x...) o
// una clave creada en este navegador, para quien todavía no usa Nostr.

const CLAVE_LOCAL = 'historieta.clave';
let firmante = null; // { tipo, pubkey, firmar(plantilla) }

function guardar(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* sin storage */ } }
function leer(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function borrar(k) { try { localStorage.removeItem(k); } catch (e) { /* nada */ } }

export function hayExtension() { return typeof window !== 'undefined' && !!window.nostr; }

export async function entrarConExtension() {
  if (!window.nostr) throw new Error(t('No encontré una extensión de Nostr (Alby, nos2x, Keys.band…).'));
  const pubkey = await window.nostr.getPublicKey();
  firmante = { tipo: 'extension', pubkey, firmar: (t) => window.nostr.signEvent(t) };
  guardar('historieta.modo', 'extension');
  return firmante;
}

function usarClave(sk) {
  const pubkey = getPublicKey(sk);
  firmante = { tipo: 'local', pubkey, firmar: async (t) => finalizeEvent(t, sk) };
  return firmante;
}

export function crearClaveLocal() {
  const sk = generateSecretKey();
  guardar(CLAVE_LOCAL, bytesToHex(sk));
  guardar('historieta.modo', 'local');
  return usarClave(sk);
}

export function importarNsec(nsec) {
  let d = null;
  try { d = nip19.decode(nsec.trim()); } catch (e) { /* no es bech32 */ }
  if (d?.type !== 'nsec') throw new Error(t('Eso no es una nsec.'));
  guardar(CLAVE_LOCAL, bytesToHex(d.data));
  guardar('historieta.modo', 'local');
  return usarClave(d.data);
}

export function exportarNsec() {
  const h = leer(CLAVE_LOCAL);
  return h ? nip19.nsecEncode(hexToBytes(h)) : null;
}

// ---------- Firmante remoto (NIP-46) ----------
// La clave queda en otro lado (Amber en el celular, nsec.app, un bunker propio) y
// esta página le pide cada firma por Nostr. Acá sólo se guarda una clave descartable
// que identifica a esta app ante el firmante.
const CLAVE_BUNKER = 'historieta.bunker';
export const RELAYS_NIP46 = ['wss://relay.nsec.app', 'wss://relay.damus.io', 'wss://nos.lol'];
const PERMISOS = ['get_public_key', 'sign_event:8333', 'sign_event:1985', 'sign_event:5', 'sign_event:9734', 'sign_event:1', 'sign_event:7'];

// Algunos firmantes piden aprobar en su web: la app decide cómo mostrar ese enlace.
let alPedirAutorizacion = (url) => { try { window.open(url, '_blank', 'noopener'); } catch (e) { /* nada */ } };
export function cuandoPidaAutorizacion(fn) { alPedirAutorizacion = fn; }
const paramsBunker = () => ({ onauth: (url) => alPedirAutorizacion(url) });

function usarBunker(bunker, sk, pubkey) {
  firmante = { tipo: 'bunker', pubkey, firmar: (t) => bunker.signEvent(t), bunker };
  guardar(CLAVE_BUNKER, JSON.stringify({ sk: bytesToHex(sk), bp: bunker.bp, pubkey }));
  guardar('historieta.modo', 'bunker');
  return firmante;
}

/** Entra con un bunker://… (o un nombre@dominio que publique su bunker por NIP-05). */
export async function entrarConBunker(texto) {
  const bp = await parseBunkerInput(String(texto || '').trim());
  if (!bp?.pubkey || !bp.relays?.length) throw new Error(t('Eso no parece un enlace bunker:// válido.'));
  const sk = generateSecretKey();
  const bunker = BunkerSigner.fromBunker(sk, bp, paramsBunker());
  try {
    await bunker.connect();
    return usarBunker(bunker, sk, await bunker.getPublicKey());
  } catch (e) {
    bunker.close();
    throw new Error(t('El firmante no respondió: {e}', { e: e.message }));
  }
}

/**
 * Arma un nostrconnect://… para escanear con Amber o pegar en nsec.app.
 * Devuelve { uri, listo (promesa del firmante), cancelar() }.
 */
export function esperarNostrConnect() {
  const sk = generateSecretKey();
  const secreto = bytesToHex(generateSecretKey()).slice(0, 16);
  const uri = createNostrConnectURI({
    clientPubkey: getPublicKey(sk), relays: RELAYS_NIP46, secret: secreto, perms: PERMISOS,
    name: 'La Historieta de Bitcoin', url: typeof location !== 'undefined' ? location.origin : undefined,
  });
  const ac = new AbortController();
  const listo = BunkerSigner.fromURI(sk, uri, paramsBunker(), ac.signal)
    .then(async (bunker) => usarBunker(bunker, sk, await bunker.getPublicKey()));
  return { uri, listo, cancelar: () => ac.abort() };
}

function restaurarBunker() {
  try {
    const g = JSON.parse(leer(CLAVE_BUNKER) || 'null');
    if (!g?.sk || !g.bp?.pubkey || !/^[0-9a-f]{64}$/.test(g.pubkey || '')) return null;
    const sk = hexToBytes(g.sk);
    const bunker = BunkerSigner.fromBunker(sk, g.bp, paramsBunker());
    bunker.cachedPubKey = g.pubkey;
    firmante = { tipo: 'bunker', pubkey: g.pubkey, firmar: (t) => bunker.signEvent(t), bunker };
    return firmante;
  } catch (e) { return null; }
}

export async function restaurarSesion() {
  const modo = leer('historieta.modo');
  if (modo === 'local') {
    const h = leer(CLAVE_LOCAL);
    if (h) return usarClave(hexToBytes(h));
  }
  if (modo === 'bunker') return restaurarBunker();
  if (modo === 'extension') {
    // La extensión puede tardar en inyectarse.
    for (let i = 0; i < 10 && !window.nostr; i++) await new Promise((r) => setTimeout(r, 150));
    if (window.nostr) {
      try { return await entrarConExtension(); } catch (e) { /* el usuario no aceptó */ }
    }
  }
  return null;
}

export function salir() {
  try { firmante?.bunker?.close(); } catch (e) { /* nada */ }
  firmante = null;
  borrar('historieta.modo');
  borrar(CLAVE_BUNKER);
}

export function sesion() { return firmante; }

export async function firmar(plantilla) {
  if (!firmante) throw new Error(t('Primero entrá con tu identidad de Nostr.'));
  const ev = await firmante.firmar({ ...plantilla, pubkey: firmante.pubkey });
  if (!verifyEvent(ev)) throw new Error(t('La firma no es válida.'));
  return ev;
}

/** Publica en todos los relays y devuelve cuántos lo aceptaron. */
export async function publicar(relays, ev) {
  const res = await Promise.allSettled(pool.publish(relays, ev));
  const ok = res.filter((r) => r.status === 'fulfilled').length;
  const errores = res.filter((r) => r.status === 'rejected').map((r) => String(r.reason?.message || r.reason));
  return { ok, total: relays.length, errores };
}

export function consultar(relays, filtro, maxWait = 4000) {
  return pool.querySync(relays, filtro, { maxWait });
}

export function suscribir(relays, filtro, alLlegar) {
  return pool.subscribeMany(relays, filtro, { onevent: alLlegar });
}

// ---------- Enlaces ----------
/** nevent (NIP-19) de una viñeta: id + autor + un relay donde encontrarla. */
export function neventDe(v, relays = []) {
  try { return nip19.neventEncode({ id: v.id, author: v.pubkey, relays: relays.slice(0, 2) }); } catch (e) { return null; }
}

/** Lee un nevent1…/note1… y devuelve { id, relays } o null. */
export function leerEnlace(s) {
  try {
    const d = nip19.decode(s);
    if (d.type === 'note') return { id: d.data, relays: [] };
    if (d.type === 'nevent') return { id: d.data.id, relays: (d.data.relays || []).filter((r) => /^wss?:\/\//.test(r)).slice(0, 3) };
  } catch (e) { /* no es un enlace */ }
  return null;
}

/** Estado de conexión de cada relay. */
export function estadoRelays(relays) {
  const m = pool.listConnectionStatus();
  return relays.map((url) => {
    const k = [...m.keys()].find((x) => x.replace(/\/$/, '') === url.replace(/\/$/, ''));
    return { url, ok: k ? m.get(k) : false };
  });
}

// ---------- Perfiles ----------
const perfiles = new Map();
export async function cargarPerfiles(relays, pubkeys) {
  const faltan = [...new Set(pubkeys)].filter((p) => !perfiles.has(p));
  if (!faltan.length) return perfiles;
  for (const p of faltan) perfiles.set(p, null);
  for (let i = 0; i < faltan.length; i += 100) {
    const evs = await consultar(relays, { kinds: [0], authors: faltan.slice(i, i + 100) });
    for (const e of evs) {
      const prev = perfiles.get(e.pubkey);
      if (prev && prev.created_at >= e.created_at) continue;
      try { perfiles.set(e.pubkey, { ...JSON.parse(e.content), created_at: e.created_at, evento: e }); } catch (err) { /* perfil roto */ }
    }
  }
  return perfiles;
}
export function perfil(pubkey) { return perfiles.get(pubkey) || null; }

export function nombreCorto(pubkey) {
  const p = perfil(pubkey);
  const n = p?.display_name || p?.name;
  if (n) return String(n).slice(0, 40);
  const npub = nip19.npubEncode(pubkey);
  return `${npub.slice(0, 10)}…${npub.slice(-4)}`;
}

// ---------- Zaps (NIP-57) ----------
// Si la viñeta trae tags "zap", el monto se reparte entre esas personas según sus pesos.

// `sinLightning`: quienes no pueden cobrar; su parte se reparte entre los demás.
export function repartir(vineta, total, sinLightning = new Set()) {
  const lista = (vineta.zaps.length ? vineta.zaps : [{ pubkey: vineta.pubkey, peso: 1 }]).filter((z) => !sinLightning.has(z.pubkey));
  const suma = lista.reduce((s, z) => s + z.peso, 0) || 1;
  let resto = total;
  const partes = lista.map((z, i) => {
    const sats = i === lista.length - 1 ? resto : Math.floor((total * z.peso) / suma);
    resto -= sats;
    return { pubkey: z.pubkey, sats };
  });
  return partes.filter((p) => p.sats > 0);
}

// LNURL de cada persona: { callback, nostrPubkey } o null si no acepta zaps.
// El nostrPubkey es quien firma los recibos de sus zaps: sirve para descartar recibos truchos.
const lnurls = new Map();
function urlLnurl(p) {
  if (p?.lud16 && /^[^@\s]+@[^@\s]+$/.test(p.lud16)) {
    const [nombre, dominio] = p.lud16.split('@');
    return new URL(`/.well-known/lnurlp/${nombre}`, `https://${dominio}`).toString();
  }
  if (p?.lud06) {
    try {
      const { words } = bech32.decode(p.lud06, 1000);
      return new TextDecoder().decode(bech32.fromWords(words));
    } catch (e) { /* lud06 roto */ }
  }
  return null;
}
export function datosLnurl(relays, pubkey) {
  if (!lnurls.has(pubkey)) {
    lnurls.set(pubkey, (async () => {
      await cargarPerfiles(relays, [pubkey]);
      const url = urlLnurl(perfil(pubkey));
      if (!url) return null;
      try {
        const j = await (await fetch(url)).json();
        if (!j?.allowsNostr || !/^[0-9a-f]{64}$/.test(j.nostrPubkey || '') || !j.callback) return null;
        return { callback: j.callback, nostrPubkey: j.nostrPubkey };
      } catch (e) { lnurls.delete(pubkey); return null; } // error de red: se reintenta más tarde
    })());
  }
  return lnurls.get(pubkey);
}

/** Pide una factura Lightning para zapear `vineta` con `sats` a `destinatario`. */
export async function pedirFactura({ relays, vineta, destinatario, sats, comentario }) {
  const ln = await datosLnurl(relays, destinatario);
  if (!ln) throw new Error(t('{nombre} no tiene una dirección Lightning que acepte zaps.', { nombre: nombreCorto(destinatario) }));
  const endpoint = ln.callback;
  const msats = sats * 1000;
  const plantilla = {
    kind: 9734,
    created_at: Math.floor(Date.now() / 1000),
    content: comentario || '',
    tags: [
      ['relays', ...relays],
      ['amount', String(msats)],
      ['p', destinatario],
      ['e', vineta.id],
      ['k', String(vineta.evento.kind)],
    ],
  };
  // Sin sesión, se zapea de forma anónima con una clave descartable.
  const pedido = firmante ? await firmar(plantilla) : finalizeEvent(plantilla, generateSecretKey());
  const url = `${endpoint}${endpoint.includes('?') ? '&' : '?'}amount=${msats}&nostr=${encodeURIComponent(JSON.stringify(pedido))}`;
  const r = await fetch(url);
  const j = await r.json();
  if (!j.pr) throw new Error(j.reason || t('El servidor Lightning no devolvió una factura.'));
  return { factura: j.pr, destinatario, sats };
}

export async function pagarConWebLN(factura) {
  if (!window.webln) return false;
  await window.webln.enable();
  await window.webln.sendPayment(factura);
  return true;
}
