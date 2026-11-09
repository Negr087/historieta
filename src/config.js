// Configuración de la historieta. Editá esto antes de publicar.
// Todo se puede cambiar también desde "Ajustes" en la app (queda guardado en ese navegador).

export const CONFIG = {
  // Relays donde se publican y se leen las viñetas.
  relays: [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.primal.net',
    'wss://relay.lacrypta.ar',
  ],

  // Curadores: las npubs que deciden qué viñetas entran al tronco (canon).
  // La primera es también la autora del génesis y la "creadora" que recibe
  // una parte de cada zap. Reemplazá esto por tu npub.
  curadores: ['npub1yrffsyxk5hujkpz6mcpwhwkujqmdwswvdp4sqs2ug26zxmly45hsfpn8p0'],

  // Reparto de zaps en las viñetas de la comunidad (NIP-57, zap splits):
  // pesos para el autor de la viñeta y para la creadora (primera curadora).
  reparto: { autor: 80, creadora: 20 },

  // Fecha fija del génesis: hace que los ids de las 254 viñetas originales sean
  // siempre los mismos, así la app los conoce sin tener que buscarlos.
  // Si cambiás el génesis, cambiá esta fecha y volvé a publicarlo.
  genesisCreatedAt: 1794096000, // 8 de noviembre de 2026, 00:00 UTC
};
