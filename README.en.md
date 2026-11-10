# The Bitcoin Comic · an endless edition on Nostr

*[Versión en español](README.md)*

The original comic (23 chapters, 254 panels) becomes the **genesis** of a comic that never ends: anyone can add panels using the same drawing pieces, sign them with their Nostr identity and receive zaps for them. Curators choose which ones join the **trunk** (the official story); the rest grow into **branches**: alternate stories, jokes and episodes hanging off any panel.

The app is available in Spanish and English. The code, comments and scripts are in Spanish.

## What's inside

| File | What it's for |
| --- | --- |
| `src/config.js` | Relays, curators and zap split. **The first thing to edit.** |
| `src/model.js` | Event format (panels, canon, zaps) and how the trunk is built. Used by the app and the script. |
| `src/render.js` | Draws panels and filters the SVG coming from relays (allowlist: no scripts, links or external images). |
| `src/editor.js` | The editor: pieces, signs, text, drag, resize, flip. |
| `src/nostr.js` | Relays, identity (NIP-07 extension or local key), publishing, profiles and zaps (NIP-57 with splits). |
| `src/app.js` | The app: reader, branches, editor, curation, settings. |
| `src/i18n.js` | Interface languages (Spanish and English). The Spanish text is the key. |
| `src/genesis-en.json` | English translation of the genesis: captions, speech bubbles, descriptions, chapters and the text drawn in the art. |
| `src/genesis.json`, `src/library.svg` | The 254 panels and the piece library, extracted from the original comic. |
| `scripts/extraer.py` | Regenerates `genesis.json` and `library.svg` from the original HTML. |
| `scripts/publicar-genesis.mjs` | Signs and publishes the genesis to the relays. |
| `scripts/reenviar-genesis.mjs` | Copies the already-signed genesis to relays that don't have it (no nsec needed). |
| `dev/servidor.mjs` | Development server: the app plus an in-memory test relay. |
| `dev/prueba.py` | End-to-end test with Playwright. |

## Getting started

```bash
npm install
npm run build          # generates dist/index.html (a single file, ~540 KB)
```

### 1. Try it locally, without touching public relays

```bash
npm run dev            # app at http://localhost:8080 and relay at ws://localhost:7777
# in another terminal, with a test key:
NSEC=nsec1... RELAYS=ws://localhost:7777 npm run genesis
```

In the app, open Settings (⚙): set `ws://localhost:7777` as the relay and that key's npub as the curator.

### 2. Set your npub

Run the script in test mode to see your npub and check the ids:

```bash
NSEC=nsec1... npm run genesis -- --prueba
```

Put that npub **first** in `curadores` inside `src/config.js`. Then `npm run build`.

> Your nsec is only used on your machine to sign. It isn't saved to any file.
> If you use a signer (Amber, nsec.app), you can create a separate key just for the genesis and add it as a curator.

### 3. Publish the genesis

```bash
NSEC=nsec1... npm run genesis
```

It publishes the 254 panels, one every 250 ms (public relays rate-limit). It's safe to run several times: the events have a fixed date, so they always get the same id and relays ignore duplicates.

If a relay ended up incomplete (for example, because it rate-limited you), fill it in later without the nsec: this copies the already-signed events from the relays that have them.

```bash
npm run reenviar -- --solo-contar   # how many panels each relay has
npm run reenviar                    # fills in the missing ones
```

### 4. Deploy the app

It's a single static file (`dist/index.html`):

- **Vercel**: `vercel.json` is ready (build `npm run build`, output `dist`).
- **Umbrel node**: any container that serves static files, for example
  `docker run -d -p 8088:80 -v $PWD/dist:/usr/share/nginx/html:ro nginx:alpine`.

## How it works

### Event kinds

| Kind | What it is | Key tags |
| --- | --- | --- |
| `8333` | A panel (regular event: not editable) | `t=historieta-bitcoin`, `capitulo` (chapter), `e … anterior` (the panel it continues), `genesis` (originals only), `r` (sources), `zap` (split), `L`/`l` (language, community panels only), `alt` |
| `1985` | Canon label (NIP-32), signed by a curator | `L=historieta-bitcoin`, `l=canon`, `e` (the panel), `k=8333` |
| `5` | A curator removes a panel from the canon (deletes its label) | `e` (the label), `k=1985` |
| `9735` | Zap receipts (NIP-57): they add up the sats for each panel | `e` (the panel) |

A panel's content is JSON (the field names are in Spanish):

```json
{
  "v": 1,
  "fondo": "p2",
  "epigrafe": { "b": "1983.", "t": "Cryptographer David Chaum publishes…" },
  "arte": "<use href=\"#o-coin\" x=\"70\" y=\"118\" width=\"72\" height=\"72\"/>…",
  "globos": [{ "t": "Like signing an envelope…", "lado": "der" }],
  "alt": "A coin inside an envelope and a thoughtful Sat"
}
```

`fondo` is the background, `epigrafe` the caption (`b` in bold, `t` the text), `arte` the drawing, `globos` the speech bubbles (`lado`: `der` right, `izq` left) and `alt` the description. `arte` is a 400×300 SVG that can only use pieces from the library and simple shapes. The app filters it through an allowlist before drawing it, so nobody can sneak scripts or trackers into a panel.

### The trunk and the branches

1. The trunk starts with the genesis: the panels tagged `genesis` and signed by the first curator.
2. It continues with panels that a curator labeled as canon **and** that continue the last panel of the trunk. If there are several, the one labeled first wins.
3. Everything else is a branch hanging off the panel it continues. Branches can be followed and continued without limit.

Since the genesis panels have a fixed date, the app computes their ids by itself: it can read the original comic even if the relays don't respond.

### Languages

The app starts in the browser's language (Spanish if it's neither Spanish nor English). You can switch with the **EN / ES** button in the top bar or in Settings, and the choice is saved in that browser. Adding `?lang=en` to the URL opens it directly in English, handy for sharing.

- **Interface**: `src/i18n.js`. To add a string, write it in Spanish inside `t('…')` and add its translation to `EN`. `npm run build` warns about missing ones.
- **Genesis**: the original panels are signed in Spanish and can't change without changing their ids. In English, the app overlays the translation from `src/genesis-en.json` when showing them.
- **Community panels**: shown as their author wrote them. The editor adds a language label (NIP-32: `L=ISO-639-1`, `l=es|en`), and panels in a language other than the interface's get an `EN` or `ES` badge.

### Zaps

Community panels carry `zap` tags (NIP-57) with the split from `config.js`: by default, 80% for the panel's author and 20% for the comic's creator. The app requests one invoice per share. With a WebLN wallet (Alby) it pays automatically; otherwise it shows the QR codes. Without logging in, the zap is anonymous.
