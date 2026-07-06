/* TX Highway — synthesized sound effects (WebAudio, zero assets).
 * Off by default; the header toggle persists the choice. Events only —
 * no ambient loop — so it stays charming instead of exhausting:
 *   block  -> toll-gate chime arpeggio
 *   whale  -> deep air-horn swell
 *   honk   -> little two-note beep when a vehicle is clicked
 */
window.TXH = window.TXH || {};

TXH.sound = (function () {
  var ctx = null;
  var on = false;

  function ensure() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { try { ctx = new AC(); } catch (e) {} }
    }
    if (ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
    return !!ctx;
  }

  function tone(type, f0, f1, dur, peak, delay) {
    var t0 = ctx.currentTime + (delay || 0);
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  function play(name) {
    if (!on || !ensure()) return;
    try {
      if (name === 'honk') {
        tone('square', 330, null, 0.11, 0.07);
        tone('square', 415, null, 0.11, 0.07, 0.025);
      } else if (name === 'block') {
        tone('triangle', 660, null, 0.1, 0.07);
        tone('triangle', 880, null, 0.1, 0.07, 0.09);
        tone('triangle', 1320, null, 0.18, 0.06, 0.18);
      } else if (name === 'whale') {
        tone('sawtooth', 66, 54, 0.85, 0.08);
        tone('sawtooth', 99, 82, 0.85, 0.06, 0.03);
      }
    } catch (e) {}
  }

  function toggle() {
    on = !on;
    if (on) ensure();
    try { localStorage.setItem('txh-sound', on ? '1' : '0'); } catch (e) {}
    return on;
  }

  function init() {
    try { on = localStorage.getItem('txh-sound') === '1'; } catch (e) {}
    return on;
  }

  return { init: init, toggle: toggle, play: play, isOn: function () { return on; } };
})();
