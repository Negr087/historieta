// Publica las 254 viñetas originales (el génesis) firmadas con tu clave.
//
// Uso:
//   NSEC=nsec1... node scripts/publicar-genesis.mjs            publica en los relays de src/config.js
//   NSEC=nsec1... RELAYS=wss://a,wss://b node scripts/publicar-genesis.mjs
//   NSEC=nsec1... node scripts/publicar-genesis.mjs --prueba    no publica: muestra la primera viñeta y los ids
//
// Es seguro correrlo varias veces: los eventos tienen fecha fija, así que salen
// siempre con el mismo id y los relays ignoran los repetidos.
// Tu nsec no se guarda en ningún lado; sólo se usa para firmar en tu máquina.

import { readFileSync } from 'node:fs';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { SimplePool } from 'nostr-tools/pool';
import * as nip19 from 'nostr-tools/nip19';
import { useWebSocketImplementation } from 'nostr-tools/pool';
import WebSocket from 'ws';
import { CONFIG } from '../src/config.js';
import { eventosGenesis } from '../src/model.js';

useWebSocketImplementation(WebSocket);

const prueba = process.argv.includes('--prueba');
const nsec = process.env.NSEC;
if (!nsec) { console.error('Falta NSEC=nsec1... (la clave de la autora del génesis).'); process.exit(1); }
let d;
try { d = nip19.decode(nsec.trim()); } catch (e) { d = null; }
if (d?.type !== 'nsec') {
  console.error('NSEC no es una nsec válida (tiene que ser tu clave completa, nsec1 seguido de 58 caracteres).');
  process.exit(1);
}
const sk = d.data;
const pubkey = getPublicKey(sk);
const relays = (process.env.RELAYS ? process.env.RELAYS.split(',') : CONFIG.relays).map((s) => s.trim()).filter(Boolean);

const genesis = JSON.parse(readFileSync(new URL('../src/genesis.json', import.meta.url), 'utf8'));
const plantillas = eventosGenesis(genesis, pubkey, CONFIG.genesisCreatedAt);
const firmados = plantillas.map(({ id, pubkey: _p, ...t }) => {
  const ev = finalizeEvent(t, sk);
  if (ev.id !== id) throw new Error('El id firmado no coincide con el calculado: revisá model.js.');
  return ev;
});

console.log(`Autora: ${nip19.npubEncode(pubkey)}`);
console.log(`Poné esta npub primera en "curadores" (src/config.js).`);
console.log(`${firmados.length} viñetas · relays: ${relays.join(', ')}`);

if (prueba) {
  console.log('\nPrimera viñeta:\n', JSON.stringify(firmados[0], null, 2));
  console.log(`\nÚltima viñeta (la punta del tronco): ${firmados.at(-1).id}`);
  process.exit(0);
}

const pool = new SimplePool();
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const resultado = Object.fromEntries(relays.map((r) => [r, { ok: 0, error: 0, motivo: '' }]));
for (const [i, ev] of firmados.entries()) {
  const res = await Promise.allSettled(pool.publish(relays, ev));
  res.forEach((r, k) => {
    const v = resultado[relays[k]];
    if (r.status === 'fulfilled') v.ok++;
    else { v.error++; v.motivo ||= String(r.reason?.message ?? r.reason); }
  });
  const resumen = relays.map((r) => `${new URL(r).hostname.replace(/^relay\./, '').split('.')[0]} ${resultado[r].ok}`).join(' · ');
  process.stdout.write(`\r${i + 1}/${firmados.length} publicadas  (${resumen})   `);
  await espera(250); // los relays públicos limitan la cantidad de eventos por segundo
}
console.log('\n');
for (const [r, v] of Object.entries(resultado)) console.log(`${r}: ${v.ok} ok, ${v.error} con error${v.motivo ? ` (primer error: ${v.motivo})` : ''}`);
pool.close(relays);
process.exit(0);
