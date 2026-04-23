var AV = AV || {};

(function () {
  var CUE_REFRESH_MS = 5000;

  function TransportPoller(options) {
    options = options || {};
    this.log = options.log || function () {};
    this.cuePoints = [];
    this.lastCueRefreshAt = 0;
    this.lastWholeBeat = null;
    this.liveSetApi = null;
    this.liveApiReady = false;
    this.errorCount = 0;
  }

  TransportPoller.prototype.setLiveApiReady = function (ready) {
    this.liveApiReady = !!ready;
    if (!ready) {
      this.liveSetApi = null;
    }
  };

  TransportPoller.prototype.ensureLiveSet = function () {
    if (!this.liveApiReady) {
      return false;
    }
    if (this.liveSetApi) {
      return true;
    }
    if (typeof LiveAPI === "undefined") {
      this.log("error", "LiveAPI unavailable");
      return false;
    }
    try {
      this.liveSetApi = AV.createApi("live_set");
      return true;
    } catch (error) {
      this.errorCount += 1;
      this.liveSetApi = null;
      this.log("error", "LiveAPI live_set failed " + error);
      return false;
    }
  };

  TransportPoller.prototype.refreshCuePoints = function () {
    if (!this.ensureLiveSet()) {
      return;
    }
    try {
      var count = this.liveSetApi.getcount("cue_points");
      var points = [];
      var index;
      for (index = 0; index < count; index++) {
        var cueApi = AV.createApi("live_set cue_points " + index);
        points.push({
          name: String(AV.getValue(cueApi, "name") || ("Cue " + (index + 1))),
          time: AV.toNumber(AV.getValue(cueApi, "time"), index * 4)
        });
      }
      points.sort(function (left, right) {
        return left.time - right.time;
      });
      this.cuePoints = points;
      this.lastCueRefreshAt = AV.nowMs();
      this.log("info", "loaded " + count + " cue point(s)");
    } catch (error) {
      this.errorCount += 1;
      this.cuePoints = [];
      this.log("warn", "cue refresh failed " + error);
    }
  };

  TransportPoller.prototype.clearCuePoints = function () {
    this.cuePoints = [];
    this.lastCueRefreshAt = 0;
    this.lastWholeBeat = null;
  };

  TransportPoller.prototype.poll = function (fallbackTrackName) {
    if (!this.ensureLiveSet()) {
      return null;
    }

    var now = AV.nowMs();
    if (!this.lastCueRefreshAt || now - this.lastCueRefreshAt >= CUE_REFRESH_MS) {
      this.refreshCuePoints();
    }

    try {
      var songTime = AV.toNumber(AV.getValue(this.liveSetApi, "current_song_time"), 0);
      var tempo = AV.toNumber(AV.getValue(this.liveSetApi, "tempo"), 120);
      var isPlaying = AV.toBoolean(AV.getValue(this.liveSetApi, "is_playing"));
      var beatPhase = AV.positiveMod(songTime, 1);
      var barPhase = AV.positiveMod(songTime, 4) / 4;
      var wholeBeat = Math.floor(songTime + 0.0001);
      var downbeat = false;

      if (beatPhase < 0.08 && this.lastWholeBeat !== wholeBeat) {
        this.lastWholeBeat = wholeBeat;
        downbeat = wholeBeat % 4 === 0;
      }

      var section = this.currentSection(songTime, isPlaying, fallbackTrackName);

      return {
        transport: {
          tempo: AV.roundTo(tempo, 3),
          isPlaying: isPlaying,
          beatPhase: AV.roundTo(beatPhase, 4),
          barPhase: AV.roundTo(barPhase, 4),
          downbeat: downbeat
        },
        section: {
          name: section.name,
          progress: AV.roundTo(section.progress, 4)
        }
      };
    } catch (error) {
      this.errorCount += 1;
      this.liveSetApi = null;
      this.log("error", "master poll failed " + error);
      return null;
    }
  };

  TransportPoller.prototype.currentSection = function (songTime, isPlaying, fallbackName) {
    var fallback = fallbackName || "Arrangement";
    if (!this.cuePoints.length) {
      return {
        name: fallback,
        progress: isPlaying ? AV.positiveMod(songTime, 16) / 16 : 0
      };
    }

    var current = this.cuePoints[0];
    var next = null;
    var index;

    for (index = 0; index < this.cuePoints.length; index++) {
      if (songTime >= this.cuePoints[index].time - 0.0001) {
        current = this.cuePoints[index];
        next = index + 1 < this.cuePoints.length ? this.cuePoints[index + 1] : null;
      } else {
        next = this.cuePoints[index];
        break;
      }
    }

    var progress = 0;
    if (next && next.time > current.time + 0.0001) {
      progress = AV.clamp((songTime - current.time) / (next.time - current.time), 0, 1);
    } else if (isPlaying) {
      progress = AV.positiveMod(songTime - current.time, 16) / 16;
    }

    return {
      name: current.name || fallback,
      progress: progress
    };
  };

  AV.TransportPoller = TransportPoller;
})();
