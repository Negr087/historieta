// Idiomas de la app: español (el original) e inglés.
//
// El texto en español es la clave: t('Leer') devuelve 'Leer' o 'Read'.
// Las variables van entre llaves: t('Capítulo {n}', { n: 3 }).
// Si falta una traducción, se muestra el español (y `npm run build` avisa).
//
// El idioma se elige así: ?lang=en en la URL > lo que eligió la persona > el del navegador.

export const IDIOMAS = { es: 'Español', en: 'English' };       // cada uno en su idioma (para elegir)
export const NOMBRE_IDIOMA = { es: 'español', en: 'inglés' };   // para nombrarlo dentro de una frase
const CLAVE = 'historieta.idioma';

function detectar() {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q && IDIOMAS[q]) return q;
  } catch (e) { /* sin location */ }
  try {
    const g = localStorage.getItem(CLAVE);
    if (g && IDIOMAS[g]) return g;
  } catch (e) { /* sin storage */ }
  const nav = typeof navigator !== 'undefined' ? (navigator.languages || [navigator.language]) : [];
  for (const l of nav) {
    const c = String(l || '').slice(0, 2).toLowerCase();
    if (IDIOMAS[c]) return c;
  }
  return 'es';
}

let actual = typeof window !== 'undefined' ? detectar() : 'es';

export const idioma = () => actual;
export const locale = () => (actual === 'en' ? 'en-US' : 'es-AR');

export function cambiarIdioma(l) {
  if (!IDIOMAS[l]) return;
  actual = l;
  try { localStorage.setItem(CLAVE, l); } catch (e) { /* sin storage */ }
  try {
    const u = new URL(location.href);
    if (u.searchParams.has('lang')) { u.searchParams.set('lang', l); history.replaceState(null, '', u); }
  } catch (e) { /* nada */ }
}

export function t(es, vars) {
  let s = actual === 'es' ? es : (EN[es] ?? es);
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return s;
}

