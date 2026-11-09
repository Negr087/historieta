// Copia el génesis ya firmado desde los relays que lo tienen a los que les falta.
// No necesita tu nsec: reenvía los mismos eventos, con su firma original.
//
// Uso:
//   node scripts/reenviar-genesis.mjs                     relays de src/config.js
//   RELAYS=wss://a,wss://b node scripts/reenviar-genesis.mjs
//   node scripts/reenviar-genesis.mjs --solo-contar        sólo muestra cuántas tiene cada relay
//   ESPERA=2000 node scripts/reenviar-genesis.mjs         ms entre eventos (por defecto 1000)
//
// Si un relay no contesta 5 veces seguidas o te limita, lo deja para otro momento.

import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import { verifyEvent } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import { CONFIG } from '../src/config.js';
import { eventosGenesis } from '../src/model.js';

const soloContar = process.argv.includes('--solo-contar');
const relays = (process.env.RELAYS ? process.env.RELAYS.split(',') : CONFIG.relays).map((s) => s.trim()).filter(Boolean);
const pubkey = nip19.decode(CONFIG.curadores[0]).data;
const genesis = JSON.parse(readFileSync(new URL('../src/genesis.json', import.meta.url), 'utf8'));
const ids = new Set(eventosGenesis(genesis, pubkey, CONFIG.genesisCreatedAt).map((e) => e.id));
const PAUSA = Number(process.env.ESPERA || 1000);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function conectar(url, ms = 10000) {
  return new Promise((ok, mal) => {
    const ws = new WebSocket(url);
    const t = setTimeout(() => { ws.terminate(); mal(new Error('no conecta')); }, ms);
    ws.on('open', () => { clearTimeout(t); ok(ws); });
    ws.on('error', (e) => { clearTimeout(t); mal(e); });
  });
}

// Trae del relay las viñetas del génesis que tiene (firmadas y con id esperado).
async function leer(url) {
  const ws = await conectar(url);
  return new Promise((ok) => {
    const evs = new Map();
    const fin = () => { ws.close(); ok(evs); };
    const t = setTimeout(fin, 20000);
    ws.on('message', (m) => {
      const d = JSON.parse(m);
      if (d[0] === 'EVENT' && ids.has(d[2].id) && verifyEvent(d[2])) evs.set(d[2].id, d[2]);
      else if (d[0] === 'EOSE' || d[0] === 'CLOSED') { clearTimeout(t); fin(); }
    });
    ws.send(JSON.stringify(['REQ', 'g', { kinds: [8333], authors: [pubkey], limit: 1000 }]));
  });
}

// Manda eventos de a uno y espera el OK de cada uno.
async function enviar(url, evs) {
  const ws = await conectar(url);
  const pendientes = new Map();
  ws.on('message', (m) => {
    const d = JSON.parse(m);
    if (d[0] === 'OK' && pendientes.has(d[1])) { pendientes.get(d[1])(d); pendientes.delete(d[1]); }
    else if (d[0] === 'NOTICE') console.log(`  ${url} avisa: ${d[1]}`);
  });
  let ok = 0, error = 0, motivo = '', seguidos = 0;
  for (const [i, ev] of evs.entries()) {
    const r = await new Promise((res) => {
      pendientes.set(ev.id, res);
      setTimeout(() => { if (pendientes.delete(ev.id)) res(['OK', ev.id, false, 'sin respuesta en 10 s']); }, 10000);
      ws.send(JSON.stringify(['EVENT', ev]));
    });
    if (r[2] || String(r[3]).startsWith('duplicate')) { ok++; seguidos = 0; } else { error++; seguidos++; motivo ||= r[3]; }
    process.stdout.write(`\r  ${url}: ${i + 1}/${evs.length} (${ok} ok, ${error} con error)   `);
    if (seguidos >= 5 || /rate|banned|limit/i.test(r[3] || '')) {
      console.log(`\n  lo dejo por ahora (${r[3]}). Volvé a correr el script más tarde.`);
      ws.close(); return;
    }
    await espera(PAUSA);
  }
  ws.close();
  console.log(motivo ? `\n  primer error: ${motivo}` : '');
}

const todos = new Map();
const tiene = {};
for (const url of relays) {
  try {
    const evs = await leer(url);
    tiene[url] = evs;
    for (const [id, ev] of evs) todos.set(id, ev);
    console.log(`${url}: ${evs.size}/${ids.size}`);
  } catch (e) {
    console.log(`${url}: no responde (${e.message})`);
  }
}
if (soloContar) process.exit(0);
if (todos.size === 0) { console.log('Ningún relay tiene el génesis: publicalo primero con npm run genesis.'); process.exit(1); }

for (const url of relays) {
  if (!tiene[url]) continue;
  const faltan = [...todos.values()].filter((ev) => !tiene[url].has(ev.id)).sort((a, b) => a.created_at - b.created_at);
  if (!faltan.length) continue;
  console.log(`\n${url}: faltan ${faltan.length}`);
  try { await enviar(url, faltan); } catch (e) { console.log(`  no se pudo enviar (${e.message})`); }
}
process.exit(0);
