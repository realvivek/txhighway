/* TX Highway — orchestrator. Wires feeds -> engine -> HUD.
 * Every module init is isolated so one failing feed never blanks the page.
 */
window.TXH = window.TXH || {};

TXH.app = (function () {
  var U = TXH.util;
  var prePriceBuffer = [];   // txs that arrive before the first price fetch

  function handleTx(tx) {
    // during a historical replay the roads belong to the past — live txs
    // keep feeding the stat tiles but don't spawn vehicles
    if (TXH.historical && TXH.historical.isActive()) return;
    var prices = TXH.prices.get();
    if (!prices.ready || !TXH.classic.ready()) {
      if (prePriceBuffer.length < 120) prePriceBuffer.push(tx);
      return;
    }
    var usd = TXH.prices.usd(tx.chain, tx.value);
    tx.usd = usd; // engine uses this for classing + congestion policy
    var cls = TXH.vehicles.classify(usd, tx);
    TXH.hud.countTx(tx, usd, cls);
    if (cls.id === 'whale') {
      try { TXH.telemetry.whale(tx.chain, usd); } catch (e) {}
      try { TXH.sound.play('whale'); } catch (e) {}
    }
    TXH.highway.spawn(tx);
  }

  function flushBuffer() {
    var buf = prePriceBuffer.splice(0, prePriceBuffer.length);
    buf.forEach(handleTx);
  }

  /* Compose a shareable PNG: the live road canvas + a branded LED banner.
   * All art is same-origin, so the canvas is clean for toDataURL. */
  function sharePng() {
    try {
      var road = document.getElementById('road');
      if (!road || !road.width) return;
      var c = document.createElement('canvas');
      c.width = road.width;
      c.height = road.height;
      var x = c.getContext('2d');
      x.drawImage(road, 0, 0);
      var k = road.width / Math.max(1, road.clientWidth); // device-pixel scale
      var bh = 46 * k;
      x.fillStyle = 'rgba(18, 21, 24, .92)';
      x.fillRect(0, c.height - bh, c.width, bh);
      x.fillStyle = '#ffc652';
      x.font = '700 ' + 15 * k + 'px "Fredoka", "Nunito", sans-serif';
      x.textBaseline = 'middle';
      var btcP = document.getElementById('price-btc-val');
      var ethP = document.getElementById('price-eth-val');
      x.fillText('TX HIGHWAY — LIVE BITCOIN & ETHEREUM TRAFFIC', 14 * k, c.height - bh * 0.62);
      x.fillStyle = '#9cc8ff';
      x.font = '600 ' + 11 * k + 'px "IBM Plex Mono", monospace';
      x.fillText('BTC ' + (btcP ? btcP.textContent : '') + ' · ETH ' + (ethP ? ethP.textContent : '') +
        ' · every vehicle is a real transaction · txhighway.onrender.com', 14 * k, c.height - bh * 0.24);
      c.toBlob(function (blob) {
        if (!blob) return;
        var file = null;
        try { file = new File([blob], 'tx-highway.png', { type: 'image/png' }); } catch (e) {}
        if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({
            files: [file], title: 'TX Highway',
            text: 'Live Bitcoin & Ethereum transactions as cartoon traffic',
            url: 'https://txhighway.onrender.com'
          }).catch(function () {});
        } else {
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'tx-highway.png';
          document.body.appendChild(a);
          a.click();
          setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
        }
      });
    } catch (e) { console.error('share failed', e); }
  }

  function bindControls() {
    var pauseBtn = document.getElementById('btn-pause');
    var speedSlider = document.getElementById('speed-slider');
    var speedVal = document.getElementById('speed-val');
    var aboutBtn = document.getElementById('btn-about');
    var about = document.getElementById('about-modal');

    if (pauseBtn) pauseBtn.addEventListener('click', function () {
      var p = !TXH.highway.isPaused();
      TXH.highway.setPaused(p);
      pauseBtn.textContent = p ? '▶' : '⏸';
      pauseBtn.setAttribute('aria-label', p ? 'resume' : 'pause');
    });
    if (speedSlider) speedSlider.addEventListener('input', function () {
      var s = parseFloat(speedSlider.value) || 1;
      TXH.highway.setSpeed(s);
      if (speedVal) speedVal.textContent = s + '×';
    });
    if (aboutBtn && about) aboutBtn.addEventListener('click', function () {
      about.hidden = !about.hidden;
    });
    var soundBtn = document.getElementById('btn-sound');
    if (soundBtn && TXH.sound) {
      soundBtn.textContent = TXH.sound.init() ? '🔊' : '🔇';
      soundBtn.addEventListener('click', function () {
        soundBtn.textContent = TXH.sound.toggle() ? '🔊' : '🔇';
      });
    }
    var shareBtn = document.getElementById('btn-share');
    if (shareBtn) shareBtn.addEventListener('click', sharePng);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (about) about.hidden = true;
        var rw = document.getElementById('rewind-panel');
        if (rw) rw.hidden = true;
        TXH.hud.hideCard();
      }
      if (e.key === ' ' && e.target === document.body) {
        e.preventDefault();
        if (pauseBtn) pauseBtn.click();
      }
      if (e.key === 'h' && !e.metaKey && !e.ctrlKey) {
        try { TXH.sound.play('honk'); } catch (err) {}
      }
    });
    var aboutClose = document.getElementById('about-close');
    if (aboutClose) aboutClose.addEventListener('click', function () { about.hidden = true; });
  }

  function renderLegend() {
    var legend = document.getElementById('legend-rows');
    if (!legend || !TXH.classic.ready()) return; // re-runs once the sheet lands
    var rows = [
      { id: 'bus',   name: 'carpool van',  range: 'pools < $1K · auto' },
      { id: 'car',   name: 'mini / city car', range: '< $1K · light traffic' },
      { id: 'sedan', name: 'sedan',        range: '$1K – $10K' },
      { id: 'truck', name: 'truck',        range: '$10K – $100K' },
      { id: 'semi',  name: 'semi trailer', range: '$100K – $1M' },
      { id: 'whale', name: 'whale rig',    range: 'over $1M' },
      { id: 'pod',   name: 'courier van',  range: 'contract call' }
    ];
    legend.innerHTML = rows.map(function (r) {
      var sprite = TXH.vehicles.build(r.id === 'pod' ? 'eth' : 'btc', r.id, 1, 2);
      var scale = Math.min(1, 76 / sprite.len);
      return '<div class="lg-item">' +
        '<img src="' + sprite.canvas.toDataURL() + '" alt="" style="width:' +
          Math.round(sprite.w * scale * 0.9) + 'px" />' +
        '<span class="lg-text"><span class="lg-name">' + r.name + '</span>' +
        '<span class="lg-range mono"' + (r.id === 'bus' ? ' id="lg-bus-range"' : '') + '>' +
          r.range + '</span></span></div>';
    }).join('');
  }

  function firstVisitHint() {
    try {
      if (localStorage.getItem('txh-seen')) return;
      localStorage.setItem('txh-seen', '1');
    } catch (e) { /* storage blocked -> still show once */ }
    var hint = document.getElementById('hint-toast');
    if (!hint) return;
    hint.hidden = false;
    setTimeout(function () { hint.classList.add('gone'); }, 9000);
    setTimeout(function () { hint.hidden = true; }, 9800);
  }

  function init() {
    document.body.classList.add('loaded');

    // sprite sheet is the only art source — load it first, everything
    // buffers gracefully until it lands (~1s)
    try {
      TXH.classic.load(function () {
        try { TXH.highway.refresh(); } catch (e) {}
        try { renderLegend(); } catch (e) {}
        if (TXH.prices.get().ready) flushBuffer();
      });
    } catch (e) { console.error('sheet load failed', e); }

    try { TXH.hud.init(); } catch (e) { console.error('hud init failed', e); }
    try { TXH.highway.init(document.getElementById('road')); } catch (e) { console.error('engine init failed', e); }
    try { TXH.prices.init(); } catch (e) { console.error('prices init failed', e); }
    try { TXH.btcFeed.init(); } catch (e) { console.error('btc feed init failed', e); }
    try { TXH.ethFeed.init(); } catch (e) { console.error('eth feed init failed', e); }
    try { renderLegend(); } catch (e) { console.error('legend failed', e); }
    try { TXH.telemetry.init(); } catch (e) { console.error('telemetry init failed', e); }
    try { TXH.historical.init(); } catch (e) { console.error('historical init failed', e); }

    TXH.prices.onUpdate(function (p) {
      TXH.hud.renderPrices(p);
      if (p.ready && TXH.classic.ready()) flushBuffer();
    });

    TXH.btcFeed.on('tx', handleTx);
    TXH.btcFeed.on('stats', TXH.hud.renderBtcStats);
    TXH.btcFeed.on('block', function (ev) {
      TXH.highway.blockPulse('btc');
      TXH.hud.blockChip(ev);
      try { TXH.telemetry.noteBlock('btc'); } catch (e) {}
      try { TXH.sound.play('block'); } catch (e) {}
    });
    TXH.btcFeed.on('status', function (s) { TXH.hud.setFeedStatus(s.feed, s.state); });

    TXH.ethFeed.on('tx', handleTx);
    TXH.ethFeed.on('stats', TXH.hud.renderEthStats);
    TXH.ethFeed.on('block', function (ev) {
      TXH.highway.blockPulse('eth');
      TXH.hud.blockChip(ev);
      try { TXH.telemetry.noteBlock('eth'); } catch (e) {}
      try { TXH.sound.play('block'); } catch (e) {}
    });
    TXH.ethFeed.on('status', function (s) { TXH.hud.setFeedStatus(s.feed, s.state); });

    TXH.highway.onVehicleClick(function (v, x, y) {
      TXH.highway.selectVehicle(v);
      if (v) {
        TXH.hud.showCard(v, x, y);
        try { TXH.sound.play('honk'); } catch (e) {}
      } else {
        TXH.hud.hideCard();
      }
    });

    bindControls();
    firstVisitHint();

    // web fonts change the boards' measured height — re-run layout once
    // they land so the road reserve and board centering stay exact
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        try { TXH.highway.refresh(); } catch (e) {}
      });
    }

    // keep the legend's carpool tier honest as pooling auto-scales
    setInterval(function () {
      try {
        var info = TXH.highway.aggInfo();
        var el = document.getElementById('lg-bus-range');
        if (!el) return;
        var mx = Math.max(info.btc, info.eth);
        el.textContent = 'pools < ' + U.fmtUsd(mx).replace('.0', '') +
          (info.btc !== info.eth ? ' · auto' : ' · auto');
      } catch (e) {}
    }, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { init: init };
})();