// ---------------------------------------------------------------------------
// Inglés. Mantené las {variables} iguales que en la clave.
export const EN = {
  // Página y barra
  'La Historieta de Bitcoin · edición infinita sobre Nostr': 'The Bitcoin Comic · an endless edition on Nostr',
  'La historia de Bitcoin en historieta, que escribe la comunidad viñeta por viñeta sobre Nostr.': 'The story of Bitcoin as a comic, written by the community panel by panel on Nostr.',
  'Bitcoin <i>·</i> la historieta': 'Bitcoin <i>·</i> the comic',
  'Secciones': 'Sections',
  'Leer': 'Read',
  'Ramas': 'Branches',
  'Crear viñeta': 'Make a panel',
  'Curar': 'Curate',
  'Entrar': 'Log in',
  'Ajustes': 'Settings',
  'Idioma': 'Language',
  'Portada': 'Cover',
  'Conectando…': 'Connecting…',
  '<b>Falta configurar la curadora.</b> Poné tu npub en Ajustes (⚙) o en <code>src/config.js</code>: con eso se cargan las 254 viñetas del génesis.':
    '<b>The curator is not set up yet.</b> Put your npub in Settings (⚙) or in <code>src/config.js</code>: that loads the 254 genesis panels.',
  'Pasar de página': 'Turn the page',
  '← Anterior': '← Previous',
  'Siguiente →': 'Next →',

  // Estados y pie de viñeta
  'Tronco': 'Trunk',
  'Candidata': 'Candidate',
  'Rama': 'Branch',
  'génesis · {nombre}': 'genesis · {nombre}',
  'por {nombre}': 'by {nombre}',
  'Zapear esta viñeta': 'Zap this panel',
  'Ver continuaciones': 'See what follows',
  '↳ {n} rama': '↳ {n} branch',
  '↳ {n} ramas': '↳ {n} branches',
  'Escribir lo que sigue': 'Write what comes next',
  '✎ Seguir': '✎ Continue',
  'Escrita en {idioma}': 'Written in {idioma}',
  'español': 'Spanish',
  'inglés': 'English',

  // Portada
  'Edición infinita · {n} capítulos y contando': 'Endless edition · {n} chapters and counting',
  'LA HISTORIETA': 'THE COMIC',
  'Sat, una moneda naranja con brazos y piernas, haciendo un pulgar arriba': 'Sat, an orange coin with arms and legs, giving a thumbs up',
  'De los cypherpunks a hoy. Y desde hoy, la escribimos entre todos sobre Nostr.': 'From the cypherpunks to today. And from today on, we all write it together on Nostr.',
  'Empezar a leer': 'Start reading',
  'Sumar una viñeta': 'Add a panel',

  // Sat
  'Contento': 'Happy',
  'Cuando algo sale bien.': 'When something goes right.',
  'Sorprendido': 'Surprised',
  'Ante un récord o un giro.': 'At a new record or a plot twist.',
  'Pensativo': 'Thoughtful',
  'Cuando hay que hacer cuentas.': 'When there is math to do.',
  'Preocupado': 'Worried',
  'Cuando un intermediario se cae.': 'When a middleman goes down.',
  'Sat {pose}': '{pose} Sat',
  'Ficha del personaje': 'Character sheet',
  'Conocé a Sat': 'Meet Sat',
  'Sat es una moneda naranja curiosa que te acompaña en cada época. Su nombre viene del satoshi, la unidad más chica de bitcoin: un bitcoin son 100.000.000 de sats.':
    'Sat is a curious orange coin who keeps you company through every era. The name comes from the satoshi, the smallest unit of bitcoin: one bitcoin is 100,000,000 sats.',
  'Altura': 'Height',
  'Una moneda grande y dos piernitas.': 'One big coin and two little legs.',
  'Superpoder': 'Superpower',
  'Hacer preguntas incómodas.': 'Asking awkward questions.',
  'Debilidad': 'Weakness',
  'Los puntos únicos de falla.': 'Single points of failure.',

  // Índice y capítulos
  'La historia sigue (comunidad)': 'The story continues (community)',
  'Índice': 'Contents',
  '{n} capítulos y una historia que no termina': '{n} chapters and a story that never ends',
  'Los primeros 23 capítulos son el génesis. Lo que viene después lo escribe la comunidad, viñeta por viñeta, y queda firmado en Nostr.':
    'The first 23 chapters are the genesis. What comes next is written by the community, panel by panel, and signed on Nostr.',
  'Capítulo {n}': 'Chapter {n}',
  'comunidad': 'community',
  'pág. {p} de {total}': 'p. {p} of {total}',
  'Cap. {n} · {titulo}': 'Ch. {n} · {titulo}',

  // Fin
  'Hasta acá llegó el tronco: {n} viñetas': 'This is as far as the trunk goes: {n} panels',
  'CONTINUARÁ': 'TO BE CONTINUED',
  'Continuará': 'To be continued',
  'Sat sorprendido, con los brazos en alto': 'Sat surprised, with arms in the air',
  'La historia sigue': 'The story goes on',
  'Bitcoin todavía se está escribiendo, y esta historieta también. La próxima viñeta la podés hacer vos.':
    'Bitcoin is still being written, and so is this comic. You can make the next panel.',
  ' viñetas de la comunidad': ' community panels',
  ' autores': ' authors',
  ' sats en zaps': ' sats in zaps',
  'Sumar la próxima viñeta': 'Add the next panel',
  'Ver las ramas': 'See the branches',

  // Ramas
  '↰ sigue a: {x}': '↰ follows: {x}',
  'fuente {n} ': 'source {n} ',
  'Ramas y propuestas': 'Branches and proposals',
  'Lo último que sumó la comunidad': 'The latest from the community',
  'Cada viñeta continúa a otra. Las que aprueban los curadores pasan al tronco; el resto forma ramas: historias alternativas, chistes y episodios que cuelgan de la historia principal.':
    'Every panel continues another one. The ones the curators approve join the trunk; the rest grow into branches: alternate stories, jokes and episodes hanging off the main story.',
  'Todavía no hay viñetas de la comunidad. ': 'No community panels yet. ',
  'Hacé la primera': 'Make the first one',
  'No encontré esa viñeta.': 'I could not find that panel.',
  'Buscando la viñeta en los relays…': 'Looking for the panel on the relays…',
  'Capítulo {n} · {titulo}': 'Chapter {n} · {titulo}',
  'Esta viñeta y lo que sigue': 'This panel and what follows',
  '↰ Anterior': '↰ Previous',
  '✎ Continuar desde acá': '✎ Continue from here',
  'Fuentes: ': 'Sources: ',
  '{n} continuación': '{n} continuation',
  '{n} continuaciones': '{n} continuations',
  'Sin continuaciones todavía': 'No continuations yet',
  'Seguir esta rama →': 'Follow this branch →',
  'Nadie siguió desde acá. ': 'Nobody has continued from here yet. ',
  'Escribí lo que sigue': 'Write what comes next',

  // Curaduría
  'Esta sección es para los curadores de la historieta. Entrá con una de sus identidades.': 'This section is for the comic’s curators. Log in with one of their identities.',
  'Curaduría': 'Curation',
  'Qué entra al tronco': 'What goes into the trunk',
  'Las candidatas son las viñetas que continúan la última del tronco. Al aprobar una, firmás una etiqueta de canon (NIP-32) y pasa a ser la nueva punta: las siguientes candidatas tienen que continuarla a ella.':
    'Candidates are the panels that continue the last one in the trunk. When you approve one, you sign a canon label (NIP-32) and it becomes the new tip: the next candidates have to continue it.',
  'Candidatas ({n})': 'Candidates ({n})',
  '✓ Aprobar como canon': '✓ Approve as canon',
  'No hay candidatas nuevas para la punta del tronco.': 'No new candidates for the tip of the trunk.',
  'Canon de la comunidad ({n})': 'Community canon ({n})',
  'Quitar del canon': 'Remove from canon',
  'Todavía no aprobaste viñetas de la comunidad.': 'You have not approved any community panels yet.',
  'Aprobada. Llegó a {ok} de {total} relays.': 'Approved. It reached {ok} of {total} relays.',
  'Sale del canon': 'Removed from canon',
  'Listo, salió del canon.': 'Done, it is out of the canon.',

  // Editor
  'Falta configurar la curadora. ': 'The curator is not set up yet. ',
  'Poné tu npub en Ajustes (o en src/config.js) para cargar el génesis y poder continuar la historia.': 'Put your npub in Settings (or in src/config.js) to load the genesis and continue the story.',
  'Escribí el epígrafe…': 'Write the caption…',
  'Pieza elegida': 'Selected piece',
  'Tocá una pieza del dibujo para moverla, agrandarla o borrarla.': 'Tap a piece of the drawing to move it, resize it or delete it.',
  '− Achicar': '− Smaller',
  '+ Agrandar': '+ Bigger',
  '⇋ Espejar': '⇋ Flip',
  'Al frente': 'To front',
  'Al fondo': 'To back',
  'Borrar': 'Delete',
  'Texto': 'Text',
  'Color': 'Color',
  'Agregar {x}': 'Add {x}',
  'Cartel': 'Sign',
  'Caja': 'Box',
  'Círculo': 'Circle',
  'cartel': 'sign',
  'texto': 'text',
  'caja': 'box',
  'círculo': 'circle',
  'Fondo': 'Background',
  'Ej.: Abril de 2028.': 'E.g.: April 2028.',
  'Qué pasó, en una o dos frases.': 'What happened, in one or two sentences.',
  'Lo que dice Sat (opcional)': 'What Sat says (optional)',
  'Globo a la derecha': 'Bubble on the right',
  'Globo a la izquierda': 'Bubble on the left',
  'Sigue en el capítulo {n}: {titulo}': 'Stays in chapter {n}: {titulo}',
  'Empieza el capítulo {n}': 'Starts chapter {n}',
  'Título del capítulo nuevo': 'Title of the new chapter',
  'Firmar y publicar': 'Sign and publish',
  'Entrar y publicar': 'Log in and publish',
  'Continuás la punta del tronco': 'You are continuing the tip of the trunk',
  'Continuás una rama': 'You are continuing a branch',
  'Nueva viñeta': 'New panel',
  'Arrastrá las piezas para ubicarlas. Lo que ves acá es exactamente lo que se publica.': 'Drag the pieces into place. What you see here is exactly what gets published.',
  'Continúa a': 'Continues',
  'Elegir otra viñeta desde las ramas': 'Pick another panel from the branches',
  'Piezas': 'Pieces',
  'Epígrafe': 'Caption',
  'Fecha o título corto (va en negrita)': 'Date or short title (shown in bold)',
  'Globo': 'Speech bubble',
  'Capítulo': 'Chapter',
  'Fuentes': 'Sources',
  'Es historia: para entrar al tronco, sumá de dónde sale el dato.': 'This is history: to get into the trunk, add where the facts come from.',
  'Descripción del dibujo': 'Drawing description',
  'Para lectores de pantalla y otros clientes de Nostr.': 'For screen readers and other Nostr clients.',
  'Empezar de cero': 'Start over',
  'Idioma de la viñeta': 'Panel language',
  'Falta el epígrafe: contá qué pasa en la viñeta.': 'The caption is missing: tell what happens in the panel.',
  'Agregá al menos una pieza al dibujo.': 'Add at least one piece to the drawing.',
  'Ningún relay aceptó la viñeta. {e}': 'No relay accepted the panel. {e}',
  '¡Publicada! Llegó a {ok} de {total} relays.': 'Published! It reached {ok} of {total} relays.',

  // Piezas de la biblioteca (editor.js)
  'Sat contento': 'Happy Sat',
  'Sat sorprendido': 'Surprised Sat',
  'Sat pensativo': 'Thoughtful Sat',
  'Sat preocupado': 'Worried Sat',
  'una moneda': 'a coin',
  'un banco': 'a bank',
  'una computadora': 'a computer',
  'un sobre': 'an envelope',
  'una persona': 'a person',
  'alguien encapuchado': 'someone in a hood',
  'una pieza de rompecabezas': 'a puzzle piece',
  'un reloj de arena': 'an hourglass',
  'un kiosco': 'a newsstand',
  'un cartel que dice «{x}»': 'a sign that says “{x}”',
  'el texto «{x}»': 'the text “{x}”',
  '{lista} y {ultimo}': '{lista} and {ultimo}',
  'CARTEL': 'SIGN',

  // Diálogos
  'Cerrar': 'Close',
  'Hola, {nombre}.': 'Hi, {nombre}.',
  'Entrar con Nostr': 'Log in with Nostr',
  'Tu identidad firma cada viñeta que publicás. Nadie puede editarla ni hacerse pasar por vos.': 'Your identity signs every panel you publish. Nobody can edit it or pretend to be you.',
  'Usar mi extensión': 'Use my extension',
  'Alby, nos2x, Keys.band u otra extensión NIP-07.': 'Alby, nos2x, Keys.band or another NIP-07 extension.',
  'No detecté ninguna extensión en este navegador.': 'No extension detected in this browser.',
  'Crear una identidad nueva acá': 'Create a new identity here',
  'Para quien todavía no usa Nostr. Se guarda en este navegador: después la podés exportar desde Ajustes.': 'For people who do not use Nostr yet. It is stored in this browser: you can export it later from Settings.',
  'Ya tengo una clave': 'I already have a key',
  'Pegarla en una web es riesgoso: mejor usá una extensión.': 'Pasting it into a website is risky: an extension is safer.',
  'Entrar con esta clave': 'Log in with this key',
  'Tu identidad': 'Your identity',
  'Mostrar mi clave privada': 'Show my private key',
  'Guardala en un lugar seguro: si borrás el navegador, se pierde.': 'Keep it somewhere safe: if you clear your browser, it is gone.',
  'Salir': 'Log out',
  'Relays (uno por línea)': 'Relays (one per line)',
  'Curadores (npub, una por línea; la primera es la autora del génesis)': 'Curators (npub, one per line; the first one is the author of the genesis)',
  'Poné al menos un relay (wss://…).': 'Add at least one relay (wss://…).',
  'Ajustes guardados.': 'Settings saved.',
  'Guardar': 'Save',
  'Volver a los de fábrica': 'Reset to defaults',

  // Zaps
  '{sats} sats a {nombre}': '{sats} sats to {nombre}',
  'Un comentario (opcional)': 'A comment (optional)',
  'Otro monto en sats': 'Another amount in sats',
  '⚡ Zapear esta viñeta': '⚡ Zap this panel',
  'Esta viñeta reparte sus zaps entre su autor y la creadora de la historieta.': 'This panel splits its zaps between its author and the creator of the comic.',
  'Pidiendo facturas…': 'Requesting invoices…',
  '¡Pagado! El zap aparece en unos segundos.': 'Paid! The zap will show up in a few seconds.',
  'Código QR de la factura para {nombre}': 'QR code of the invoice for {nombre}',
  '{sats} sats para {nombre}': '{sats} sats for {nombre}',
  'Abrir billetera': 'Open wallet',
  'Factura copiada.': 'Invoice copied.',
  'No pude copiar: seleccioná el texto.': 'Could not copy: select the text instead.',
  'Copiar': 'Copy',
  'Pedir factura': 'Request invoice',

  // nostr.js
  'No encontré una extensión de Nostr (Alby, nos2x, Keys.band…).': 'No Nostr extension found (Alby, nos2x, Keys.band…).',
  'Eso no es una nsec.': 'That is not an nsec.',
  'Primero entrá con tu identidad de Nostr.': 'Log in with your Nostr identity first.',
  'La firma no es válida.': 'The signature is not valid.',
  '{nombre} no tiene una dirección Lightning que acepte zaps.': '{nombre} has no Lightning address that accepts zaps.',
  'El servidor Lightning no devolvió una factura.': 'The Lightning server did not return an invoice.',

  // Moderación
  'Nadie la va a ver en la app (podés deshacerlo desde Curaduría).': 'Nobody will see it in the app (you can undo it from Curation).',
  'Ocultar': 'Hide',
  'Oculta todas sus viñetas, también las que publique después.': 'Hides all their panels, including the ones they post later.',
  'Silenciar autor': 'Mute author',
  'Sólo gente conocida (la siguen los curadores o ya está en el tronco)': 'Only known people (followed by the curators or already on the trunk)',
  ' · {n} ocultas por el filtro': ' · {n} hidden by the filter',
  'Lo que ocultaste ({n})': 'What you hid ({n})',
  'Autor silenciado: {nombre}': 'Muted author: {nombre}',
  'Viñeta: «{x}»': 'Panel: “{x}”',
  'Vuelve a mostrarse': 'Shown again',
  'Listo, se vuelve a mostrar.': 'Done, it shows again.',
  'Volver a mostrar': 'Show again',
  'No ocultaste nada.': "You haven't hidden anything.",
  'Oculto. Llegó a {ok} de {total} relays.': 'Hidden. It reached {ok} of {total} relays.',
  'Nadie en esta viñeta tiene una dirección Lightning que acepte zaps.': 'Nobody on this panel has a Lightning address that accepts zaps.',
  '{nombres} no tiene dirección Lightning: su parte va a los demás.': "{nombres} has no Lightning address: their share goes to the others.",

  // Firmante remoto (NIP-46)
  'Usar un firmante remoto': 'Use a remote signer',
  'Amber en el celular, nsec.app o tu propio bunker (NIP-46). Tu clave nunca pasa por esta página.': 'Amber on your phone, nsec.app or your own bunker (NIP-46). Your key never touches this page.',
  'Esperando que aceptes desde tu firmante…': 'Waiting for you to accept on your signer…',
  'Código QR para conectar tu firmante': 'QR code to connect your signer',
  'Firmante remoto': 'Remote signer',
  'Escaneá el código con Amber (o tocá el botón si estás en el celular), o pegá el enlace en nsec.app.': 'Scan the code with Amber (or tap the button if you are on your phone), or paste the link into nsec.app.',
  'Abrir en la app firmante': 'Open in the signer app',
  'Enlace copiado.': 'Link copied.',
  'Copiar enlace': 'Copy link',
  '¿Tenés un enlace bunker://?': 'Do you have a bunker:// link?',
  'Conectando con el firmante…': 'Connecting to the signer…',
  'Conectar': 'Connect',
  'Tu firmante pide que apruebes esta firma.': 'Your signer is asking you to approve this signature.',
  'Aprobar': 'Approve',
  'Eso no parece un enlace bunker:// válido.': "That doesn't look like a valid bunker:// link.",
  'El firmante no respondió: {e}': 'The signer did not respond: {e}',

  // Compartir
  'Compartir': 'Share',
  'Sumé una viñeta a La Historieta de Bitcoin, la historieta que escribimos entre todos sobre Nostr ⚡': 'I added a panel to The Bitcoin Comic, the comic we all write together on Nostr ⚡',
  'Una viñeta de La Historieta de Bitcoin, la historieta que escribimos entre todos sobre Nostr ⚡': 'A panel from The Bitcoin Comic, the comic we all write together on Nostr ⚡',
  '¡Publicada! Contale a tu gente': 'Published! Tell your people',
  'Compartir esta viñeta': 'Share this panel',
  'Compartir…': 'Share…',
  'La Historieta de Bitcoin': 'The Bitcoin Comic',
  'Publicar una nota en Nostr': 'Post a note on Nostr',
  'Sale en Damus, Primal y el resto de los clientes, con la viñeta citada.': 'It shows up on Damus, Primal and every other client, quoting the panel.',
  'Nota publicada. Llegó a {ok} de {total} relays.': 'Note posted. It reached {ok} of {total} relays.',
  'Publicar nota': 'Post note',
  'Entrar y publicar nota': 'Log in and post note',

  // Me gusta y perfil de autor
  'Ya te gusta (tocá para sacarlo)': 'You like it (tap to undo)',
  'Me gusta': 'Like',
  'Ver todo lo de {nombre}': 'See everything by {nombre}',
  'No encontré a esa persona.': "I couldn't find that person.",
  'Tu perfil': 'Your profile',
  'Autor': 'Author',
  'Los curadores silenciaron a esta persona: sus viñetas no se muestran.': 'The curators muted this person: their panels are not shown.',
  ' viñetas': ' panels',
  ' en el tronco': ' on the trunk',
  ' me gusta': ' likes',
  'Buscando sus viñetas…': 'Looking for their panels…',
  'Todavía no publicó viñetas.': 'No panels yet.',
  'Hacé tu primera viñeta': 'Make your first panel',
  'Ver mi perfil y mis viñetas': 'See my profile and my panels',
  'Firmás con un firmante remoto (NIP-46).': 'You sign with a remote signer (NIP-46).',

  // Editor: deshacer, teclado, dos globos, remix, piezas nuevas
  'Lienzo: tocá una pieza para elegirla. Con el teclado: flechas para mover, + y − para el tamaño, Supr para borrar.': 'Canvas: tap a piece to select it. With the keyboard: arrows to move, + and − to resize, Delete to remove.',
  '↶ Deshacer': '↶ Undo',
  '↷ Rehacer': '↷ Redo',
  'Otro personaje responde (opcional)': 'Another character replies (optional)',
  'Globo {n}': 'Bubble {n}',
  'Lado del globo {n}': 'Side of bubble {n}',
  'Globos': 'Speech bubbles',
  'Si usás los dos, van uno de cada lado.': 'If you use both, they go on opposite sides.',
  'Arrastrá las piezas para ubicarlas (o elegí una y usá las flechas). Lo que ves acá es exactamente lo que se publica.': 'Drag the pieces into place (or select one and use the arrow keys). What you see here is exactly what gets published.',
  'El dibujo es demasiado grande: sacá algunas piezas.': 'The drawing is too big: remove some pieces.',
  'Esto reemplaza el dibujo que tenías en el editor. ¿Seguimos?': 'This replaces the drawing you had in the editor. Continue?',
  'Listo: el dibujo está en el editor. Cambialo como quieras.': 'Done: the drawing is in the editor. Change it however you like.',
  'Abre el editor con este dibujo para que lo cambies': 'Opens the editor with this drawing so you can change it',
  'Usar este dibujo': 'Use this drawing',
  'un rayo': 'a lightning bolt',
  'un bloque': 'a block',
  'un nodo': 'a node',
  'un pico de minero': "a miner's pickaxe",
  'un celular': 'a phone',
  'una llave': 'a key',
  'un documento': 'a document',
  'una porción de pizza': 'a slice of pizza',
  'un gráfico': 'a chart',
  'Mapa de ramas': 'Branch map',
  '+{n} más': '+{n} more',
  '+{n} continuaciones más': '+{n} more continuations',
};
