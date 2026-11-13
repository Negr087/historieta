# La Historieta de Bitcoin · edición infinita sobre Nostr

*[English version](README.en.md)*

La historieta original (23 capítulos, 254 viñetas) pasa a ser el **génesis** de una historieta que no termina: cualquiera puede sumar viñetas con las mismas piezas de dibujo, firmarlas con su identidad de Nostr y cobrar zaps por ellas. Los curadores eligen cuáles entran al **tronco** (la historia oficial); el resto forma **ramas**: historias alternativas, chistes y episodios que cuelgan de cualquier viñeta.

## Qué hay adentro

| Archivo | Para qué |
| --- | --- |
| `src/config.js` | Relays, curadores y reparto de zaps. **Lo primero que tenés que editar.** |
| `src/model.js` | El formato de los eventos (viñetas, canon, zaps) y cómo se arma el tronco. Lo usan la app y el script. |
| `src/render.js` | Dibuja viñetas y filtra el SVG que llega de los relays (lista blanca: sin scripts, links ni imágenes externas). |
| `src/editor.js` | El editor: piezas, carteles, textos, arrastrar, agrandar, espejar, y el remix (pasar el dibujo de una viñeta a capas). |
| `src/nostr.js` | Relays, identidad (extensión NIP-07, firmante remoto NIP-46 o clave local), publicación, perfiles, enlaces `nevent` y zaps (NIP-57 con reparto). |
| `src/app.js` | La app: lector, ramas, editor, curaduría, ajustes. |
| `src/i18n.js` | Idiomas de la interfaz (español e inglés). El texto en español es la clave. |
| `src/genesis-en.json` | Traducción al inglés del génesis: epígrafes, globos, descripciones, capítulos y los textos dibujados en el arte. |
| `src/genesis-arreglos.json` | Arreglos de cómo se muestran 34 epígrafes del génesis en español (la negrita va en medio de la frase). |
| `src/genesis.json`, `src/library.svg` | Las 254 viñetas y la biblioteca de piezas, extraídas de la historieta original. |
| `src/library-extra.svg` | Piezas nuevas para el editor (rayo, bloque, nodo, pico, celular, llave, documento, pizza, gráfico). `extraer.py` no lo toca. |
| `src/pwa/` | Manifest, service worker e íconos: la app se puede instalar y leer sin conexión. |
| `test/` | Pruebas del modelo (tronco, zaps, moderación, ids del génesis) y del filtro de SVG. `npm test`. |
| `scripts/extraer.py` | Vuelve a generar `genesis.json` y `library.svg` desde el HTML original. |
| `scripts/publicar-genesis.mjs` | Firma y publica el génesis en los relays. |
| `scripts/reenviar-genesis.mjs` | Copia el génesis ya firmado a los relays que no lo tienen (sin nsec). |
| `dev/servidor.mjs` | Servidor de desarrollo: la app + un relay de prueba en memoria. |
| `dev/prueba.py` | Prueba de punta a punta con Playwright. |

## Puesta en marcha

```bash
npm install
npm run build          # genera dist/ (index.html de ~630 KB con todo adentro, más los archivos de la PWA)
npm test               # pruebas del modelo y del filtro de SVG
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

Son archivos estáticos (`dist/`): `index.html` con todo adentro, más el manifest, el service worker y los íconos para instalarla como app:

- **Vercel**: `vercel.json` ya está listo (build `npm run build`, salida `dist`). Apuntá tu subdominio con Cloudflare como siempre.
- **Nodo Umbrel**: cualquier contenedor que sirva archivos estáticos, por ejemplo
  `docker run -d -p 8088:80 -v $PWD/dist:/usr/share/nginx/html:ro nginx:alpine`.

## Cómo funciona por dentro

### Tipos de evento

| Kind | Qué es | Tags importantes |
| --- | --- | --- |
| `8333` | Una viñeta (evento regular: no se edita) | `t=historieta-bitcoin`, `capitulo`, `e … anterior` (la viñeta que continúa), `p` (su autor, para que le llegue el aviso), `genesis` (sólo las originales), `r` (fuentes), `zap` (reparto), `L`/`l` (idioma, sólo las de la comunidad), `alt` |
| `1985` | Etiqueta de canon (NIP-32), firmada por un curador | `L=historieta-bitcoin`, `l=canon`, `e` (la viñeta), `k=8333` |
| `1985` | Etiqueta de moderación, firmada por un curador: oculta una viñeta o a un autor | `L=historieta-bitcoin`, `l=oculta`, `e` (la viñeta) o `p` (el autor), `k=8333` |
| `5` | Un curador revoca una etiqueta suya (canon u oculta), o alguien saca su me gusta | `e` (la etiqueta o la reacción), `k` |
| `7` | Me gusta (NIP-25): cuenta una por persona | `e` (la viñeta), `p`, `k=8333` |
| `9735` | Recibos de zap (NIP-57): suman los sats de cada viñeta | `e` (la viñeta), `p`, `bolt11`, `description` |
| `1` | Nota para compartir una viñeta en cualquier cliente | `q` (la viñeta, NIP-18), `p`, `t` |

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

Como las viñetas del génesis tienen fecha fija, la app calcula sus ids sola: lee la historieta original aunque los relays no respondan. Una prueba (`npm test`) verifica que esos ids no cambien sin querer.

Cada viñeta tiene su enlace (`#nevent1…`, con id, autor y un relay). Si la viñeta no vino en la carga inicial, la app la busca por id, junto con la anterior y sus continuaciones. La vista de cada viñeta muestra un **mapa de ramas**: de qué viñeta del tronco sale y qué sigue, hasta tres niveles. Cada autor tiene su página en `#npub1…`, con sus viñetas, cuántas están en el tronco, sats y me gusta.

