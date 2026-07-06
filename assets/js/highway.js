/* TX Highway — canvas engine, classic cartoon edition.
 * One full-viewport canvas, two roads through green fields (BTC top, ETH
 * bottom), side-view sprite-sheet vehicles. Sprites are pre-rendered offscreen
 * and blitted each frame, so a few hundred concurrent transactions hold 60fps.
 */
window.TXH = window.TXH || {};

TXH.highway = (function () {
  var U = TXH.util;
  var canvas, ctx, dpr = 1;
  var W = 0, H = 0;
  var roads = [];
  var speedMult = 1;
  var paused = false;
  var reducedMotion = false;
  var lastT = 0;
  var clickHandler = null;
  var hoverVehicle = null;
  var selectedVehicle = null;

  /* ---------- layout ---------- */

  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, TXH.config.engine.dprCap);
    var rect = canvas.parentElement.getBoundingClientRect();
    W = Math.max(320, rect.width);
    H = Math.max(360, rect.height);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var half = H / 2;
    var narrow = W < 700;
    ['btc', 'eth'].forEach(function (chain, i) {
      var road = roads[i] || { chain: chain, vehicles: [], queue: [], dropCount: 0, gate: { pulse: 0 }, batch: newBatch(), tier: 0, cool: 0, loadT: 0 };
      road.chain = chain;
      road.y = i * half;
      road.h = half;
      var padTop = narrow ? Math.max(118, half * 0.32) : Math.max(56, half * 0.18);
      var padBot = Math.max(22, half * 0.09);
      // the road must start below the chain's stat panel, so measure the real
      // thing instead of guessing — panels grow with content, viewport, and
      // platform font inflation. The board NEVER overlaps the asphalt; if the
      // screen is short the road gets thinner and sheds lanes instead.
      // (+34 = margin above/below the board incl. its 5px drop shadow)
      var shoulderEl = document.querySelector(chain === 'btc' ? '.shoulder-btc' : '.shoulder-eth');
      if (shoulderEl && shoulderEl.offsetHeight) {
        var need = shoulderEl.offsetHeight + 34;
        padTop = Math.max(padTop, Math.min(need, half - padBot - 34));
      }
      var laneCount = TXH.config.chains[chain].lanes;
      if (narrow && laneCount > 4) laneCount = 4;
      var laneH = (half - padTop - padBot) / laneCount;
      while (laneH < 15 && laneCount > 2) {
        laneCount--;
        laneH = (half - padTop - padBot) / laneCount;
      }
      road.lanes = [];
      for (var l = 0; l < laneCount; l++) {
        road.lanes.push({
          idx: l,
          y: road.y + padTop + laneH * l,
          h: laneH,
          cy: road.y + padTop + laneH * l + laneH / 2,
          scale: 0.88 + (l / Math.max(1, laneCount - 1)) * 0.2, // far lanes smaller
          list: []
        });
      }
      road.roadTop = road.y + padTop - 8;
      road.roadBot = road.y + half - padBot + 8;
      // float the board vertically centered in its grass band, above the stripe
      if (shoulderEl && shoulderEl.offsetHeight) {
        var bandBot = road.roadTop - 5; // top of the chain accent stripe
        shoulderEl.style.top = Math.round(road.y +
          Math.max(4, (bandBot - road.y - shoulderEl.offsetHeight - 5) / 2)) + 'px';
      }
      // re-seat existing vehicles, recomputing every derived value
      road.vehicles.forEach(function (v) {
        var li = Math.min(road.lanes.length - 1, v.lane && v.lane.idx != null ? v.lane.idx : 0);
        v.lane = road.lanes[li];
        v.sprite = TXH.vehicles.build(v.tx.chain, v.cls.id, v.hueIdx || 0, dpr);
        v.scale = v.lane.scale;
        v.lenS = v.sprite.len * v.scale;
        v.speed = W / v.cross * (v.fast ? 1.14 : v.cheap ? 0.88 : 1);
        v.y = v.lane.cy - (v.sprite.bodyH * v.scale) / 2;
        road.lanes[li].list.push(v);
      });
      road.lanes.forEach(function (ln) { ln.list.sort(function (a, b) { return b.x - a.x; }); });
      roads[i] = road;
      buildAmbient(road);
    });
  }

  /* Static per-road backdrop: grass fields, asphalt, props. Pre-rendered once
   * per resize — the frame loop just blits it. */
  function buildAmbient(road) {
    var c = document.createElement('canvas');
    c.width = Math.ceil(W * dpr);
    c.height = Math.ceil(road.h * dpr);
    var a = c.getContext('2d');
    a.scale(dpr, dpr);
    var cfg = TXH.config.chains[road.chain];
    var rt = road.roadTop - road.y, rb = road.roadBot - road.y;

    // grass everywhere first
    a.fillStyle = '#5da03f';
    a.fillRect(0, 0, W, road.h);
    // mow bands + speckle so the green isn't flat
    for (var band = 0; band < road.h; band += 26) {
      if ((band / 26) % 2 === 0) {
        a.fillStyle = 'rgba(255,255,255,.045)';
        a.fillRect(0, band, W, 13);
      }
    }
    for (var s = 0; s < W / 3; s++) {
      a.fillStyle = Math.random() > 0.5 ? 'rgba(35,90,25,.25)' : 'rgba(215,240,160,.28)';
      var gy = Math.random() * road.h;
      if (gy < rt - 4 || gy > rb + 4) a.fillRect(Math.random() * W, gy, 2, 2);
    }

    // asphalt band — flat light gray with speckle grain
    a.fillStyle = '#908d86';
    a.fillRect(0, rt, W, rb - rt);
    for (var g = 0; g < W / 2; g++) {
      a.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.12)';
      a.fillRect(Math.random() * W, rt + 4 + Math.random() * (rb - rt - 8), U.rand(1, 3), 1.4);
    }
    a.fillStyle = 'rgba(0,0,0,.08)';
    a.fillRect(0, rt, W, 3); // shade under top edge

    // chain shoulder stripes outside the white edge lines
    a.fillStyle = cfg.accent;
    a.fillRect(0, rt - 5, W, 5);
    a.fillRect(0, rb, W, 5);
    // white edge lines
    a.fillStyle = 'rgba(255,255,255,.92)';
    a.fillRect(0, rt + 2, W, 3);
    a.fillRect(0, rb - 5, W, 3);

    // road watermark, like the original: chain glyph + name on the asphalt
    a.font = '700 30px Fredoka, "Nunito", sans-serif';
    a.fillStyle = 'rgba(255,255,255,.45)';
    a.textBaseline = 'middle';
    var label = (road.chain === 'btc' ? '₿  BITCOIN' : 'Ξ  ETHEREUM');
    a.fillText(label, W * 0.38, rt + (rb - rt) / 2);
    a.textBaseline = 'alphabetic';

    // props from the sheet (drawn only once it's loaded; layout() reruns after)
    if (TXH.classic.ready()) {
      var x = U.rand(20, 90);
      while (x < W - 40) {
        var r = Math.random();
        var topRoom = rt - 6;
        if (topRoom > 40) {
          if (r < 0.44) TXH.classic.drawProp(a, 'tree', (Math.random() * 5) | 0, x, topRoom, Math.min(topRoom - 4, U.rand(44, 72)));
          else if (r < 0.64) TXH.classic.drawProp(a, 'bush', (Math.random() * 3) | 0, x, topRoom, U.rand(18, 26));
          else if (r < 0.72) TXH.classic.drawProp(a, 'lamp', (Math.random() * 2) | 0, x, topRoom + 2, Math.min(topRoom - 2, U.rand(40, 54)));
          else if (r < 0.78) TXH.classic.drawProp(a, 'deer', (Math.random() * 2) | 0, x, topRoom, U.rand(24, 32));
          else if (r < 0.8) TXH.classic.drawProp(a, 'fox', 0, x, topRoom, 12);
        }
        x += U.rand(70, 160);
      }
      // second scatter row deeper in the verge when the panel reserve leaves
      // a wide green band — keeps the field from looking bare
      if (rt - 6 > 110) {
        x = U.rand(40, 180);
        while (x < W - 40) {
          var y2 = (rt - 6) * U.rand(0.42, 0.62);
          if (Math.random() < 0.7) TXH.classic.drawProp(a, 'tree', (Math.random() * 5) | 0, x, y2, U.rand(34, 56));
          else TXH.classic.drawProp(a, 'bush', (Math.random() * 3) | 0, x, y2, U.rand(16, 24));
          x += U.rand(130, 300);
        }
      }
      // sparse bottom verge
      x = U.rand(60, 160);
      while (x < W - 40) {
        var botRoom = road.h - rb - 6;
        if (botRoom > 18 && Math.random() < 0.55) {
          if (Math.random() < 0.6) TXH.classic.drawProp(a, 'bush', (Math.random() * 3) | 0, x, road.h - 4, Math.min(botRoom, U.rand(16, 24)));
          else TXH.classic.drawProp(a, 'tree', (Math.random() * 5) | 0, x, road.h - 2, Math.min(botRoom + 14, U.rand(30, 44)));
        }
        x += U.rand(160, 340);
      }
    }
    road.ambient = c;
  }

  /* ---------- spawning ---------- */

  // carpool thresholds: tier rises when the road is loaded so congestion
  // reads as bigger rider counts, not bumper-to-bumper sprites
  var AGG_TIERS = [1000, 10000, 100000];

  function newBatch() {
    return { count: 0, totalUsd: 0, maxUsd: 0, calls: 0, age: 0, items: [] };
  }

  function enqueue(road, tx) {
    var q = road.queue;
    if (q.length >= TXH.config.engine.maxQueue) { road.dropCount++; return; }
    q.push(tx);
  }

  function spawn(tx) {
    var road = tx.chain === 'btc' ? roads[0] : roads[1];
    if (!road) return;
    var usd = tx.usd != null ? tx.usd : (TXH.prices ? TXH.prices.usd(tx.chain, tx.value) : null);
    if (usd != null) tx.usd = usd;
    if (usd == null || usd < AGG_TIERS[road.tier || 0]) {
      var b = road.batch;
      b.count++;
      b.totalUsd += usd || 0;
      if ((usd || 0) > b.maxUsd) b.maxUsd = usd || 0;
      if (tx.isContractCall) b.calls++;
      if (b.items.length < 4) b.items.push(tx); // kept only for the tiny-batch fallback
      return;
    }
    enqueue(road, tx);
  }

  /* Flush a road's carpool: 4+ riders become one badged van; fewer spawn as
   * the individual small vehicles they'd have been in quiet traffic. */
  function flushBatch(road) {
    var b = road.batch;
    if (b.count >= 4) {
      enqueue(road, {
        chain: road.chain, isBatch: true, count: b.count,
        usd: b.totalUsd, maxUsd: b.maxUsd, calls: b.calls,
        tierUsd: AGG_TIERS[road.tier || 0]
      });
    } else {
      b.items.forEach(function (t) { enqueue(road, t); });
    }
    road.batch = newBatch();
  }

  /* Lanes are the fee market: overpayers ride the top express lanes, cheap
   * transactions crawl along the bottom, everyone else fills middle-out. */
  function laneOrder(road, band) {
    var n = road.lanes.length, idxs = [], i;
    for (i = 0; i < n; i++) idxs.push(i);
    if (band === 'fast') return idxs;
    if (band === 'cheap') return idxs.reverse();
    var mid = (n - 1) / 2;
    idxs.sort(function (a, b) { return Math.abs(a - mid) - Math.abs(b - mid); });
    return idxs;
  }

  function pickLane(road, needLen, band) {
    var order = laneOrder(road, band);
    var entry = Math.max(60, needLen * 0.6 + 40);
    for (var k = 0; k < order.length; k++) {
      var pln = road.lanes[order[k]];
      var plast = pln.list[pln.list.length - 1];
      if ((plast ? plast.x : W) > entry) return pln;
    }
    // preferred lanes jammed -> emptiest lane anywhere, or wait in queue
    var best = null, bestRoom = -1;
    for (var i = 0; i < road.lanes.length; i++) {
      var ln = road.lanes[i];
      var last = ln.list[ln.list.length - 1];
      var room = last ? last.x : W;
      if (room > bestRoom) { bestRoom = room; best = ln; }
    }
    if (bestRoom < needLen * 0.6 - 60) return null;
    return best;
  }

  function materialize(road, tx) {
    var usd, cls;
    if (tx.isBatch) {
      usd = tx.usd;
      cls = { id: 'bus', label: 'carpool', crossSec: 13 };
    } else {
      usd = tx.usd != null ? tx.usd : TXH.prices.usd(tx.chain, tx.value);
      cls = TXH.vehicles.classify(usd, tx);
    }
    var hueIdx = (Math.random() * 8) | 0; // variant picker (wraps per class)
    var sprite = TXH.vehicles.build(tx.chain, cls.id, hueIdx, dpr);
    // fee band decides lane preference AND speed: overpayers up top, driving
    // faster; underpayers crawl the bottom lanes
    var fast = false, cheap = false;
    if (tx.chain === 'btc' && tx.feeRate) {
      var going = TXH.btcFeed && TXH.btcFeed.stats().halfHourFee;
      if (going) { fast = tx.feeRate > going * 2; cheap = tx.feeRate < going * 0.7; }
    } else if (tx.chain === 'eth' && tx.gasPriceGwei) {
      var base = TXH.ethFeed && TXH.ethFeed.stats().baseFeeGwei;
      if (base) { fast = tx.gasPriceGwei > base * 2.5; cheap = tx.gasPriceGwei < base * 1.02; }
    }
    var band = tx.isBatch || cheap ? 'cheap' : (fast ? 'fast' : 'mid');
    var lane = pickLane(road, sprite.len, band);
    if (!lane) return false;
    var cross = cls.crossSec * U.rand(0.9, 1.12);
    var scale = lane.scale;
    if (tx.isBatch) scale *= 1 + Math.min(0.45, tx.count / 180); // big carpools grow
    var lenS = sprite.len * scale;
    var x = -lenS - U.rand(6, 60);
    var last = lane.list[lane.list.length - 1];
    var gap = 20 + lenS * 0.3;
    if (last && x > last.x - gap - lenS) x = last.x - gap - lenS;
    if (x < -W * 0.5) return false;
    var v = {
      tx: tx, usd: usd, cls: cls, sprite: sprite, hueIdx: hueIdx,
      lane: lane, lenS: lenS, gap: gap, x: x,
      y: lane.cy - (sprite.bodyH * scale) / 2 + U.rand(-1.5, 1.5),
      cross: cross,
      speed: W / cross * (fast ? 1.14 : cheap ? 0.88 : 1),
      scale: scale, age: 0, fast: fast, cheap: cheap, hover: false
    };
    road.vehicles.push(v);
    lane.list.push(v);
    return true;
  }

  /* ---------- block gate + confetti ---------- */

  function blockPulse(chain) {
    var road = chain === 'btc' ? roads[0] : roads[1];
    if (!road) return;
    road.gate.pulse = 1;
    road.surge = 1; // gate opens: traffic briefly accelerates through
    for (var i = 0; i < 6; i++) {
      burst(W - 30, U.rand(road.roadTop + 10, road.roadBot - 10), 4, road.chain);
    }
  }

  var particles = [];
  var CONFETTI = { btc: ['#f7931a', '#ffd54f', '#ffffff'], eth: ['#5b76f7', '#8fd3ff', '#ffffff'] };

  function burst(x, y, n, chain) {
    if (reducedMotion) return;
    for (var i = 0; i < n && particles.length < 120; i++) {
      particles.push({
        x: x + U.rand(-4, 4), y: y + U.rand(-4, 4),
        vx: U.rand(-80, 30), vy: U.rand(-70, 70),
        life: 1, decay: U.rand(1.3, 2.4),
        color: U.pick(CONFETTI[chain] || CONFETTI.btc),
        spin: U.rand(0, 6.28)
      });
    }
  }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += 60 * dt; // confetti falls
      p.life -= p.decay * dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.life * 1.4);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin + p.life * 4);
      ctx.fillStyle = p.color;
      ctx.fillRect(-2, -1.4, 4, 2.8);
      ctx.restore();
    }
  }

  /* ---------- drawing ---------- */

  function drawRoad(road) {
    if (road.ambient) ctx.drawImage(road.ambient, 0, road.y, W, road.h);

    // white lane dashes — static, like real road paint (only cars move)
    ctx.strokeStyle = 'rgba(255,255,255,.95)';
    ctx.lineWidth = 3;
    ctx.setLineDash([30, 38]);
    ctx.lineDashOffset = 0;
    for (var l = 1; l < road.lanes.length; l++) {
      var y = road.lanes[l].y;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.setLineDash([]);

    // toll gantry at the end of the road — flashes when a block is mined
    var gx = W - 34;
    var gt = road.roadTop - 12, gb = road.roadBot + 4;
    ctx.fillStyle = '#3b3f46';
    ctx.fillRect(gx - 3, gt, 6, gb - gt); // post
    var flash = road.gate.pulse;
    ctx.fillStyle = flash > 0.05 ? 'rgba(80,200,90,' + (0.5 + flash * 0.5) + ')' : '#c9463d';
    ctx.beginPath(); ctx.arc(gx, gt + 6, 5, 0, 7); ctx.fill(); // signal head
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(gx, gt + 6, 5, 0, 7); ctx.stroke();
    // striped crossbar
    for (var seg = 0; seg < Math.floor((gb - gt - 16) / 12); seg++) {
      ctx.fillStyle = seg % 2 ? '#ffffff' : (flash > 0.05 ? '#69c96f' : '#c9463d');
      ctx.fillRect(gx - 2, gt + 14 + seg * 12, 4, 12);
    }
  }

  function drawVehicle(v) {
    var s = v.sprite, sc = v.scale;
    var dx = v.x - s.padL * sc;
    var dy = v.y - s.padT * sc;
    ctx.globalAlpha = Math.min(1, v.age * 3); // spawn fade-in
    if (v.hover) {
      ctx.save();
      ctx.shadowColor = 'rgba(30,40,60,.7)';
      ctx.shadowBlur = 10;
    }
    ctx.drawImage(s.canvas, dx, dy, s.w * sc, s.h * sc);
    if (v.hover) ctx.restore();
    if (v.tx && v.tx.isBatch) {
      // rider-count badge above the carpool van
      var label = '×' + v.tx.count;
      ctx.font = '700 10px "IBM Plex Mono", ui-monospace, monospace';
      var bw = ctx.measureText(label).width + 10, bh = 15;
      // sits on the van roof so it reads as attached, not floating in the lane
      var bx = v.x + (v.lenS - bw) / 2, by = v.y - bh + 3;
      ctx.fillStyle = 'rgba(255,255,255,.94)';
      if (ctx.roundRect) {
        ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(34,48,31,.45)'; ctx.lineWidth = 1.5; ctx.stroke();
      } else {
        ctx.fillRect(bx, by, bw, bh);
      }
      ctx.fillStyle = '#22301c';
      ctx.fillText(label, bx + 5, by + 11);
    }
    ctx.globalAlpha = 1;
  }

  function frame(t) {
    var dt = Math.min((t - lastT) / 1000, 0.05);
    lastT = t;
    if (!paused) {
      update(dt);
    }
    render();
    requestAnimationFrame(frame);
  }

  function update(dt) {
    // phones get a lower vehicle cap: less asphalt, fewer sprites to read
    var maxV = TXH.config.engine.maxVehiclesPerRoad;
    if (W < 700) maxV = (maxV * 0.6) | 0;
    roads.forEach(function (road) {
      var b = road.batch;
      b.age += dt;
      // higher tiers flush fewer, bigger vans — a x110 badge tells the
      // story better than a wall of x16 vans
      var flushRiders = [16, 44, 110][road.tier || 0];
      var flushSecs = [1.8, 2.6, 3.4][road.tier || 0];
      if (b.count && (b.count >= flushRiders || b.age >= flushSecs)) flushBatch(road);
      // adaptive pooling: upshift fast when loaded, downshift slowly
      road.loadT += dt;
      if (road.loadT >= 0.5) {
        road.loadT = 0;
        var load = (road.vehicles.length + road.queue.length * 0.5) / maxV;
        if (load > 0.72 && road.tier < AGG_TIERS.length - 1) {
          road.tier++;
          road.cool = 10;
          // fold already-queued individuals below the new threshold into
          // the pool so the upshift clears the backlog immediately
          var keep = [], lim = AGG_TIERS[road.tier];
          road.queue.forEach(function (t) {
            if (!t.isBatch && t.usd != null && t.usd < lim) {
              road.batch.count++;
              road.batch.totalUsd += t.usd;
              if (t.usd > road.batch.maxUsd) road.batch.maxUsd = t.usd;
              if (t.isContractCall) road.batch.calls++;
            } else {
              keep.push(t);
            }
          });
          road.queue = keep;
        } else if (load < 0.35) {
          if (road.cool > 0) road.cool -= 0.5;
          else if (road.tier > 0) { road.tier--; road.cool = 10; }
        } else {
          road.cool = Math.max(road.cool, 4);
        }
      }
      var boost = 1 + Math.min(0.9, road.queue.length / 50);
      var budget = 6;
      while (budget-- > 0 && road.queue.length &&
             road.vehicles.length < maxV) {
        if (!materialize(road, road.queue[0])) break;
        road.queue.shift();
      }
      var surgeK = 1 + (road.surge || 0) * 0.9;
      road.lanes.forEach(function (ln) {
        for (var i = 0; i < ln.list.length; i++) {
          var v = ln.list[i];
          v.age += dt;
          v.x += v.speed * speedMult * boost * surgeK * dt;
          if (i > 0) {
            var leader = ln.list[i - 1];
            var maxX = leader.x - v.gap - v.lenS;
            if (v.x > maxX) v.x = maxX;
          }
        }
        while (ln.list.length && ln.list[0].x > W + 40) {
          var gone = ln.list.shift();
          var idx = road.vehicles.indexOf(gone);
          if (idx !== -1) road.vehicles.splice(idx, 1);
          if (gone === selectedVehicle) selectedVehicle = null;
        }
      });
      if (road.gate.pulse > 0) road.gate.pulse = Math.max(0, road.gate.pulse - dt * 0.7);
      if (road.surge > 0) road.surge = Math.max(0, road.surge - dt / 1.8);
    });
    updateParticles(dt);
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    roads.forEach(drawRoad);

    roads.forEach(function (road) {
      for (var l = 0; l < road.lanes.length; l++) {
        var ln = road.lanes[l];
        for (var i = 0; i < ln.list.length; i++) drawVehicle(ln.list[i]);
      }
    });
    drawParticles();

    if (selectedVehicle) {
      var sv = selectedVehicle, ssc = sv.scale, pad = 6;
      ctx.strokeStyle = '#22303f';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -performance.now() / 60;
      ctx.strokeRect(sv.x - pad, sv.y - pad,
        sv.sprite.len * ssc + pad * 2, sv.sprite.bodyH * ssc + pad * 2);
      ctx.setLineDash([]);
    }

    if (paused) {
      ctx.fillStyle = 'rgba(255,255,255,.4)';
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* ---------- interaction ---------- */

  function hitTest(px, py) {
    for (var r = 0; r < roads.length; r++) {
      var road = roads[r];
      for (var l = road.lanes.length - 1; l >= 0; l--) {
        for (var i = road.lanes[l].list.length - 1; i >= 0; i--) {
          var v = road.lanes[l].list[i];
          var sc = v.scale;
          if (px >= v.x - 5 && px <= v.x + v.sprite.len * sc + 5 &&
              py >= v.y - 7 && py <= v.y + v.sprite.bodyH * sc + 7) {
            return v;
          }
        }
      }
    }
    return null;
  }

  function bindPointer() {
    canvas.addEventListener('pointermove', function (e) {
      var rect = canvas.getBoundingClientRect();
      var v = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      if (hoverVehicle && hoverVehicle !== v) hoverVehicle.hover = false;
      hoverVehicle = v;
      if (v) v.hover = true;
      canvas.style.cursor = v ? 'pointer' : 'default';
    });
    canvas.addEventListener('pointerdown', function (e) {
      var rect = canvas.getBoundingClientRect();
      var v = hitTest(e.clientX - rect.left, e.clientY - rect.top);
      if (clickHandler) clickHandler(v, e.clientX, e.clientY);
    });
  }

  /* ---------- API ---------- */

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) speedMult = 0.5;
    layout();
    bindPointer();
    var resizeT = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeT);
      resizeT = setTimeout(layout, 140);
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) {
        roads.forEach(function (r) { r.queue.length = 0; r.batch = newBatch(); });
        lastT = performance.now();
      }
    });
    lastT = performance.now();
    requestAnimationFrame(frame);
  }

  return {
    init: init,
    spawn: spawn,
    blockPulse: blockPulse,
    refresh: function () { if (canvas) layout(); },
    onVehicleClick: function (fn) { clickHandler = fn; },
    selectVehicle: function (v) { selectedVehicle = v || null; },
    setPaused: function (p) { paused = p; },
    isPaused: function () { return paused; },
    setSpeed: function (m) { speedMult = m; },
    counts: function () {
      return roads.map(function (r) {
        return { chain: r.chain, active: r.vehicles.length, queued: r.queue.length, dropped: r.dropCount };
      });
    },
    layoutInfo: function () {
      return roads.map(function (r) {
        return { chain: r.chain, y: r.y, roadTop: r.roadTop, roadBot: r.roadBot, lanes: r.lanes.length };
      });
    },
    aggInfo: function () {
      return {
        btc: AGG_TIERS[(roads[0] && roads[0].tier) || 0],
        eth: AGG_TIERS[(roads[1] && roads[1].tier) || 0]
      };
    }
  };
})();
