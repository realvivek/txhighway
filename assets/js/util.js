/* TX Highway — shared utilities: formatters + resilient WebSocket wrapper. */
window.TXH = window.TXH || {};

TXH.util = (function () {

  function fmtUsd(n) {
    if (n == null || isNaN(n)) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    if (n >= 1) return '$' + n.toFixed(2);
    return '$' + n.toFixed(4);
  }

  function fmtPrice(n) {
    if (n == null || isNaN(n)) return '—';
    return '$' + n.toLocaleString('en-US', { maximumFractionDigits: n >= 1000 ? 0 : 2 });
  }

  function fmtNum(n) {
    if (n == null || isNaN(n)) return '—';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e4) return (n / 1e3).toFixed(0) + 'K';
    return n.toLocaleString('en-US');
  }

  function fmtCoin(v, sym) {
    if (v == null || isNaN(v)) return '—';
    var s;
    if (v === 0) s = '0';
    else if (v >= 100) s = v.toFixed(1);
    else if (v >= 1) s = v.toFixed(3);
    else if (v >= 0.001) s = v.toFixed(4);
    else s = v.toFixed(6);
    return s + ' ' + sym;
  }

  function shortHash(h) {
    if (!h) return '—';
    return h.slice(0, 8) + '…' + h.slice(-6);
  }

  function hexToNum(hex) {
    if (hex == null) return 0;
    return parseInt(hex, 16) || 0;
  }

  // wei hex -> ETH float (safe for display; precision loss irrelevant visually)
  function weiHexToEth(hex) {
    if (!hex || hex === '0x0') return 0;
    return parseInt(hex, 16) / 1e18;
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

  /* Resilient WebSocket: auto-reconnect with backoff, endpoint rotation,
   * silence watchdog, status callbacks. All feeds run through this. */
  function Feed(opts) {
    this.name = opts.name;
    this.urls = Array.isArray(opts.urls) ? opts.urls : [opts.urls];
    this.urlIdx = 0;
    this.onOpen = opts.onOpen || function () {};
    this.onMessage = opts.onMessage || function () {};
    this.onStatus = opts.onStatus || function () {};
    this.heartbeat = opts.heartbeat || null; // fn(ws) called on interval
    this.silenceMs = opts.silenceMs || TXH.config.engine.feedSilenceReconnectMs;
    this.backoff = 1000;
    this.ws = null;
    this.lastMsg = 0;
    this.closedByUs = false;
    this.timers = [];
  }

  Feed.prototype.connect = function () {
    var self = this;
    this.clearTimers();
    this.closedByUs = false;
    var url = this.urls[this.urlIdx % this.urls.length];
    this.currentUrl = url;
    this.onStatus('connecting');
    var ws;
    try { ws = new WebSocket(url); } catch (e) { this.retry(); return; }
    this.ws = ws;

    // a blackholed endpoint can sit in CONNECTING for minutes with no event —
    // give the handshake 12s, then force rotation to the next endpoint
    var handshakeTimer = setTimeout(function () {
      if (ws.readyState === 0) { try { ws.close(); } catch (e) {} self.onStatus('reconnecting'); self.retry(); }
    }, 12000);
    this.timers.push(handshakeTimer);

    ws.onopen = function () {
      clearTimeout(handshakeTimer);
      self.backoff = 1000;
      self.lastMsg = Date.now();
      self.onStatus('live');
      try { self.onOpen(ws); } catch (e) { /* feed continues */ }
      // heartbeat + silence watchdog
      self.timers.push(setInterval(function () {
        if (self.heartbeat && ws.readyState === 1) {
          try { self.heartbeat(ws); } catch (e) {}
        }
        if (Date.now() - self.lastMsg > self.silenceMs) {
          self.onStatus('reconnecting');
          try { ws.close(); } catch (e) {}
        }
      }, TXH.config.engine.heartbeatMs));
    };
    ws.onmessage = function (ev) {
      self.lastMsg = Date.now();
      try { self.onMessage(ev.data, ws); } catch (e) { /* bad message, keep stream */ }
    };
    ws.onerror = function () { /* onclose always follows */ };
    ws.onclose = function () {
      self.clearTimers();
      if (!self.closedByUs) { self.onStatus('reconnecting'); self.retry(); }
    };
  };

  Feed.prototype.retry = function () {
    var self = this;
    this.urlIdx++; // rotate endpoints on every retry
    var wait = this.backoff;
    this.backoff = Math.min(this.backoff * 1.8, 30000);
    this.timers.push(setTimeout(function () { self.connect(); }, wait));
  };

  Feed.prototype.send = function (obj) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
      return true;
    }
    return false;
  };

  Feed.prototype.clearTimers = function () {
    this.timers.forEach(function (t) { clearTimeout(t); clearInterval(t); });
    this.timers = [];
  };

  Feed.prototype.stop = function () {
    this.closedByUs = true;
    this.clearTimers();
    if (this.ws) { try { this.ws.close(); } catch (e) {} }
  };

  return {
    fmtUsd: fmtUsd, fmtPrice: fmtPrice, fmtNum: fmtNum, fmtCoin: fmtCoin,
    shortHash: shortHash, hexToNum: hexToNum, weiHexToEth: weiHexToEth,
    clamp: clamp, rand: rand, pick: pick, Feed: Feed
  };
})();