### Moderación

Cualquiera puede publicar, así que los curadores pueden **ocultar** una viñeta o **silenciar** a un autor (también sus viñetas futuras) desde Ramas o desde la vista de cada viñeta. Es una etiqueta NIP-32 (`l=oculta`) igual que el canon, y se deshace desde Curaduría ("Lo que ocultaste"), que publica un kind 5. El génesis y los curadores no se pueden ocultar.

En Ramas, el filtro **"Sólo gente conocida"** muestra sólo a quienes siguen los curadores (su lista de contactos, kind 3) o a quienes ya tienen una viñeta en el tronco. Queda guardado en el navegador.

### Identidad

Para firmar hay tres caminos: una extensión del navegador (NIP-07: Alby, nos2x…), un **firmante remoto** (NIP-46: Amber en el celular escaneando un QR `nostrconnect://`, nsec.app o un enlace `bunker://`), o una clave creada en el navegador para quien todavía no usa Nostr. Con el firmante remoto, la clave nunca pasa por la página.

### El editor

Piezas de la biblioteca (Sat y los objetos del génesis, más las nuevas de `library-extra.svg`), carteles, textos, cajas y círculos; hasta dos globos (van uno de cada lado); deshacer y rehacer (Ctrl+Z / Ctrl+Shift+Z); y teclado (flechas para mover, Shift para mover más, + y − para el tamaño, Supr para borrar). Con **"Usar este dibujo"** cualquier viñeta pasa al editor como punto de partida: lo que el editor sabe armar vuelve como pieza editable y el resto como un bloque que se puede mover, escalar y espejar.

Después de publicar, se abre **Compartir**: el enlace, el menú de compartir del celular y una nota kind 1 que cita la viñeta, para que se vea en Damus, Primal y el resto.

### Idiomas

La app está en español y en inglés. Arranca en el idioma del navegador (si no es español ni inglés, en español), se cambia con el botón **EN / ES** de la barra o en Ajustes, y queda guardado en ese navegador. Con `?lang=en` en la URL se abre directo en inglés, útil para compartir.

- **Interfaz**: `src/i18n.js`. Para sumar un texto, escribilo en español dentro de `t('…')` y agregá su traducción en `EN`. `npm run build` avisa si falta alguna.
- **Génesis**: las viñetas originales están firmadas en español y no se pueden cambiar sin cambiar sus ids. En inglés, la app les superpone la traducción de `src/genesis-en.json` al mostrarlas.
- **Viñetas de la comunidad**: se muestran tal como las escribió su autor. El editor les agrega una etiqueta de idioma (NIP-32: `L=ISO-639-1`, `l=es|en`), y cuando una está en otro idioma que la interfaz, aparece un sello `EN` o `ES`.

### Zaps

Las viñetas de la comunidad llevan tags `zap` (NIP-57) con el reparto de `config.js`: por defecto, 80 % para quien la hizo y 20 % para la creadora de la historieta. La app pide una factura por cada parte; si alguien del reparto no tiene dirección Lightning, su parte va a los demás. Si tenés una billetera WebLN (Alby), paga sola; si no, muestra los QR. Sin sesión, el zap sale anónimo.

Un recibo de zap sólo suma si es válido: firmas correctas del recibo y del pedido, misma viñeta y mismo destinatario, el monto de la factura igual al pedido, un destinatario que cobra esa viñeta, y firmado por el servidor Lightning de ese destinatario (el `nostrPubkey` de su LNURL). Así nadie puede inventar sats publicando recibos truchos. Las candidatas a canon se ordenan por sats y después por me gusta.

## Ideas para seguir

- Que **Sat tenga su propia npub** y publique cada viñeta nueva del tronco como una nota común con imagen, para que aparezca en Primal, Damus y Amethyst.
- **Piezas propuestas por ilustradores** como eventos, que los curadores aprueban para la biblioteca (hoy se suman en `library-extra.svg`).
- **Traducciones de la comunidad**: que cualquiera pueda traducir una viñeta como un evento aparte, y sumar más idiomas.
- **Edición impresa** del canon de cada año.
