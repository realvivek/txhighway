/* TX Highway — global config.
 * All data sources are free, keyless, public endpoints. No signup required.
 */
window.TXH = window.TXH || {};

TXH.config = {
  version: '1.0.0',

  endpoints: {
    // Bitcoin: live unconfirmed transactions (full tx objects, values in satoshi)
    btcTxWS: 'wss://ws.blockchain.info/inv',
    // Bitcoin: blocks, mempool stats, recommended fees
    btcStatsWS: 'wss://mempool.space/api/v1/ws',
    btcFeesREST: 'https://mempool.space/api/v1/fees/recommended',
    btcTipREST: 'https://blockstream.info/api/blocks/tip/height',
    // Ethereum: JSON-RPC WebSockets (primary + fallback), keyless public nodes
    ethWS: [
      'wss://ethereum-rpc.publicnode.com',
      'wss://eth.drpc.org'
    ],
    // Prices (REST, CORS-enabled, keyless)
    priceSpot: function (sym) { return 'https://api.coinbase.com/v2/prices/' + sym + '-USD/spot'; },
    priceFallback: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd',
    // Explorers for click-through
    btcExplorer: function (hash) { return 'https://mempool.space/tx/' + hash; },
    ethExplorer: function (hash) { return 'https://etherscan.io/tx/' + hash; },
    // Historical replay (all keyless REST)
    btcBlockAtTime: function (ts) { return 'https://mempool.space/api/v1/mining/blocks/timestamp/' + ts; },
    btcBlockTxs: function (hash, start) { return 'https://mempool.space/api/block/' + hash + '/txs/' + start; },
    ethHttpRPC: 'https://ethereum-rpc.publicnode.com',
    // telemetry extras (all keyless)
    btcDailyTxs: 'https://api.blockchain.info/charts/n-transactions?timespan=3days&format=json&cors=true',
    btcRecentBlocks: 'https://mempool.space/api/v1/blocks',
    baseWS: ['wss://base-rpc.publicnode.com', 'wss://base.drpc.org'],
    priceHistory: function (coin, ddmmyyyy) {
      return 'https://api.coingecko.com/api/v3/coins/' + coin + '/history?date=' + ddmmyyyy;
    }
  },

  // Vehicle classes by USD value moved. Order matters (small -> large).
  classes: [
    { id: 'pod',   label: 'contract call',       maxUsd: -1,       crossSec: 8.5 },
    { id: 'bike',  label: 'under $100',          maxUsd: 100,      crossSec: 10 },
    { id: 'car',   label: '$100 – $1K',          maxUsd: 1e3,      crossSec: 12 },
    { id: 'sedan', label: '$1K – $10K',          maxUsd: 1e4,      crossSec: 13.5 },
    { id: 'truck', label: '$10K – $100K',        maxUsd: 1e5,      crossSec: 15.5 },
    { id: 'semi',  label: '$100K – $1M',         maxUsd: 1e6,      crossSec: 18 },
    { id: 'whale', label: 'over $1M',            maxUsd: Infinity, crossSec: 22 }
  ],

  chains: {
    btc: {
      name: 'BITCOIN',
      symbol: 'BTC',
      unit: 'BTC',
      // Brand hue kept for glow/identity; identity is never color-alone —
      // each chain has its own labeled highway (dataviz palette note in CLAUDE.md).
      accent: '#f7931a',
      accentInk: '#cf7000',      // readable on white cards
      lanes: 4
    },
    eth: {
      name: 'ETHEREUM',
      symbol: 'ETH',
      unit: 'ETH',
      accent: '#5b76f7',
      accentInk: '#3d5af1',      // readable on white cards
      lanes: 5
    }
  },

  engine: {
    maxVehiclesPerRoad: 120,   // hard cap; overflow shows in the "queued" counter
    maxQueue: 260,             // spawn queue cap per road
    dprCap: 2,
    ethBatchMs: 700,           // enrich pending tx hashes in batches this often
    ethBatchSize: 12,
    ethHashQueueCap: 400,
    pricePollMs: 30000,
    feedSilenceReconnectMs: 90000, // no message for this long -> reconnect
    heartbeatMs: 25000
  }
};
