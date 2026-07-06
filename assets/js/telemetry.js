/* TX Highway — telemetry: the narrative layer on top of the raw feeds.
 * Last-block clocks (the 10-min vs 12-sec heartbeat), 24h network totals,
 * fee-trend history, whale alerts, Base L2 side-road throughput, and the
 * rotating LED news ticker on each gantry. Everything degrades to '—' or a
 * skipped ticker line when a source is unreachable — no feature here can
 * break the road.
 */
window.TXH = window.TXH || {};

TXH.telemetry = (function () {
  var U = TXH.util;
  var els = {};
  var lastBlockAt = { btc: null, eth: null };
  var feeHist = { btc: [], eth: [] };   // one sample/min of fee level, ~75min kept
  var daily = { btc: null, eth: null }; // 24h network tx totals (eth is an estimate)
  var whaleNews = { btc: null, eth: null };
  var l2 = { rate: null, samples: [] }; // Base blocks, rolling 75s window
  var tickerIdx = { btc: -1, eth: -1 };
  var reduced = false;
  var baseReqId = 1000;
  var basePending = {};

  function $(id) { return document.getElementById(id); }

  function init() {
    ['btc', 'eth'].forEach(function (c) {
      els[c] = {
        last: $(c + '-last'),
        daily: $(c + '-daily'),
        ticker: $(c + '-ticker'),
        board: document.querySelector('.shoulder-' + c)
      };
    });
    reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setInterval(clockTick, 1000);
    setInterval(sampleFees, 60000);
    seedBtcTip();
    fetchBtcDaily();
    estimateEthDaily();
    connectBase();
    bindTickers();
  }

  /* ---- last-block clocks: Bitcoin's slow heartbeat vs Ethereum's pulse ---- */

  function noteBlock(chain) { lastBlockAt[chain] = Date.now(); }

  function fmtAgo(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60);
    if (m >= 60) return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
    return m + 'm ' + (s % 60) + 's';
  }

  function clockTick() {
    ['btc', 'eth'].forEach(function (c) {
      var e = els[c];
      if (!e) return;
      if (e.last) e.last.textContent = lastBlockAt[c] ? fmtAgo(Date.now() - lastBlockAt[c]) : '—';
      if (e.daily) {
        e.daily.textContent = daily[c] != null
          ? (c === 'eth' ? '≈' : '') + U.fmtNum(daily[c]) + ' tx'
          : '—';
      }
    });
  }

  function seedBtcTip() {
    fetch(TXH.config.endpoints.btcRecentBlocks).then(function (r) { return r.json(); }).then(function (bs) {
      if (!lastBlockAt.btc && bs && bs[0] && bs[0].timestamp) lastBlockAt.btc = bs[0].timestamp * 1000;
    }).catch(function () {});
  }

  /* ---- 24h network totals ---- */

  function fetchBtcDaily() {
    fetch(TXH.config.endpoints.btcDailyTxs).then(function (r) { return r.json(); }).then(function (j) {
      var v = j && j.values;
      if (v && v.length) daily.btc = Math.round(v[v.length - 1].y);
    }).catch(function () {}).then(function () {
      setTimeout(fetchBtcDaily, 3600000);
    });
  }

  function rpc(method, params) {
    return fetch(TXH.config.endpoints.ethHttpRPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: method, params: params || [] })
    }).then(function (r) { return r.json(); }).then(function (j) { return j.result; });
  }

  /* No keyless source publishes an exact ETH daily count, so estimate it:
   * average tx count over blocks sampled across the last ~12h x blocks/day. */
  function estimateEthDaily() {
    rpc('eth_blockNumber').then(function (tipHex) {
      var tip = parseInt(tipHex, 16);
      if (!tip) return null;
      var offsets = [0, 700, 1400, 2100, 2800, 3500];
      return Promise.all(offsets.map(function (o) {
        return rpc('eth_getBlockTransactionCountByNumber', ['0x' + (tip - o).toString(16)])
          .catch(function () { return null; });
      })).then(function (counts) {
        var ns = [];
        counts.forEach(function (c) { if (c != null) ns.push(parseInt(c, 16) || 0); });
        if (ns.length >= 3) {
          var avg = ns.reduce(function (a, b) { return a + b; }, 0) / ns.length;
          daily.eth = Math.round(avg * 7170); // ~12.05s block time
        }
      });
    }).catch(function () {}).then(function () {
      setTimeout(estimateEthDaily, 3600000);
    });
  }

  /* ---- fee-trend history ---- */

  function sampleFees() {
    var now = Date.now();
    try {
      var bf = TXH.btcFeed && TXH.btcFeed.stats().halfHourFee;
      if (bf) pushCap(feeHist.btc, { t: now, v: bf });
    } catch (e) {}
    try {
      var ef = TXH.ethFeed && TXH.ethFeed.stats().baseFeeGwei;
      if (ef) pushCap(feeHist.eth, { t: now, v: ef });
    } catch (e) {}
  }

  function pushCap(arr, x) { arr.push(x); if (arr.length > 75) arr.shift(); }

  function trendMsg(chain) {
    var hist = feeHist[chain];
    if (hist.length < 6) return null;
    var cur = hist[hist.length - 1].v;
    var base = hist[0];
    if (!base.v) return null;
    var pct = (cur - base.v) / base.v;
    var mins = Math.round((Date.now() - base.t) / 60000);
    var unit = chain === 'btc' ? ' sat/vB' : ' gwei';
    var val = chain === 'btc' ? String(Math.round(cur)) : (cur < 1 ? cur.toFixed(2) : cur.toFixed(1));
    if (pct > 0.15) return 'RUSH HOUR — FEES ' + val + unit + ', UP ' + Math.round(pct * 100) + '% IN ' + mins + ' MIN';
    if (pct < -0.15) return 'ROAD CLEARING — FEES ' + val + unit + ', DOWN ' + Math.round(-pct * 100) + '% IN ' + mins + ' MIN';
    return 'FEES STEADY — ' + val + unit;
  }

  /* ---- whale moments ---- */

  function whale(chain, usd) {
    whaleNews[chain] = { t: Date.now(), usd: usd };
    var board = els[chain] && els[chain].board;
    if (board && !reduced) {
      board.classList.remove('whale-flash');
      void board.offsetWidth; // restart the animation
      board.classList.add('whale-flash');
    }
    showTicker(chain, (U.fmtUsd(usd) + ' WHALE ENTERING THE HIGHWAY').toUpperCase(), true);
  }

  /* ---- Base L2 side road (Ethereum board only) ---- */

  function connectBase() {
    try {
      var feed = new U.Feed({
        name: 'base',
        urls: TXH.config.endpoints.baseWS,
        onOpen: function (ws) {
          ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: ['newHeads'] }));
        },
        onMessage: function (data, ws) {
          var m = JSON.parse(data);
          if (m.method === 'eth_subscription' && m.params && m.params.result && m.params.result.number) {
            var id = ++baseReqId;
            basePending[id] = true;
            ws.send(JSON.stringify({ jsonrpc: '2.0', id: id, method: 'eth_getBlockTransactionCountByNumber', params: [m.params.result.number] }));
          } else if (m.id && basePending[m.id]) {
            delete basePending[m.id];
            var n = parseInt(m.result, 16);
            if (isFinite(n)) {
              l2.samples.push({ t: Date.now(), n: n });
              var cut = Date.now() - 75000;
              while (l2.samples.length && l2.samples[0].t < cut) l2.samples.shift();
              if (l2.samples.length >= 3) {
                var span = (l2.samples[l2.samples.length - 1].t - l2.samples[0].t) / 1000;
                var total = 0;
                l2.samples.forEach(function (s) { total += s.n; });
                if (span > 5) l2.rate = total / span;
              }
            }
          }
        },
        onStatus: function (s) { if (s !== 'live') { l2.rate = null; l2.samples.length = 0; } }
      });
      feed.connect();
    } catch (e) { /* board just skips the L2 line */ }
  }

  /* ---- LED news ticker ---- */

  function messages(chain) {
    var out = [];
    var w = whaleNews[chain];
    if (w && Date.now() - w.t < 180000) {
      out.push({ text: (U.fmtUsd(w.usd) + ' WHALE ON THE HIGHWAY — ' + fmtAgo(Date.now() - w.t) + ' AGO').toUpperCase(), alert: true });
    }
    var t = trendMsg(chain);
    if (t) out.push({ text: t });
    try {
      var rr = TXH.hud.currentRate(chain);
      if (rr > 0.2) out.push({ text: 'ROAD FLOW ' + (rr < 10 ? rr.toFixed(1) : Math.round(rr)) + ' TX/S' });
    } catch (e) {}
    try {
      var agg = TXH.highway.aggInfo()[chain];
      if (agg > 1000) {
        out.push({ text: 'HEAVY TRAFFIC — POOLING TX UNDER ' + U.fmtUsd(agg).replace('.0', '').toUpperCase() });
      }
    } catch (e) {}
    try {
      if (chain === 'btc') {
        var s = TXH.btcFeed.stats();
        if (s.mempoolCount != null) {
          var mood = s.mempoolCount > 40000 ? 'HEAVY TRAFFIC' : s.mempoolCount > 8000 ? 'MODERATE TRAFFIC' : 'LIGHT TRAFFIC';
          out.push({ text: U.fmtNum(s.mempoolCount) + ' WAITING AT THE ON-RAMP — ' + mood });
        }
        if (daily.btc) out.push({ text: U.fmtNum(daily.btc) + ' TX CROSSED BITCOIN IN THE LAST 24H' });
      } else {
        var es = TXH.ethFeed.stats();
        if (es.gasUsedPct != null) out.push({ text: 'LAST BLOCK ' + es.gasUsedPct + '% FULL' });
        if (daily.eth) out.push({ text: 'ROUGHLY ' + U.fmtNum(daily.eth) + ' TX ON ETHEREUM IN THE LAST 24H' });
        if (l2.rate != null) {
          var line = 'BASE L2 SIDE ROAD RUNNING ' + l2.rate.toFixed(0) + ' TX/S';
          if (es.pendingRate > 1 && l2.rate / es.pendingRate > 1.5) {
            line += ' — ' + (l2.rate / es.pendingRate).toFixed(0) + 'X THE HIGHWAY';
          }
          out.push({ text: line });
        }
      }
    } catch (e) {}
    if (!out.length) out.push({ text: 'ALL LANES OPEN — WAITING ON NETWORK DATA' });
    return out;
  }

  function bindTickers() {
    ['btc', 'eth'].forEach(function (c) {
      var el = els[c] && els[c].ticker;
      if (!el) return;
      if (reduced) {
        setInterval(function () { rotate(c); }, 9000);
        rotate(c);
      } else {
        el.addEventListener('animationiteration', function () { rotate(c); });
      }
    });
  }

  function rotate(chain) {
    var list = messages(chain);
    tickerIdx[chain] = (tickerIdx[chain] + 1) % list.length;
    var m = list[tickerIdx[chain]];
    showTicker(chain, m.text, m.alert);
  }

  function showTicker(chain, text, alert) {
    var el = els[chain] && els[chain].ticker;
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('tk-alert', !!alert);
  }

  return { init: init, noteBlock: noteBlock, whale: whale };
})();
