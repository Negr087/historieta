// Conexión con Nostr: relays, identidad, publicación y zaps.

import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import { getZapEndpoint, getSatoshisAmountFromBolt11 } from 'nostr-tools/nip57';
import { bytesToHex, hexToBytes } from 'nostr-tools/utils';

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
  if (!window.nostr) throw new Error('No encontré una extensión de Nostr (Alby, nos2x, Keys.band…).');
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
  const d = nip19.decode(nsec.trim());
  if (d.type !== 'nsec') throw new Error('Eso no es una nsec.');
  guardar(CLAVE_LOCAL, bytesToHex(d.data));
  guardar('historieta.modo', 'local');
  return usarClave(d.data);
}

export function exportarNsec() {
  const h = leer(CLAVE_LOCAL);
  return h ? nip19.nsecEncode(hexToBytes(h)) : null;
}

export async function restaurarSesion() {
  const modo = leer('historieta.modo');
  if (modo === 'local') {
    const h = leer(CLAVE_LOCAL);
    if (h) return usarClave(hexToBytes(h));
  }
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
  firmante = null;
  borrar('historieta.modo');
}

export function sesion() { return firmante; }

export async function firmar(plantilla) {
  if (!firmante) throw new Error('Primero entrá con tu identidad de Nostr.');
  const ev = await firmante.firmar({ ...plantilla, pubkey: firmante.pubkey });
  if (!verifyEvent(ev)) throw new Error('La firma no es válida.');
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

export function repartir(vineta, total) {
  const lista = vineta.zaps.length ? vineta.zaps : [{ pubkey: vineta.pubkey, peso: 1 }];
  const suma = lista.reduce((s, z) => s + z.peso, 0) || 1;
  let resto = total;
  const partes = lista.map((z, i) => {
    const sats = i === lista.length - 1 ? resto : Math.floor((total * z.peso) / suma);
    resto -= sats;
    return { pubkey: z.pubkey, sats };
  });
  return partes.filter((p) => p.sats > 0);
}

/** Pide una factura Lightning para zapear `vineta` con `sats` a `destinatario`. */
export async function pedirFactura({ relays, vineta, destinatario, sats, comentario }) {
  await cargarPerfiles(relays, [destinatario]);
  const meta = perfil(destinatario)?.evento;
  if (!meta) throw new Error(`${nombreCorto(destinatario)} no tiene perfil con dirección Lightning.`);
  const endpoint = await getZapEndpoint(meta);
  if (!endpoint) throw new Error(`${nombreCorto(destinatario)} no tiene una dirección Lightning que acepte zaps.`);
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
  if (!j.pr) throw new Error(j.reason || 'El servidor Lightning no devolvió una factura.');
  return { factura: j.pr, destinatario, sats };
}

export async function pagarConWebLN(factura) {
  if (!window.webln) return false;
  await window.webln.enable();
  await window.webln.sendPayment(factura);
  return true;
}
