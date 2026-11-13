// Pruebas del modelo: armado del tronco y validación de zaps.
// Uso: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import { leerVineta, plantillaVineta, plantillaCanon, armarHistoria, validarRecibo, eventosGenesis } from '../src/model.js';

const clave = () => { const sk = generateSecretKey(); return { sk, pk: getPublicKey(sk) }; };
const autora = clave();
const ana = clave();
const beto = clave();
const proveedor = clave(); // el servidor Lightning que firma los recibos

const datos = (texto) => ({ fondo: 'p1', epigrafe: { b: '', t: texto }, arte: '', globos: [], alt: '' });
let reloj = 1_800_000_000;
function vineta(quien, texto, anterior, extra = {}) {
  return finalizeEvent(plantillaVineta(datos(texto), { anterior: anterior && { id: anterior.id }, created_at: reloj++, ...extra }), quien.sk);
}
function canon(quien, ev) { return finalizeEvent({ ...plantillaCanon(ev), created_at: reloj++ }, quien.sk); }

const GENESIS = { capitulos: [{ n: 1, titulo: 'Uno' }], vinetas: [0, 1, 2].map((i) => ({ i, cap: 1, ...datos(`g${i}`) })) };
function genesisFirmado() {
  return eventosGenesis(GENESIS, autora.pk, 1_700_000_000).map((t) => finalizeEvent({ kind: t.kind, created_at: t.created_at, tags: t.tags, content: t.content }, autora.sk));
}

test('el tronco sigue al génesis y después a las viñetas aprobadas, en orden', () => {
  const g = genesisFirmado();
  const a = vineta(ana, 'a', g.at(-1));
  const b = vineta(beto, 'b', g.at(-1)); // compite con a
  const c = vineta(beto, 'c', a);
  const etiquetas = [canon(autora, a), canon(autora, b), canon(autora, c)];
  const H = armarHistoria({ vinetas: [...g, a, b, c].map(leerVineta), etiquetas, curadores: [autora.pk] });
  assert.deepEqual(H.tronco.map((v) => v.epigrafe.t), ['g0', 'g1', 'g2', 'a', 'c']);
  assert.equal(H.cola.id, c.id);
  assert.ok(!H.enTronco.has(b.id), 'b quedó como rama');
});

test('las etiquetas de quien no es curador no cuentan', () => {
  const g = genesisFirmado();
  const a = vineta(ana, 'a', g.at(-1));
  const H = armarHistoria({ vinetas: [...g, a].map(leerVineta), etiquetas: [canon(ana, a)], curadores: [autora.pk] });
  assert.equal(H.tronco.length, 3);
});

test('un génesis trucho (otro autor con tag genesis) no entra al tronco', () => {
  const g = genesisFirmado();
  const trucho = eventosGenesis(GENESIS, ana.pk, 1_700_000_000).map((t) => finalizeEvent({ kind: t.kind, created_at: t.created_at, tags: t.tags, content: t.content }, ana.sk));
  const H = armarHistoria({ vinetas: [...g, ...trucho].map(leerVineta), etiquetas: [], curadores: [autora.pk] });
  assert.ok(H.tronco.every((v) => v.pubkey === autora.pk));
  assert.equal(H.tronco.length, 3);
});

// --- Zaps ---
const FACTURAS = new Map(); // bolt11 falsa -> sats
function factura(sats) { const b = `lnbc${sats}test${FACTURAS.size}`; FACTURAS.set(b, sats); return b; }
const satsDeFactura = (b) => { if (!FACTURAS.has(b)) throw new Error('factura rota'); return FACTURAS.get(b); };

function recibo({ panel, para, sats, pedidoSats = sats, firmaRecibo = proveedor, ePedido = panel.id }) {
  const pedido = finalizeEvent({ kind: 9734, created_at: reloj++, content: '', tags: [['p', para], ['e', ePedido], ['amount', String(pedidoSats * 1000)]] }, generateSecretKey());
  return finalizeEvent({
    kind: 9735, created_at: reloj++, content: '',
    tags: [['p', para], ['e', panel.id], ['bolt11', factura(sats)], ['description', JSON.stringify(pedido)]],
  }, firmaRecibo.sk);
}

function contexto() {
  const g = genesisFirmado();
  const conReparto = vineta(ana, 'con reparto', g.at(-1), { zaps: [{ pubkey: ana.pk, peso: 80 }, { pubkey: autora.pk, peso: 20 }] });
  const vinetas = new Map([...g, conReparto].map((e) => [e.id, leerVineta(e)]));
  return { g, conReparto, opts: { vinetas, verificar: verifyEvent, satsDeFactura } };
}

