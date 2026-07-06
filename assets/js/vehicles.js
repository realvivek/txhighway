/* TX Highway — vehicle geometry + classification.
 * All vehicle art comes from the classic sprite sheet (vehicles-classic.js);
 * this module owns the class thresholds and target sizes the engine uses.
 */
window.TXH = window.TXH || {};

TXH.vehicles = (function () {

  // target on-road length per class (css px); height follows the sheet's aspect
  var GEO = {
    pod:   { len: 40 },
    bike:  { len: 44 },
    car:   { len: 50 },
    sedan: { len: 60 },
    truck: { len: 66 },
    bus:   { len: 72 },
    semi:  { len: 130 },
    whale: { len: 170 }
  };

  function build(chain, classId, hueIdx, dpr) {
    return TXH.classic.build(chain, classId, hueIdx, dpr);
  }

  function classify(usd, tx) {
    var classes = TXH.config.classes;
    if (tx && tx.isContractCall) return classes[0]; // pod (courier van)
    if (usd == null) return classes[2];             // unknown -> generic car
    for (var i = 1; i < classes.length; i++) {
      if (usd < classes[i].maxUsd) return classes[i];
    }
    return classes[classes.length - 1];
  }

  return { build: build, classify: classify, GEO: GEO };
})();
