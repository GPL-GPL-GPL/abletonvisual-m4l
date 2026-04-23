var AV = AV || {};

(function () {
  var HIT_REFRACTORY_MS = 160;
  var GATE_LEVEL_THRESHOLD = 0.055;
  var GATE_RMS_THRESHOLD = 0.045;
  var HIT_STRENGTH_THRESHOLD = 0.18;

  function AudioAnalyzer() {
    this.previous = {
      level: 0,
      bass: 0,
      gate: 0,
      spectrum: [0, 0, 0, 0, 0, 0]
    };
    this.sustain = 0;
    this.lastHitAt = 0;
  }

  AudioAnalyzer.prototype.reset = function () {
    this.previous = {
      level: 0,
      bass: 0,
      gate: 0,
      spectrum: [0, 0, 0, 0, 0, 0]
    };
    this.sustain = 0;
    this.lastHitAt = 0;
  };

  AudioAnalyzer.prototype.analyze = function (args, nowMs) {
    if (!args || args.length < 9) {
      return null;
    }

    var level = AV.clamp(AV.toNumber(args[0], 0), 0, 1.5);
    var rms = AV.clamp(AV.toNumber(args[1], level), 0, 1.5);
    var peak = AV.clamp(AV.toNumber(args[2], level), 0, 1.5);
    var sub = AV.clamp(AV.toNumber(args[3], 0), 0, 1.5);
    var bass = AV.clamp(AV.toNumber(args[4], 0), 0, 1.5);
    var lowMid = AV.clamp(AV.toNumber(args[5], 0), 0, 1.5);
    var highMid = AV.clamp(AV.toNumber(args[6], 0), 0, 1.5);
    var presence = AV.clamp(AV.toNumber(args[7], 0), 0, 1.5);
    var air = AV.clamp(AV.toNumber(args[8], 0), 0, 1.5);

    var spectrum = [sub, bass, lowMid, highMid, presence, air];
    var centroid = weightedCentroid(spectrum);
    var rawFlux = spectralFlux(this.previous.spectrum, spectrum);
    var flux = AV.clamp(rawFlux * 0.9 + Math.max(0, level - this.previous.level) * 0.8, 0, 1.5);
    var gate = level > GATE_LEVEL_THRESHOLD || rms > GATE_RMS_THRESHOLD ? 1 : 0;
    this.sustain = AV.clamp(this.sustain * 0.84 + level * 0.24 + rms * 0.38, 0, 1);

    var analysis = {
      level: AV.roundTo(level, 4),
      rms: AV.roundTo(rms, 4),
      peak: AV.roundTo(peak, 4),
      sub: AV.roundTo(sub, 4),
      bass: AV.roundTo(bass, 4),
      lowMid: AV.roundTo(lowMid, 4),
      highMid: AV.roundTo(highMid, 4),
      presence: AV.roundTo(presence, 4),
      air: AV.roundTo(air, 4),
      centroid: AV.roundTo(centroid, 4),
      flux: AV.roundTo(flux, 4),
      gate: gate,
      sustain: AV.roundTo(this.sustain, 4)
    };

    var events = [];
    var hitStrength = hitCandidate(level, sub, bass, flux, this.previous.bass);
    var canHit = nowMs - this.lastHitAt >= HIT_REFRACTORY_MS;

    if (hitStrength > HIT_STRENGTH_THRESHOLD && canHit) {
      this.lastHitAt = nowMs;
      events.push({
        type: "hit",
        strength: AV.clamp(hitStrength, 0, 1.5)
      });
    }

    this.previous.level = level;
    this.previous.bass = bass;
    this.previous.gate = gate;
    this.previous.spectrum = spectrum;

    return {
      analysis: analysis,
      events: events
    };
  };

  function hitCandidate(level, sub, bass, flux, previousBass) {
    var bassRise = Math.max(0, bass - previousBass);
    return bassRise * 1.05 + flux * 0.55 + sub * 0.2 + level * 0.12;
  }

  function weightedCentroid(spectrum) {
    var weights = [0.08, 0.18, 0.38, 0.6, 0.82, 1];
    var numerator = 0;
    var denominator = 0;
    var index;
    for (index = 0; index < spectrum.length; index++) {
      numerator += spectrum[index] * weights[index];
      denominator += spectrum[index];
    }
    if (denominator <= 0.0001) {
      return 0;
    }
    return numerator / denominator;
  }

  function spectralFlux(previous, next) {
    var total = 0;
    var index;
    for (index = 0; index < next.length; index++) {
      total += Math.max(0, next[index] - previous[index]);
    }
    return total / next.length;
  }

  AV.AudioAnalyzer = AudioAnalyzer;
})();
