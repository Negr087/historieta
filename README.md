# La Historieta de Bitcoin · edición infinita sobre Nostr

La historieta original (23 capítulos, 254 viñetas) pasa a ser el **génesis** de una historieta que no termina: cualquiera puede sumar viñetas con las mismas piezas de dibujo, firmarlas con su identidad de Nostr y cobrar zaps por ellas. Los curadores eligen cuáles entran al **tronco** (la historia oficial); el resto forma **ramas**: historias alternativas, chistes y episodios que cuelgan de cualquier viñeta.

## Qué hay adentro

| Archivo | Para qué |
| --- | --- |
| `src/config.js` | Relays, curadores y reparto de zaps. **Lo primero que tenés que editar.** |
| `src/model.js` | El formato de los eventos (viñetas, canon, zaps) y cómo se arma el tronco. Lo usan la app y el script. |
| `src/render.js` | Dibuja viñetas y filtra el SVG que llega de los relays (lista blanca: sin scripts, links ni imágenes externas). |
| `src/editor.js` | El editor: piezas, carteles, textos, arrastrar, agrandar, espejar. |
| `src/nostr.js` | Relays, identidad (extensión NIP-07 o clave local), publicación, perfiles y zaps (NIP-57 con reparto). |
| `src/app.js` | La app: lector, ramas, editor, curaduría, ajustes. |
| `src/genesis.json`, `src/library.svg` | Las 254 viñetas y la biblioteca de piezas, extraídas de la historieta original. |
| `scripts/extraer.py` | Vuelve a generar `genesis.json` y `library.svg` desde el HTML original. |
| `scripts/publicar-genesis.mjs` | Firma y publica el génesis en los relays. |
| `dev/servidor.mjs` | Servidor de desarrollo: la app + un relay de prueba en memoria. |
| `dev/prueba.py` | Prueba de punta a punta con Playwright. |

## Puesta en marcha

```bash
npm install
npm run build          # genera dist/index.html (un solo archivo, ~440 KB)
```

### 1. Probar en tu máquina, sin tocar los relays públicos

```bash
npm run dev            # app en http://localhost:8080 y relay en ws://localhost:7777
# en otra terminal, con una clave de prueba:
NSEC=nsec1... RELAYS=ws://localhost:7777 npm run genesis
```

En la app, abrí Ajustes (⚙): poné `ws://localhost:7777` como relay y la npub de esa clave como curadora.

### 2. Configurar tu npub

Corré el script en modo prueba para ver tu npub y verificar los ids:

```bash
NSEC=nsec1... npm run genesis -- --prueba
```

Poné esa npub **primera** en `curadores` dentro de `src/config.js`. Después `npm run build`.

> Tu nsec sólo se usa en tu máquina para firmar. No se guarda en ningún archivo.
> Si usás un firmador (Amber, nsec.app), podés crear una clave aparte sólo para el génesis y sumarla como curadora.

### 3. Publicar el génesis

```bash
NSEC=nsec1... npm run genesis
```

Publica las 254 viñetas, una cada 250 ms (los relays públicos limitan la velocidad). Se puede correr varias veces: los eventos tienen fecha fija, así que salen siempre con el mismo id y los relays ignoran los repetidos.

Si algún relay quedó incompleto (por ejemplo, porque te limitó), completalo más tarde sin la nsec: copia los eventos ya firmados desde los relays que los tienen.

```bash
npm run reenviar -- --solo-contar   # cuántas viñetas tiene cada relay
npm run reenviar                    # completa los que faltan
```

### 4. Subir la app

Es un solo archivo estático (`dist/index.html`):

- **Vercel**: `vercel.json` ya está listo (build `npm run build`, salida `dist`). Apuntá tu subdominio con Cloudflare como siempre.
- **Nodo Umbrel**: cualquier contenedor que sirva archivos estáticos, por ejemplo
  `docker run -d -p 8088:80 -v $PWD/dist:/usr/share/nginx/html:ro nginx:alpine`.

## Cómo funciona por dentro

### Tipos de evento

| Kind | Qué es | Tags importantes |
| --- | --- | --- |
| `8333` | Una viñeta (evento regular: no se edita) | `t=historieta-bitcoin`, `capitulo`, `e … anterior` (la viñeta que continúa), `genesis` (sólo las originales), `r` (fuentes), `zap` (reparto), `alt` |
| `1985` | Etiqueta de canon (NIP-32), firmada por un curador | `L=historieta-bitcoin`, `l=canon`, `e` (la viñeta), `k=8333` |
| `5` | Un curador saca una viñeta del canon (borra su etiqueta) | `e` (la etiqueta), `k=1985` |
| `9735` | Recibos de zap (NIP-57): suman los sats de cada viñeta | `e` (la viñeta) |

El contenido de una viñeta es JSON:

```json
{
  "v": 1,
  "fondo": "p2",
  "epigrafe": { "b": "1983.", "t": "El criptógrafo David Chaum publica…" },
  "arte": "<use href=\"#o-coin\" x=\"70\" y=\"118\" width=\"72\" height=\"72\"/>…",
  "globos": [{ "t": "Como firmar un sobre…", "lado": "der" }],
  "alt": "Una moneda dentro de un sobre y Sat pensativo"
}
```

`arte` es SVG de 400×300 que sólo puede usar las piezas de la biblioteca y formas simples. La app lo filtra con una lista blanca antes de dibujarlo, así que nadie puede meter scripts ni rastreadores en una viñeta.

### El tronco y las ramas

1. El tronco arranca con el génesis: las viñetas con tag `genesis` firmadas por la primera curadora.
2. Sigue con las viñetas que un curador etiquetó como canon **y** que continúan a la última del tronco. Si hay varias, gana la etiquetada primero.
3. Todo lo demás es una rama que cuelga de la viñeta que continúa. Las ramas se pueden seguir y continuar sin límite.

Como las viñetas del génesis tienen fecha fija, la app calcula sus ids sola: lee la historieta original aunque los relays no respondan.

### Zaps

Las viñetas de la comunidad llevan tags `zap` (NIP-57) con el reparto de `config.js`: por defecto, 80 % para quien la hizo y 20 % para la creadora de la historieta. La app pide una factura por cada parte. Si tenés una billetera WebLN (Alby), paga sola; si no, muestra los QR. Sin sesión, el zap sale anónimo.

## Ideas para seguir

- Que **Sat tenga su propia npub** y publique cada viñeta nueva del tronco como una nota común con imagen, para que aparezca en Primal, Damus y Amethyst.
- **Piezas nuevas** propuestas por ilustradores como eventos, que los curadores aprueban para la biblioteca.
- **Traducciones** del epígrafe y los globos como eventos aparte.
- **Edición impresa** del canon de cada año.
- Firmar con **NIP-46** (bunker) además de la extensión.
