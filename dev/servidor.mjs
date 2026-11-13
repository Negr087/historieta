// Servidor de desarrollo: sirve la app y un relay Nostr de prueba en memoria.
//   App:   http://localhost:8080
//   Relay: ws://localhost:7777
// Uso: npm run dev   (antes: npm run build)

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { verifyEvent } from 'nostr-tools/pure';
import { matchFilter } from 'nostr-tools/filter';

const PUERTO_APP = Number(process.env.PUERTO_APP || 8080);
const PUERTO_RELAY = Number(process.env.PUERTO_RELAY || 7777);

// ---- Relay mínimo (NIP-01, con borrado NIP-09) ----
const eventos = new Map();
const subs = new Set(); // { ws, id, filtros }

function guardar(ev) {
  if (ev.kind === 5) {
    for (const t of ev.tags) {
      if (t[0] === 'e' && eventos.get(t[1])?.pubkey === ev.pubkey) eventos.delete(t[1]);
    }
  }
  eventos.set(ev.id, ev);
}

const wss = new WebSocketServer({ port: PUERTO_RELAY });
wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }
    const [tipo, ...resto] = msg;
    if (tipo === 'EVENT') {
      const ev = resto[0];
      if (!verifyEvent(ev)) { ws.send(JSON.stringify(['OK', ev?.id, false, 'invalid: firma'])); return; }
      const nuevo = !eventos.has(ev.id);
      guardar(ev);
      ws.send(JSON.stringify(['OK', ev.id, true, nuevo ? '' : 'duplicate:']));
      if (nuevo) {
        for (const s of subs) if (s.filtros.some((f) => matchFilter(f, ev))) s.ws.send(JSON.stringify(['EVENT', s.id, ev]));
      }
    } else if (tipo === 'REQ') {
      const [id, ...filtros] = resto;
      for (const s of subs) if (s.ws === ws && s.id === id) subs.delete(s);
      const todos = [...eventos.values()].sort((a, b) => b.created_at - a.created_at);
      for (const f of filtros) {
        let n = 0;
        for (const ev of todos) {
          if (f.limit != null && n >= f.limit) break;
          if (matchFilter(f, ev)) { ws.send(JSON.stringify(['EVENT', id, ev])); n++; }
        }
      }
      ws.send(JSON.stringify(['EOSE', id]));
      subs.add({ ws, id, filtros });
    } else if (tipo === 'CLOSE') {
      for (const s of subs) if (s.ws === ws && s.id === resto[0]) subs.delete(s);
    }
  });
  ws.on('close', () => { for (const s of subs) if (s.ws === ws) subs.delete(s); });
});

// ---- App ----
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
http.createServer((req, res) => {
  // Los archivos de dist/ (sw.js, manifest, íconos); cualquier otra ruta es la app.
  const nombre = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  const pedido = /^[\w.-]+$/.test(nombre) && existsSync(`dist/${nombre}`) ? `dist/${nombre}` : 'dist/index.html';
  if (!existsSync(pedido)) { res.writeHead(500); res.end('Falta dist/index.html: corré npm run build'); return; }
  res.writeHead(200, { 'content-type': TIPOS[pedido.slice(pedido.lastIndexOf('.'))] || 'application/octet-stream', 'cache-control': 'no-cache' });
  res.end(readFileSync(pedido));
}).listen(PUERTO_APP);

console.log(`App:   http://localhost:${PUERTO_APP}`);
console.log(`Relay: ws://localhost:${PUERTO_RELAY}`);
