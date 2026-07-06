/* TX Highway — historical replay ("rewind").
 * Pick a date + time; the app finds the actual BTC and ETH blocks mined at
 * that moment (mempool.space block-by-timestamp; binary search over
 * PublicNode's HTTPS RPC) and replays their real transactions on the roads.
 * Vehicles are sized at that day's prices (CoinGecko history, keyless), so a
 * 2017 whale is a 2017 whale. Everything stays clearly labeled REPLAY, and
 * live traffic resumes the moment you exit.
 */
window.TXH = window.TXH || {};

TXH.historical = (function () {
  var U = TXH.util;
  var active = false;
  var timer = null;
  var queue = [];          // [{at: performance-ms, tx}]
  var doneAt = null;
  var dayPrices = { btc: null, eth: null };
  var els = {};

  function isActive() { return active; }

  /* ---------- fetch helpers ---------- */

  function getJSON(url) {
    return fetch(url, { signal: AbortSignal.timeout(20000) })
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); });
  }

  function rpc(method, params) {
    return fetch(TXH.config.endpoints.ethHttpRPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: method, params: params }),
      signal: AbortSignal.timeout(20000)
    }).then(function (r) { return r.json(); })
      .then(function (j) { if (j.error) throw new Error(j.error.message); return j.result; });
  }

  /* ---------- BTC: block at timestamp + its transactions ---------- */

  function fetchBtc(tsSec) {
    var meta;
    return getJSON(TXH.config.endpoints.btcBlockAtTime(tsSec))
      .then(function (m) {
        meta = m; // {height, hash, timestamp}
        // up to 100 txs, 25 per page
        var pages = [0, 25, 50, 75].map(function (start) {
          return getJSON(TXH.config.endpoints.btcBlockTxs(meta.hash, start)).catch(function () { return []; });
        });
        return Promise.all(pages);
      })
      .then(function (pages) {
        var txs = [];
        pages.forEach(function (p) { (p || []).forEach(function (t) { txs.push(t); }); });
        return {
          height: Number(meta.height),
          time: Number(meta.timestamp) * 1000,
          txs: txs.map(function (t) {
            var sats = 0;
            (t.vout || []).forEach(function (o) { sats += Number(o.value) || 0; });
            return {
              chain: 'btc',
              hash: String(t.txid || ''),
              value: sats / 1e8,
              feeSats: Number(t.fee) || null,
              size: Number(t.size) || null,
              replay: true
            };
          })
        };
      });
  }

  /* ---------- ETH: binary-search the block at timestamp ---------- */

  function ethBlockTs(num) {
    return rpc('eth_getBlockByNumber', ['0x' + num.toString(16), false])
      .then(function (b) { return b ? U.hexToNum(b.timestamp) : null; });
  }

  function findEthBlock(tsSec, statusFn) {
    return rpc('eth_blockNumber', []).then(function (latestHex) {
      var lo = 1, hi = U.hexToNum(latestHex);
      // binary search: greatest block with timestamp <= target (~25 calls)
      function stepLoHi() {
        if (lo >= hi) return Promise.resolve(lo);
        var mid = Math.floor((lo + hi + 1) / 2);
        statusFn('locating ETH block…');
        return ethBlockTs(mid).then(function (t) {
          if (t != null && t <= tsSec) lo = mid; else hi = mid - 1;
          return stepLoHi();
        });
      }
      return stepLoHi();
    });
  }

  function fetchEth(tsSec, statusFn) {
    return findEthBlock(tsSec, statusFn)
      .then(function (num) { return rpc('eth_getBlockByNumber', ['0x' + num.toString(16), true]); })
      .then(function (b) {
        if (!b) throw new Error('block not found');
        var txs = (b.transactions || []).slice(0, 120).map(function (t) {
          var valueEth = U.weiHexToEth(t.value);
          var gasWei = U.hexToNum(t.gasPrice || t.maxFeePerGas);
          return {
            chain: 'eth',
            hash: String(t.hash || ''),
            value: valueEth,
            to: t.to,
            gasPriceGwei: gasWei ? gasWei / 1e9 : null,
            gasIsMax: !t.gasPrice && !!t.maxFeePerGas,
            isContractCall: valueEth === 0 && t.input && t.input !== '0x',
            replay: true
          };
        });
        return { height: U.hexToNum(b.number), time: U.hexToNum(b.timestamp) * 1000, txs: txs };
      });
  }

  /* ---------- day prices so a 2017 whale is a 2017 whale ---------- */

  function fetchDayPrices(date) {
    function dd(n) { return (n < 10 ? '0' : '') + n; }
    var key = dd(date.getUTCDate()) + '-' + dd(date.getUTCMonth() + 1) + '-' + date.getUTCFullYear();
    function one(coin) {
      return getJSON(TXH.config.endpoints.priceHistory(coin, key))
        .then(function (j) {
          var p = j && j.market_data && j.market_data.current_price && j.market_data.current_price.usd;
          return p > 0 ? p : null;
        })
        .catch(function () { return null; });
    }
    return Promise.all([one('bitcoin'), one('ethereum')]).then(function (ps) {
      var live = TXH.prices.get();
      dayPrices.btc = ps[0] || live.btc;
      dayPrices.eth = ps[1] || live.eth;
    });
  }

  /* ---------- replay engine ---------- */

  function schedule(btc, eth) {
    queue.length = 0;
    var now = performance.now();
    var spread = 80000; // replay each block over ~80s
    function add(list) {
      list.forEach(function (tx, i) {
        tx.usd = tx.value * (dayPrices[tx.chain] || 0) || null;
        queue.push({ at: now + 1500 + (i / Math.max(1, list.length - 1)) * spread * U.rand(0.92, 1.05), tx: tx });
      });
    }
    add(btc.txs);
    add(eth.txs);
    queue.sort(function (a, b) { return a.at - b.at; });
    doneAt = null;
    TXH.highway.blockPulse('btc');
    TXH.highway.blockPulse('eth');
    timer = setInterval(function () {
      var t = performance.now();
      while (queue.length && queue[0].at <= t) {
        TXH.highway.spawn(queue.shift().tx);
      }
      if (!queue.length) {
        if (doneAt == null) doneAt = t;
        else if (t - doneAt > 25000) stop(); // roads drained — back to live
      }
    }, 200);
  }

  function fmtStamp(ms) {
    var d = new Date(ms);
    return d.toISOString().slice(0, 10) + ' ' + d.toISOString().slice(11, 16) + ' UTC';
  }

  /* ---------- UI ---------- */

  function setBanner(html, cls) {
    els.banner.innerHTML = html;
    els.banner.className = 'replay-banner' + (cls ? ' ' + cls : '');
    els.banner.hidden = false;
  }

  function start(dateMs) {
    if (active) stop();
    active = true;
    els.panel.hidden = true;
    var tsSec = Math.floor(dateMs / 1000);
    var date = new Date(dateMs);
    setBanner('<span class="rb-tag">REPLAY</span> loading blocks from ' + fmtStamp(dateMs) + '…');

    var status = function (msg) {
      if (active) setBanner('<span class="rb-tag">REPLAY</span> ' + msg);
    };

    Promise.all([fetchBtc(tsSec), fetchEth(tsSec, status), fetchDayPrices(date)])
      .then(function (res) {
        if (!active) return;
        var btc = res[0], eth = res[1];
        setBanner(
          '<span class="rb-tag">REPLAY</span> ' + fmtStamp(dateMs) +
          ' · <span class="mono">BTC #' + btc.height.toLocaleString('en-US') + '</span>' +
          ' · <span class="mono">ETH #' + eth.height.toLocaleString('en-US') + '</span>' +
          ' · sized at that day’s prices' +
          ' <button id="replay-exit" class="rb-exit">BACK TO LIVE</button>');
        document.getElementById('replay-exit').addEventListener('click', stop);
        schedule(btc, eth);
      })
      .catch(function (e) {
        setBanner('<span class="rb-tag rb-err">REPLAY</span> couldn’t load that moment (' +
          String(e.message || e).slice(0, 60) + ') — back to live', 'err');
        active = false;
        setTimeout(function () { els.banner.hidden = true; }, 5000);
      });
  }

  function stop() {
    active = false;
    if (timer) { clearInterval(timer); timer = null; }
    queue.length = 0;
    els.banner.hidden = true;
  }

  function init() {
    els.banner = document.getElementById('replay-banner');
    els.panel = document.getElementById('rewind-panel');
    var btn = document.getElementById('btn-rewind');
    var input = document.getElementById('rewind-input');
    var go = document.getElementById('rewind-go');
    if (!els.banner || !els.panel || !btn || !input || !go) return;

    // default: 24h ago, capped to 10 minutes ago
    var maxDate = new Date(Date.now() - 10 * 60000);
    function toLocalInput(d) {
      var p = function (n) { return (n < 10 ? '0' : '') + n; };
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
        'T' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
    input.max = toLocalInput(maxDate);
    input.value = toLocalInput(new Date(Date.now() - 86400000));

    btn.addEventListener('click', function () {
      els.panel.hidden = !els.panel.hidden;
    });
    go.addEventListener('click', function () {
      var v = input.value;
      if (!v) return;
      var ms = new Date(v).getTime();
      if (!isFinite(ms)) return;
      if (ms > maxDate.getTime()) ms = maxDate.getTime();
      start(ms);
    });
  }

  return { init: init, isActive: isActive, stop: stop };
})();
