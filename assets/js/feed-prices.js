/* TX Highway — USD spot prices (Coinbase primary, CoinGecko fallback).
 * Vehicles are classed by USD value, so prices load before anything spawns.
 */
window.TXH = window.TXH || {};

TXH.prices = (function () {
  var state = { btc: null, eth: null, ready: false, lastOk: 0 };
  var listeners = [];

  function notify() {
    state.ready = state.btc != null && state.eth != null;
    listeners.forEach(function (fn) { try { fn(state); } catch (e) {} });
  }

  function fetchCoinbase(sym, key) {
    return fetch(TXH.config.endpoints.priceSpot(sym))
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (j) {
        var v = parseFloat(j && j.data && j.data.amount);
        if (v > 0) { state[key] = v; state.lastOk = Date.now(); }
      });
  }

  function fetchFallback() {
    return fetch(TXH.config.endpoints.priceFallback)
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (j) {
        if (j && j.bitcoin && j.bitcoin.usd > 0) state.btc = j.bitcoin.usd;
        if (j && j.ethereum && j.ethereum.usd > 0) state.eth = j.ethereum.usd;
        state.lastOk = Date.now();
      });
  }

  function poll() {
    Promise.allSettled([fetchCoinbase('BTC', 'btc'), fetchCoinbase('ETH', 'eth')])
      .then(function (rs) {
        var failed = rs.some(function (r) { return r.status === 'rejected'; });
        if (failed || state.btc == null || state.eth == null) return fetchFallback().catch(function () {});
      })
      .then(notify)
      .catch(function () { notify(); });
  }

  function init() {
    poll();
    setInterval(poll, TXH.config.engine.pricePollMs);
  }

  return {
    init: init,
    get: function () { return state; },
    usd: function (chain, amount) {
      var p = state[chain];
      return p ? amount * p : null;
    },
    onUpdate: function (fn) { listeners.push(fn); }
  };
})();