test('un recibo válido se acepta y dice quién lo firmó', () => {
  const { conReparto, opts } = contexto();
  const r = validarRecibo(recibo({ panel: conReparto, para: ana.pk, sats: 80 }), opts);
  assert.equal(r.sats, 80);
  assert.equal(r.destinatario, ana.pk);
  assert.equal(r.proveedor, proveedor.pk);
});

test('se rechaza un recibo cuyo destinatario no cobra esa viñeta', () => {
  const { conReparto, opts } = contexto();
  assert.equal(validarRecibo(recibo({ panel: conReparto, para: beto.pk, sats: 1000 }), opts), null);
});

test('sin reparto, cobra sólo el autor', () => {
  const { g, opts } = contexto();
  assert.ok(validarRecibo(recibo({ panel: g[0], para: autora.pk, sats: 21 }), opts));
  assert.equal(validarRecibo(recibo({ panel: g[0], para: ana.pk, sats: 21 }), opts), null);
});

test('se rechaza si el monto de la factura no coincide con el pedido', () => {
  const { conReparto, opts } = contexto();
  assert.equal(validarRecibo(recibo({ panel: conReparto, para: ana.pk, sats: 1_000_000, pedidoSats: 1 }), opts), null);
});

test('se rechaza si el pedido apunta a otra viñeta', () => {
  const { g, conReparto, opts } = contexto();
  assert.equal(validarRecibo(recibo({ panel: conReparto, para: ana.pk, sats: 5, ePedido: g[0].id }), opts), null);
});

test('se rechaza un recibo con la firma rota', () => {
  const { conReparto, opts } = contexto();
  const r = recibo({ panel: conReparto, para: ana.pk, sats: 5 });
  assert.equal(validarRecibo({ ...JSON.parse(JSON.stringify(r)), sig: '00'.repeat(64) }, opts), null);
});

test('se rechaza un recibo de una viñeta desconocida', () => {
  const { opts } = contexto();
  const otra = vineta(beto, 'no cargada', null);
  assert.equal(validarRecibo(recibo({ panel: otra, para: beto.pk, sats: 5 }), opts), null);
});

test('los ids del génesis no cambian (si cambian, hay que volver a publicarlo)', async () => {
  const { readFileSync } = await import('node:fs');
  const { CONFIG } = await import('../src/config.js');
  const genesis = JSON.parse(readFileSync(new URL('../src/genesis.json', import.meta.url), 'utf8'));
  const evs = eventosGenesis(genesis, `${'0'.repeat(63)}1`, CONFIG.genesisCreatedAt);
  assert.equal(evs.length, 254);
  assert.equal(evs[0].id, '7865b4fb0747c67992349fe08a1d647e577f35f429b59009a466861580da0920');
  assert.equal(evs.at(-1).id, '0d3ba46a96901856647b50638302b02a75922185a286270846f76ca05ae90071');
});

test('ocultar: una etiqueta "oculta" no cuenta como canon, y se puede ocultar viñeta o autor', async () => {
  const { plantillaOcultar, moderacion } = await import('../src/model.js');
  const g = genesisFirmado();
  const a = vineta(ana, 'a', g.at(-1));
  const oculta = finalizeEvent({ ...plantillaOcultar({ vineta: a }), created_at: reloj++ }, autora.sk);
  const silencio = finalizeEvent({ ...plantillaOcultar({ pubkey: beto.pk }), created_at: reloj++ }, autora.sk);
  const deAna = finalizeEvent({ ...plantillaOcultar({ pubkey: autora.pk }), created_at: reloj++ }, ana.sk);
  const H = armarHistoria({ vinetas: [...g, a].map(leerVineta), etiquetas: [oculta], curadores: [autora.pk] });
  assert.equal(H.tronco.length, 3, 'ocultar no la mete al tronco');
  const m = moderacion([oculta, silencio, deAna], [autora.pk]);
  assert.ok(m.ocultas.has(a.id));
  assert.ok(m.silenciados.has(beto.pk));
  assert.ok(!m.silenciados.has(autora.pk), 'una no curadora no silencia a nadie');
});

test('reacciones: la viñeta es el último tag e, y "-" no suma', async () => {
  const { leerReaccion, plantillaReaccion } = await import('../src/model.js');
  const g = genesisFirmado();
  const r = finalizeEvent(plantillaReaccion(leerVineta(g[1])), ana.sk);
  assert.deepEqual({ ...leerReaccion(r), id: 0, created_at: 0 }, { vineta: g[1].id, pubkey: ana.pk, positiva: true, id: 0, created_at: 0 });
  const respuesta = finalizeEvent({ kind: 7, created_at: 1, content: '-', tags: [['e', g[0].id], ['e', g[2].id]] }, beto.sk);
  assert.equal(leerReaccion(respuesta).vineta, g[2].id);
  assert.equal(leerReaccion(respuesta).positiva, false);
});
