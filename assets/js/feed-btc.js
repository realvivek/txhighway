/* TX Highway — Bitcoin feeds.
 * 1) blockchain.com inv socket: every unconfirmed tx, full object, satoshi values.
 * 2) mempool.space socket: new blocks, mempool stats, recommended fees.
 * REST fallbacks keep the HUD honest if a socket is down.
 */
window.TXH = window.TXH || {};

TXH.btcFeed = (function () {
  var U = TXH.util;
  var handlers = { tx: [], block: [], stats: [], status: [] };
  var stats = { height: null, mempoolCount: null, fastestFee: null, halfHourFee: null, vBytesPerSecond: null };
  var txFeed, statsFeed;

  function emit(kind, payload) {
    handlers[kind].forEach(function (fn) { try { fn(payload); } catch (e) {} });
  }

  /* ---- live unconfirmed transactions ---- */
  function parseUtx(x) {
    // coerce everything numeric — feed data never reaches the DOM as raw strings
    var outSats = 0, inSats = 0, i;
    for (i = 0; i < (x.out || []).length; i++) outSats += Number(x.out[i].value) || 0;
    for (i = 0; i < (x.inputs || []).length; i++) {
      inSats += Number(x.inputs[i].prev_out && x.inputs[i].prev_out.value) || 0;
    }
    var size = Number(x.size) || null;
    var feeSats = inSats > outSats ? inSats - outSats : null;
    return {
      chain: 'btc',
      hash: String(x.hash || ''),
      value: outSats / 1e8,                            // BTC
      feeRate: feeSats && size ? feeSats / size : null, // ~sat/vB
      feeSats: feeSats,
      size: size,
      time: (Number(x.time) || 0) * 1000
    };
  }

  function startTxFeed() {
    txFeed = new U.Feed({
      name: 'btc-tx',
      urls: TXH.config.endpoints.btcTxWS,
      onOpen: function (ws) { ws.send(JSON.stringify({ op: 'unconfirmed_sub' })); },
      heartbeat: function (ws) { ws.send(JSON.stringify({ op: 'ping' })); },
      silenceMs: 45000, // this stream ticks multiple times per second
      onMessage: function (raw) {
        var m = JSON.parse(raw);
        if (m.op === 'utx' && m.x) emit('tx', parseUtx(m.x));
      },
      onStatus: function (s) { emit('status', { feed: 'btc-tx', state: s }); }
    });
    txFeed.connect();
  }

  /* ---- blocks + mempool stats ---- */
  function handleStatsMsg(m) {
    // every value is Number-coerced: feed data never reaches the DOM raw
    var changed = false;
    if (m.mempoolInfo && m.mempoolInfo.size != null) { stats.mempoolCount = Number(m.mempoolInfo.size) || 0; changed = true; }
    if (m.vBytesPerSecond != null) { stats.vBytesPerSecond = Number(m.vBytesPerSecond) || 0; changed = true; }
    if (m.fees) {
      stats.fastestFee = Number(m.fees.fastestFee) || null;
      stats.halfHourFee = Number(m.fees.halfHourFee) || null;
      changed = true;
    }
    if (m.blocks && m.blocks.length) {
      var tip = m.blocks[m.blocks.length - 1];
      if (tip && Number(tip.height)) { stats.height = Number(tip.height); changed = true; }
    }
    if (m.block && Number(m.block.height)) {
      stats.height = Number(m.block.height);
      emit('block', {
        chain: 'btc',
        height: stats.height,
        txCount: Number(m.block.tx_count) || null,
        sizeBytes: Number(m.block.size) || null,
        medianFee: Number(m.block.extras && m.block.extras.medianFee) || null
      });
      changed = true;
    }
    if (changed) emit('stats', stats);
  }

  function startStatsFeed() {
    statsFeed = new U.Feed({
      name: 'btc-stats',
      urls: TXH.config.endpoints.btcStatsWS,
      onOpen: function (ws) {
        ws.send(JSON.stringify({ action: 'want', data: ['blocks', 'stats', 'mempool-blocks'] }));
      },
      heartbeat: function (ws) { ws.send(JSON.stringify({ action: 'ping' })); },
      onMessage: function (raw) { handleStatsMsg(JSON.parse(raw)); },
      onStatus: function (s) { emit('status', { feed: 'btc-stats', state: s }); }
    });
    statsFeed.connect();
  }

  /* ---- REST safety net (fees + tip height, in case the stats socket is down) ---- */
  function restFallback() {
    fetch(TXH.config.endpoints.btcFeesREST)
      .then(function (r) { return r.json(); })
      .then(function (f) {
        if (f && f.fastestFee && stats.fastestFee == null) {
          stats.fastestFee = f.fastestFee; stats.halfHourFee = f.halfHourFee; emit('stats', stats);
        }
      }).catch(function () {});
    fetch(TXH.config.endpoints.btcTipREST)
      .then(function (r) { return r.text(); })
      .then(function (t) {
        var h = parseInt(t, 10);
        if (h > 0 && stats.height == null) { stats.height = h; emit('stats', stats); }
      }).catch(function () {});
  }

  function init() {
    startTxFeed();
    startStatsFeed();
    setTimeout(restFallback, 5000);
    setInterval(restFallback, 120000);
  }

  return {
    init: init,
    stats: function () { return stats; },
    on: function (kind, fn) { handlers[kind].push(fn); }
  };
})();
