/* TX Highway — HUD: prices, per-chain stat tiles, feed status, block chips,
 * transaction card. All DOM (crisp text), canvas stays pure motion.
 */
window.TXH = window.TXH || {};

TXH.hud = (function () {
  var U = TXH.util;
  var els = {};
  var feedStates = {}; // feed name -> state
  var session = {
    btc: { txs: 0, vol: 0, whales: 0 },
    eth: { txs: 0, vol: 0, whales: 0 }
  };
  var SPARK_N = 60; // seconds of throughput history
  var rate = {
    btc: { buf: [], cur: 0 },
    eth: { buf: [], cur: 0 }
  };
  var rateNow = { btc: 0, eth: 0 }; // rolling 10s average, for ticker + title

  function $(id) { return document.getElementById(id); }

  function init() {
    els.priceBtc = $('price-btc-val');
    els.priceEth = $('price-eth-val');
    els.card = $('tx-card');
    els.chips = { btc: $('chips-btc'), eth: $('chips-eth') };
    ['btc', 'eth'].forEach(function (c) {
      els[c] = {
        height: $(c + '-height'),
        fee: $(c + '-fee'),
        load: $(c + '-load'),
        txs: $(c + '-txs'),
        vol: $(c + '-vol'),
        status: $(c + '-status'),
        statusText: $(c + '-status-text'),
        spark: $(c + '-spark'),
        rate: $(c + '-rate')
      };
    });
    document.addEventListener('pointerdown', function (e) {
      if (els.card && !els.card.hidden && !els.card.contains(e.target) &&
          e.target.tagName !== 'CANVAS') hideCard();
    });
    setInterval(rateTick, 1000);
  }

  /* ---- throughput sparkline: real arrival rate, one bucket per second ---- */

  function rateTick() {
    ['btc', 'eth'].forEach(function (c) {
      var r = rate[c];
      r.buf.push(r.cur);
      r.cur = 0;
      if (r.buf.length > SPARK_N) r.buf.shift();
      var recent = r.buf.slice(-10);
      rateNow[c] = recent.reduce(function (a, b) { return a + b; }, 0) / Math.max(1, recent.length);
      if (els[c] && els[c].rate) {
        els[c].rate.textContent = (rateNow[c] < 10 ? rateNow[c].toFixed(1) : Math.round(rateNow[c])) + '/s';
      }
      drawSpark(c);
    });
    var totalRate = rateNow.btc + rateNow.eth;
    if (totalRate > 0.5) {
      document.title = Math.round(totalRate) + ' tx/s live — TX Highway';
    }
  }

  function drawSpark(chain) {
    var canvas = els[chain] && els[chain].spark;
    if (!canvas || !canvas.clientWidth) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = canvas.clientWidth, h = canvas.clientHeight || 26;
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    var x = canvas.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, w, h);
    var buf = rate[chain].buf;
    if (!buf.length) return;
    var max = Math.max(3, Math.max.apply(null, buf));
    // LED colors to match the gantry board the tile lives on
    var led = chain === 'btc' ? '#ffc652' : '#9cc8ff';
    var step = w / Math.max(1, SPARK_N - 1);
    var x0 = w - (buf.length - 1) * step; // right-aligned: newest at the right edge
    x.beginPath();
    for (var i = 0; i < buf.length; i++) {
      var px = x0 + i * step;
      var py = h - 2 - (buf[i] / max) * (h - 5);
      if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.strokeStyle = led;
    x.lineWidth = 2;
    x.lineJoin = 'round';
    x.shadowColor = led;
    x.shadowBlur = 5;
    x.stroke();
    x.shadowBlur = 0;
    x.lineTo(w, h); x.lineTo(x0, h); x.closePath();
    x.globalAlpha = 0.14;
    x.fillStyle = led;
    x.fill();
    x.globalAlpha = 1;
  }

  /* ---- prices ---- */
  function renderPrices(p) {
    if (els.priceBtc) els.priceBtc.textContent = U.fmtPrice(p.btc);
    if (els.priceEth) els.priceEth.textContent = U.fmtPrice(p.eth);
  }

  /* ---- per-chain stats ---- */
  function renderBtcStats(s) {
    var e = els.btc;
    if (!e) return;
    if (s.height != null) e.height.textContent = '#' + s.height.toLocaleString('en-US');
    if (s.fastestFee != null) e.fee.textContent = s.fastestFee + ' sat/vB';
    if (s.mempoolCount != null) e.load.textContent = U.fmtNum(s.mempoolCount) + ' pending';
  }

  function renderEthStats(s) {
    var e = els.eth;
    if (!e) return;
    if (s.height != null) e.height.textContent = '#' + s.height.toLocaleString('en-US');
    if (s.baseFeeGwei != null) {
      e.fee.textContent = (s.baseFeeGwei < 1 ? s.baseFeeGwei.toFixed(2) : s.baseFeeGwei.toFixed(1)) + ' gwei';
    }
    var bits = [];
    if (s.pendingRate != null) bits.push(s.pendingRate.toFixed(1) + '/s');
    if (s.gasUsedPct != null) bits.push(s.gasUsedPct + '%');
    if (bits.length) e.load.textContent = bits.join(' · ');
  }

  /* ---- session counters ---- */
  function countTx(tx, usd, cls) {
    var s = session[tx.chain];
    s.txs++;
    if (rate[tx.chain]) rate[tx.chain].cur++;
    if (usd) s.vol += usd;
    if (cls.id === 'whale') s.whales++;
    var e = els[tx.chain];
    if (e) {
      e.txs.textContent = U.fmtNum(s.txs);
      e.vol.textContent = U.fmtUsd(s.vol);
    }
  }

  /* ---- feed status (aggregated per chain, shown with label not color-alone) ---- */
  function setFeedStatus(feed, state) {
    feedStates[feed] = state;
    var chains = { btc: ['btc-tx', 'btc-stats'], eth: ['eth'] };
    Object.keys(chains).forEach(function (chain) {
      var worst = 'live';
      chains[chain].forEach(function (f) {
        var st = feedStates[f] || 'connecting';
        if (st !== 'live') worst = st;
      });
      var e = els[chain];
      if (!e || !e.status) return;
      e.status.className = 'status-dot ' + (worst === 'live' ? 'ok' : 'warn');
      e.statusText.textContent = worst === 'live' ? 'LIVE' : worst.toUpperCase();
    });
  }

  /* ---- block chips ---- */
  function blockChip(ev) {
    var host = els.chips[ev.chain];
    var height = Number(ev.height);
    if (!host || !isFinite(height)) return;
    var div = document.createElement('div');
    div.className = 'block-chip chip-' + ev.chain;
    var detail = ev.chain === 'btc'
      ? (isFinite(ev.txCount) && ev.txCount != null ? U.fmtNum(ev.txCount) + ' tx sealed' : 'new block')
      : (isFinite(ev.gasUsedPct) && ev.gasUsedPct != null ? ev.gasUsedPct + '% full · ' +
          (ev.baseFeeGwei < 1 ? ev.baseFeeGwei.toFixed(2) : ev.baseFeeGwei.toFixed(1)) + ' gwei' : 'new block');
    div.innerHTML = '<span class="chip-kicker">BLOCK MINED</span>' +
      '<span class="chip-height">#' + height.toLocaleString('en-US') + '</span>' +
      '<span class="chip-detail">' + detail + '</span>';
    host.appendChild(div);
    while (host.children.length > 2) host.removeChild(host.firstChild);
    setTimeout(function () {
      div.classList.add('gone');
      setTimeout(function () { if (div.parentNode) div.parentNode.removeChild(div); }, 600);
    }, 7000);
  }

  /* ---- transaction card ---- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function showCard(v, cx, cy) {
    var tx = v.tx;
    var cfg = TXH.config.chains[tx.chain];

    if (tx.isBatch) {
      var brows = [['combined value', U.fmtUsd(tx.usd)], ['largest rider', U.fmtUsd(tx.maxUsd)]];
      if (tx.calls) brows.push(['contract calls', tx.calls]);
      els.card.innerHTML =
        '<div class="card-head" style="--chain:' + (cfg.accentInk || cfg.accent) + '">' +
          '<span class="card-chain">' + cfg.name + '</span>' +
          '<span class="card-class">carpool</span>' +
          '<button class="card-x" id="card-close" aria-label="close">×</button>' +
        '</div>' +
        '<div class="card-hash">' + tx.count + ' real transactions riding together</div>' +
        brows.map(function (r) {
          return '<div class="card-row"><span>' + r[0] + '</span><span>' + r[1] + '</span></div>';
        }).join('') +
        '<p class="card-note">transactions under ' + U.fmtUsd(tx.tierUsd || 1000).replace('.0', '') +
        ' share a van so the road stays readable — the badge is the rider count, and the threshold rises automatically in heavy traffic</p>';
      placeCard(cfg, cx, cy);
      return;
    }

    var rows = [];
    rows.push(['value', U.fmtCoin(tx.value, cfg.unit) +
      (v.usd != null ? ' <span class="dim">(' + U.fmtUsd(v.usd) + ')</span>' : '')]);
    if (tx.chain === 'btc') {
      // total fee in sats is exact; a sat/vB rate is NOT computable from this
      // feed (raw size only, no witness data) so we never display one here
      if (isFinite(tx.feeSats) && tx.feeSats) {
        var feeUsd = TXH.prices.usd('btc', tx.feeSats / 1e8);
        rows.push(['fee', U.fmtNum(tx.feeSats) + ' sat' +
          (feeUsd != null ? ' <span class="dim">(' + U.fmtUsd(feeUsd) + ')</span>' : '')]);
      }
      if (isFinite(tx.size) && tx.size) rows.push(['size', Math.round(tx.size) + ' B']);
    } else {
      if (tx.isContractCall) rows.push(['type', 'contract call']);
      if (isFinite(tx.gasPriceGwei) && tx.gasPriceGwei) {
        rows.push([tx.gasIsMax ? 'max gas' : 'gas price', tx.gasPriceGwei.toFixed(2) + ' gwei']);
      }
      if (tx.to) rows.push(['to', '<span class="mono">' + esc(U.shortHash(tx.to)) + '</span>']);
    }
    var url = tx.chain === 'btc'
      ? TXH.config.endpoints.btcExplorer(tx.hash)
      : TXH.config.endpoints.ethExplorer(tx.hash);

    els.card.innerHTML =
      '<div class="card-head" style="--chain:' + (cfg.accentInk || cfg.accent) + '">' +
        '<span class="card-chain">' + cfg.name + '</span>' +
        '<span class="card-class">' + esc(v.cls.label) + '</span>' +
        '<button class="card-x" id="card-close" aria-label="close">×</button>' +
      '</div>' +
      '<div class="card-hash mono">' + esc(U.shortHash(tx.hash)) + '</div>' +
      rows.map(function (r) {
        return '<div class="card-row"><span>' + r[0] + '</span><span>' + r[1] + '</span></div>';
      }).join('') +
      '<a class="card-link" href="' + esc(url) + '" target="_blank" rel="noopener">view on explorer ↗</a>';

    placeCard(cfg, cx, cy);
  }

  function placeCard(cfg, cx, cy) {
    els.card.style.setProperty('--chain-border', cfg.accent);
    els.card.hidden = false;
    var cw = els.card.offsetWidth, ch = els.card.offsetHeight;
    var x = U.clamp(cx + 14, 8, window.innerWidth - cw - 8);
    var y = U.clamp(cy - ch - 14, 62, window.innerHeight - ch - 8);
    els.card.style.left = x + 'px';
    els.card.style.top = y + 'px';
    var closeBtn = document.getElementById('card-close');
    if (closeBtn) closeBtn.addEventListener('click', hideCard);
  }

  function hideCard() {
    if (els.card) els.card.hidden = true;
    if (TXH.highway && TXH.highway.selectVehicle) TXH.highway.selectVehicle(null);
  }

  return {
    init: init,
    currentRate: function (chain) { return rateNow[chain] || 0; },
    renderPrices: renderPrices,
    renderBtcStats: renderBtcStats,
    renderEthStats: renderEthStats,
    countTx: countTx,
    setFeedStatus: setFeedStatus,
    blockChip: blockChip,
    showCard: showCard,
    hideCard: hideCard
  };
})();
