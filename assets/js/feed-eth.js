/* TX Highway — Ethereum feed over public JSON-RPC WebSockets.
 * Subscribes to newPendingTransactions (hashes) + newHeads, then enriches
 * pending hashes with batched eth_getTransactionByHash calls so every
 * vehicle carries a real value / gas price. Mainnet runs ~13 tx/s, and the
 * batch pipeline (12 every 700ms) keeps up with headroom.
 */
window.TXH = window.TXH || {};

TXH.ethFeed = (function () {
  var U = TXH.util;
  var handlers = { tx: [], block: [], stats: [], status: [] };
  var stats = { height: null, baseFeeGwei: null, gasUsedPct: null, pendingRate: null, lastBlockTxs: null };
  var feed;
  var subs = { pending: null, heads: null };
  var hashQueue = [];
  var seen = {};       // hash -> 1, pruned periodically
  var seenCount = 0;
  var nextId = 100;
  var pendingTimes = []; // timestamps for rate calc
  var batchTimer = null;

  function emit(kind, payload) {
    handlers[kind].forEach(function (fn) { try { fn(payload); } catch (e) {} });
  }

  function parseTx(t) {
    if (!t || !t.hash) return null;
    var valueEth = U.weiHexToEth(t.value);
    var gasPriceWei = U.hexToNum(t.gasPrice || t.maxFeePerGas);
    return {
      chain: 'eth',
      hash: t.hash,
      value: valueEth,
      to: t.to,
      from: t.from,
      gasPriceGwei: gasPriceWei ? gasPriceWei / 1e9 : null,
      gasIsMax: !t.gasPrice && !!t.maxFeePerGas, // fee ceiling, not effective price
      isContractCall: valueEth === 0 && t.input && t.input !== '0x',
      time: Date.now()
    };
  }

  function onSubEvent(sub, result) {
    if (sub === subs.pending) {
      var now = Date.now();
      pendingTimes.push(now);
      if (pendingTimes.length > 400) pendingTimes.splice(0, 200);
      if (!seen[result]) {
        seen[result] = 1; seenCount++;
        if (seenCount > 5000) { seen = {}; seenCount = 0; } // cheap prune
        if (hashQueue.length < TXH.config.engine.ethHashQueueCap) hashQueue.push(result);
      }
    } else if (sub === subs.heads) {
      var h = result;
      var num = U.hexToNum(h.number);
      var gasUsed = U.hexToNum(h.gasUsed);
      var gasLimit = U.hexToNum(h.gasLimit) || 36000000; // ~2026 mainnet limit
      stats.height = num;
      stats.baseFeeGwei = U.hexToNum(h.baseFeePerGas) / 1e9;
      stats.gasUsedPct = Math.round((gasUsed / gasLimit) * 100);
      emit('block', {
        chain: 'eth',
        height: num,
        gasUsedPct: stats.gasUsedPct,
        baseFeeGwei: stats.baseFeeGwei
      });
      emit('stats', stats);
    }
  }

  function flushBatch() {
    if (!feed || !feed.ws || feed.ws.readyState !== 1) return;
    // dRPC's free tier rejects JSON-RPC batches larger than 3 — degrade
    // gracefully on the fallback endpoint instead of erroring forever
    var maxBatch = /drpc/.test(feed.currentUrl || '') ? 3 : TXH.config.engine.ethBatchSize;
    var n = Math.min(maxBatch, hashQueue.length);
    if (!n) return;
    var batch = [];
    for (var i = 0; i < n; i++) {
      batch.push({ jsonrpc: '2.0', id: nextId++, method: 'eth_getTransactionByHash', params: [hashQueue.shift()] });
    }
    if (nextId > 1e9) nextId = 100;
    feed.send(batch);
    // drop stale backlog so vehicles always represent *current* traffic
    if (hashQueue.length > TXH.config.engine.ethBatchSize * 6) {
      hashQueue.splice(0, hashQueue.length - TXH.config.engine.ethBatchSize * 4);
    }
  }

  var lastTxEmit = 0;

  function computeRate() {
    var now = Date.now();
    var cutoff = now - 10000;
    var n = 0;
    for (var i = pendingTimes.length - 1; i >= 0; i--) {
      if (pendingTimes[i] >= cutoff) n++; else break;
    }
    stats.pendingRate = n / 10;
    emit('stats', stats);
    // starvation watchdog: hashes flowing but zero enriched txs for 60s means
    // the endpoint is eating our batch replies — rotate
    if (stats.pendingRate > 1 && lastTxEmit && now - lastTxEmit > 60000) {
      lastTxEmit = now; // avoid immediate re-trigger while reconnecting
      try { feed.ws.close(); } catch (e) {}
    }
  }

  function handleMessage(raw) {
    var m = JSON.parse(raw);
    if (Array.isArray(m)) { // batch reply -> enriched transactions
      for (var i = 0; i < m.length; i++) {
        var tx = m[i] && m[i].result ? parseTx(m[i].result) : null;
        if (tx) { lastTxEmit = Date.now(); emit('tx', tx); }
      }
      return;
    }
    if (m.method === 'eth_subscription' && m.params) {
      onSubEvent(m.params.subscription, m.params.result);
    } else if (m.id === 1 || m.id === 2) {
      if (m.error) {
        // a rejected subscription is invisible to the silence watchdog
        // (newHeads keeps the socket "alive") — force rotation instead
        try { feed.ws.close(); } catch (e) {}
        return;
      }
      if (m.id === 1) subs.pending = m.result; else subs.heads = m.result;
    } else if (m.id >= 100 && m.result) {
      // some providers (dRPC) answer batch requests with individual frames
      var single = parseTx(m.result);
      if (single) { lastTxEmit = Date.now(); emit('tx', single); }
    }
  }

  function init() {
    feed = new U.Feed({
      name: 'eth',
      urls: TXH.config.endpoints.ethWS,
      silenceMs: 30000, // pending stream ticks ~13/s; silence means dead socket
      onOpen: function (ws) {
        subs.pending = subs.heads = null;
        hashQueue.length = 0;
        lastTxEmit = Date.now();
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: ['newPendingTransactions'] }));
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'eth_subscribe', params: ['newHeads'] }));
      },
      onMessage: handleMessage,
      onStatus: function (s) { emit('status', { feed: 'eth', state: s }); }
    });
    feed.connect();
    batchTimer = setInterval(flushBatch, TXH.config.engine.ethBatchMs);
    setInterval(computeRate, 5000);
  }

  return {
    init: init,
    stats: function () { return stats; },
    on: function (kind, fn) { handlers[kind].push(fn); }
  };
})();
