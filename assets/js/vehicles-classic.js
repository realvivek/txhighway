/* TX Highway — "classic day" sprite set.
 * Atlas over assets/sprites/classic-sheet.png (owner-contributed sheet, baked
 * checkerboard keyed out to true alpha). Side-view cartoon vehicles + roadside
 * props — an homage to the original TX Highway daytime look. Loaded lazily the
 * first time day mode is switched on; night mode never pays for it.
 * Coordinates were machine-extracted (connected components over alpha).
 */
window.TXH = window.TXH || {};

TXH.classic = (function () {
  var SHEET_URL = 'assets/sprites/classic-sheet.png';
  var img = null;
  var loading = false;
  var isReady = false;
  var onReady = [];
  var cache = {};

  /* source boxes [x, y, w, h] on the 1168x784 sheet */
  var ATLAS = {
    vehicles: {
      bike: [ // smallest hatchbacks stand in for the under-$100 class
        [382, 57, 96, 41], [381, 144, 99, 42], [595, 338, 96, 51],
        [700, 340, 88, 47], [489, 345, 97, 43]
      ],
      car: [
        [489, 52, 95, 47], [488, 139, 97, 48], [489, 239, 96, 51],
        [595, 236, 96, 53], [1038, 54, 125, 46]
      ],
      sedan: [
        // 5th element 1 = sprite natively faces right (skip the mirror in build)
        [10, 58, 120, 40], [9, 145, 121, 41], [255, 56, 120, 43, 1],
        [254, 144, 120, 41], [916, 338, 118, 50], [1040, 339, 124, 48],
        [1039, 437, 125, 52], [906, 440, 126, 49]
      ],
      truck: [
        [139, 47, 106, 51], [138, 134, 109, 52], [1040, 228, 124, 62],
        [795, 330, 115, 59], [918, 125, 112, 66], [796, 144, 115, 46],
        [921, 237, 111, 53], [1037, 140, 126, 50]
      ],
      semi: [
        [704, 17, 324, 87], [15, 208, 359, 90]
      ],
      whale: [ // blue rig, drawn larger with a golden aura at build time
        [15, 208, 359, 90]
      ],
      pod: [ // kei vans as the little contract-call couriers
        [704, 138, 82, 52], [702, 236, 83, 53], [593, 132, 102, 58]
      ],
      bus: [ // vans that carpool batches of sub-$1K transactions
        [918, 125, 112, 66], [796, 144, 115, 46]
      ]
    },
    props: {
      tree: [
        [909, 513, 90, 171], [1040, 510, 124, 143], [678, 574, 104, 111],
        [997, 582, 59, 102], [1055, 670, 99, 97]
      ],
      bush: [[863, 617, 50, 67], [594, 712, 88, 57], [696, 712, 134, 56]],
      barrier: [[12, 499, 111, 30], [137, 499, 109, 30], [259, 499, 111, 30], [603, 516, 171, 37]],
      lamp: [[828, 400, 60, 95], [811, 527, 71, 158]],
      sign: [[388, 318, 29, 70], [612, 574, 39, 111], [698, 398, 15, 97]],
      deer: [[850, 694, 65, 76], [929, 700, 48, 70]],
      fox: [[988, 742, 46, 24]]
    },
    // marking-free patch of asphalt used as a texture pattern
    roadTexture: [60, 700, 220, 34]
  };

  function load(cb) {
    if (isReady) { if (cb) cb(); return; }
    if (cb) onReady.push(cb);
    if (loading) return;
    loading = true;
    img = new Image();
    img.onload = function () {
      isReady = true;
      onReady.splice(0).forEach(function (fn) { try { fn(); } catch (e) {} });
    };
    img.onerror = function () { loading = false; }; // day mode falls back to night sprites
    img.src = SHEET_URL;
  }

  /* Same sprite contract as TXH.vehicles.build:
   * { canvas, w, h, len, bodyH, padL, padT } */
  function build(chain, classId, hueIdx, dpr) {
    // never bake (and especially never CACHE) sprites before the sheet image
    // has decoded — drawImage would silently produce a permanently blank sprite
    if (!isReady) {
      var geoStub = TXH.vehicles.GEO[classId] || { len: 40 };
      var stub = document.createElement('canvas');
      stub.width = stub.height = 2;
      return { canvas: stub, w: geoStub.len, h: 20, len: geoStub.len, bodyH: 20, padL: 0, padT: 0 };
    }
    var key = 'day:' + chain + ':' + classId + ':' + hueIdx + ':' + dpr;
    if (cache[key]) return cache[key];
    var boxes = ATLAS.vehicles[classId] || ATLAS.vehicles.car;
    var box = boxes[hueIdx % boxes.length];
    var geo = TXH.vehicles.GEO[classId];
    var isWhale = classId === 'whale';
    var len = geo.len * (isWhale ? 1 : 1);
    var scale = len / box[2];
    var bodyH = box[3] * scale;
    var PAD = isWhale ? 18 : 10;
    var w = len + PAD * 2;
    var h = bodyH + PAD * 2;
    var c = document.createElement('canvas');
    c.width = Math.ceil(w * dpr);
    c.height = Math.ceil(h * dpr);
    var x = c.getContext('2d');
    x.scale(dpr, dpr);
    // soft ground shadow
    x.save();
    x.translate(PAD + len / 2, PAD + bodyH - 1.5);
    x.scale(1, 0.22);
    var sg = x.createRadialGradient(0, 0, 1, 0, 0, len * 0.55);
    sg.addColorStop(0, 'rgba(30,40,30,.4)');
    sg.addColorStop(1, 'rgba(30,40,30,0)');
    x.fillStyle = sg;
    x.beginPath(); x.arc(0, 0, len * 0.55, 0, 7); x.fill();
    x.restore();
    // traffic drives left->right; nearly all sheet art faces left, so mirror
    // unless the box is flagged as natively right-facing (pixel-audited)
    if (box[4] === 1) {
      x.drawImage(img, box[0], box[1], box[2], box[3], PAD, PAD, len, bodyH);
    } else {
      x.save();
      x.translate(PAD + len / 2, 0);
      x.scale(-1, 1);
      x.drawImage(img, box[0], box[1], box[2], box[3], -len / 2, PAD, len, bodyH);
      x.restore();
    }
    if (isWhale) {
      // flat golden halo ring marks the >$1M rig — cartoon, not neon
      x.strokeStyle = '#f2b01e';
      x.lineWidth = 3;
      x.strokeRect(PAD - 4, PAD - 4, len + 8, bodyH + 8);
      x.strokeStyle = 'rgba(255,255,255,.9)';
      x.lineWidth = 1;
      x.strokeRect(PAD - 5.5, PAD - 5.5, len + 11, bodyH + 11);
    }
    var sprite = { canvas: c, w: w, h: h, len: len, bodyH: bodyH, padL: PAD, padT: PAD };
    cache[key] = sprite;
    return sprite;
  }

  /* draw a roadside prop scaled to targetH, anchored at bottom-center */
  function drawProp(ctx, name, idx, cx, bottomY, targetH) {
    if (!isReady) return;
    var boxes = ATLAS.props[name];
    if (!boxes) return;
    var b = boxes[idx % boxes.length];
    var s = targetH / b[3];
    ctx.drawImage(img, b[0], b[1], b[2], b[3],
      cx - (b[2] * s) / 2, bottomY - targetH, b[2] * s, targetH);
  }

  return {
    load: load,
    ready: function () { return isReady; },
    build: build,
    drawProp: drawProp
  };
})();
