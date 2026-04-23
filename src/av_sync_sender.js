autowatch = 1;
inlets = 1;
outlets = 6;

include("av_util.js");
include("audio_analyzer.js");
include("transport_poller.js");

var DEFAULT_INTERVAL_MS = 33;
var REGISTER_HEARTBEAT_MS = 1000;

var state = {
  enabled: true,
  debug: true,
  role: "lane",
  manualLaneName: "",
  laneId: "",
  laneName: "",
  trackName: "",
  liveApiReady: false,
  bootstrapped: false,
  intervalMs: DEFAULT_INTERVAL_MS,
  host: "127.0.0.1",
  port: 7777,
  txCount: 0,
  frameCount: 0,
  eventCount: 0,
  registerCount: 0,
  transportCount: 0,
  sectionCount: 0,
  errorCount: 0,
  pollCount: 0,
  lastRegisterAt: 0,
  lastStatus: "",
  lastDebug: ""
};

var analyzer = new AV.AudioAnalyzer();
var poller = new AV.TransportPoller({
  log: function (level, message) {
    emitDebug(level, message);
  }
});

var pollTask = null;
var trackApi = null;

function loadbang() {
  state.laneId = generateLaneId();
  ensureTask();
  if (state.enabled && pollTask) {
    stopTaskOnly();
    pollTask.repeat();
  }
  emitCounters();
  emitStatus("waiting for live.thisdevice");
  emitDebug("info", "device loaded; awaiting live.thisdevice");
}

function generateLaneId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function notifydeleted() {
  stopTaskOnly();
}

function anything() {
  var args = arrayfromargs(arguments);

  switch (messagename) {
    case "ready":
      ready();
      break;
    case "enable":
      setEnabled(args[0]);
      break;
    case "debug":
      setDebug(args[0]);
      break;
    case "interval":
      setIntervalMs(args[0]);
      break;
    case "role":
      setRole(args[0]);
      break;
    case "laneName":
      setLaneName(args);
      break;
    case "analysis":
      handleAnalysis(args);
      break;
    case "diagnostics":
      diagnostics(AV.joinArgs(args) || "manual");
      break;
    case "rescan":
      rescan();
      break;
    case "host":
      state.host = AV.joinArgs(args) || "127.0.0.1";
      emitStatus("host " + state.host + ":" + state.port);
      break;
    case "port":
      state.port = Math.max(1, Math.round(AV.toNumber(args[0], 7777)));
      emitStatus("host " + state.host + ":" + state.port);
      break;
    default:
      emitDebug("warn", "unhandled message " + messagename + " " + AV.joinArgs(args));
      break;
  }
}

function bang() {
  diagnostics("manual bang");
}

function ready() {
  state.liveApiReady = true;
  poller.setLiveApiReady(true);
  bootstrap();
}

function tryLateBootstrap() {
  if (typeof LiveAPI === "undefined") {
    return;
  }
  try {
    var probe = new LiveAPI("this_device");
    if (probe && probe.id != 0) {
      state.liveApiReady = true;
      poller.setLiveApiReady(true);
      bootstrap();
    }
  } catch (error) {
    // LiveAPI not ready yet; will retry on next poll tick
  }
}

function bootstrap() {
  if (!state.liveApiReady) {
    emitStatus("waiting for live.thisdevice");
    return;
  }

  state.bootstrapped = true;
  refreshTrackInfo();
  if (state.role === "master") {
    poller.refreshCuePoints();
  } else {
    poller.clearCuePoints();
  }
  ensureTask();
  if (state.enabled) {
    stopTaskOnly();
    pollTask.repeat();
  }
  registerLane("boot");
  diagnostics("boot");
}

function ensureTask() {
  if (!pollTask) {
    pollTask = new Task(poll, this);
  }
  pollTask.interval = state.intervalMs;
}

function stopTaskOnly() {
  if (!pollTask) {
    return;
  }
  try {
    pollTask.cancel();
  } catch (error) {
    // Max can throw when canceling an idle task. Safe to ignore.
  }
}

function setEnabled(value) {
  state.enabled = AV.toBoolean(value);
  if (state.enabled) {
    ensureTask();
    stopTaskOnly();
    pollTask.repeat();
    emitDebug("info", "sender enabled");
    emitStatus("enabled");
    registerLane("enable");
  } else {
    stopTaskOnly();
    emitDebug("warn", "sender disabled");
    emitStatus("disabled");
  }
}

function setDebug(value) {
  state.debug = AV.toBoolean(value);
  emitStatus("debug " + (state.debug ? "enabled" : "disabled"));
  emitDebug("info", "debug " + (state.debug ? "enabled" : "disabled"));
}

function setIntervalMs(value) {
  state.intervalMs = Math.max(15, Math.round(AV.toNumber(value, DEFAULT_INTERVAL_MS)));
  ensureTask();
  if (state.enabled) {
    stopTaskOnly();
    pollTask.repeat();
  }
  emitStatus("interval " + state.intervalMs + "ms");
}

function setRole(value) {
  var normalized = AV.normalizeRole(value);
  if (normalized === state.role) {
    return;
  }
  state.role = normalized;
  if (state.role === "master") {
    poller.refreshCuePoints();
  } else {
    poller.clearCuePoints();
  }
  emitDebug("info", "role set to " + state.role);
  emitStatus("role " + state.role);
  registerLane("role");
}

function setLaneName(args) {
  state.manualLaneName = AV.joinArgs(args).replace(/^\s+|\s+$/g, "");
  resolveLaneName();
  emitDebug("info", "lane name " + state.laneName);
  emitStatus("lane " + state.laneName);
  registerLane("laneName");
}

function handleAnalysis(args) {
  if (!state.enabled || !state.bootstrapped || !state.laneId) {
    return;
  }

  if (!args || args.length < 9) {
    emitDebug("warn", "analysis requires 9 values");
    return;
  }

  refreshTrackInfoIfNeeded();

  var now = AV.nowMs();
  var result = analyzer.analyze(args, now);
  if (!result) {
    return;
  }

  var a = result.analysis;
  state.frameCount += 1;

  var i;
  for (i = 0; i < result.events.length; i++) {
    emitLaneEvent(result.events[i].type, result.events[i].strength);
  }

  if (state.frameCount % 60 === 0) {
    emitStatus(
      "lane=" + state.laneName +
      " role=" + state.role +
      " frames=" + state.frameCount +
      " tx=" + state.txCount +
      " gate=" + a.gate
    );
  }

  if (!state.lastRegisterAt || now - state.lastRegisterAt >= REGISTER_HEARTBEAT_MS) {
    registerLane("heartbeat");
  }
}

function emitLaneEvent(type, strength) {
  state.eventCount += 1;
  sendOsc("/av/lane/event", [state.laneId, type, AV.roundTo(strength, 4)]);
}

function poll() {
  if (!state.enabled) {
    return;
  }
  if (!state.bootstrapped) {
    tryLateBootstrap();
    if (!state.bootstrapped) {
      return;
    }
  }

  state.pollCount += 1;
  refreshTrackInfoIfNeeded();

  if (!state.lastRegisterAt || AV.nowMs() - state.lastRegisterAt >= REGISTER_HEARTBEAT_MS) {
    registerLane("poll");
  }

  if (state.role !== "master") {
    return;
  }

  var result = poller.poll(state.trackName);
  if (!result) {
    state.errorCount += 1;
    emitStatus("master poll error");
    return;
  }

  state.transportCount += 1;
  // Transport/section are no longer consumed by the renderer (hit events carry rhythm implicitly).
  // Left in the poller for Ableton-state inspection via debug logs only.

  if (state.debug && state.transportCount % 32 === 0) {
    emitDebug(
      "debug",
      "heartbeat bpm=" + AV.roundTo(result.transport.tempo, 2) +
        " playing=" + (result.transport.isPlaying ? 1 : 0) +
        " beatPhase=" + AV.roundTo(result.transport.beatPhase, 3) +
        " barPhase=" + AV.roundTo(result.transport.barPhase, 3) +
        " downbeat=" + (result.transport.downbeat ? 1 : 0) +
        " name=" + result.section.name +
        " progress=" + AV.roundTo(result.section.progress, 3)
    );
  }
}

function diagnostics(reason) {
  emitStatus(
    "diag " +
      reason +
      " lane=" + state.laneName +
      " role=" + state.role +
      " track=" + state.trackName +
      " tx=" + state.txCount +
      " frames=" + state.frameCount +
      " events=" + state.eventCount +
      " regs=" + state.registerCount
  );
  emitDebug(
    "info",
    "diag reason=" + reason +
      " lane=" + state.laneName +
      " role=" + state.role +
      " track=" + state.trackName +
      " enabled=" + (state.enabled ? 1 : 0) +
      " intervalMs=" + state.intervalMs +
      " frames=" + state.frameCount +
      " events=" + state.eventCount +
      " registers=" + state.registerCount +
      " transport=" + state.transportCount +
      " sections=" + state.sectionCount +
      " cues=" + poller.cuePoints.length +
      " tx=" + state.txCount +
      " errors=" + (state.errorCount + poller.errorCount)
  );
}

function rescan() {
  refreshTrackInfo();
  if (state.role === "master") {
    poller.refreshCuePoints();
  }
  registerLane("rescan");
  diagnostics("rescan");
}

function refreshTrackInfoIfNeeded() {
  if (!trackApi || state.pollCount % 64 === 0) {
    refreshTrackInfo();
  }
}

function refreshTrackInfo() {
  if (!state.liveApiReady || typeof LiveAPI === "undefined") {
    return;
  }

  try {
    trackApi = AV.createApi("this_device canonical_parent");
    var resolved = AV.getValue(trackApi, "name");
    state.trackName = resolved == null ? "" : String(resolved);
    resolveLaneName();
    outlet(4, state.trackName);
  } catch (error) {
    state.errorCount += 1;
    trackApi = null;
    emitDebug("warn", "track lookup failed " + error);
  }
}

function resolveLaneName() {
  state.laneName = state.manualLaneName && state.manualLaneName.length
    ? state.manualLaneName
    : state.trackName;
  outlet(3, state.laneName);
}

function registerLane(reason) {
  if (!state.enabled || !state.bootstrapped || !state.laneId) {
    return;
  }
  state.registerCount += 1;
  state.lastRegisterAt = AV.nowMs();
  sendOsc("/av/lane/register", [state.laneId, state.laneName, state.role, state.trackName]);
  if (state.debug) {
    emitDebug("debug", "register reason=" + reason + " id=" + state.laneId + " lane=" + state.laneName + " role=" + state.role + " track=" + state.trackName);
  }
}

function emitStatus(message) {
  state.lastStatus = String(message);
  outlet(1, state.lastStatus);
}

function emitDebug(level, message) {
  var payload = String(message);
  state.lastDebug = payload;
  if (state.laneId) {
    sendOsc("/av/debug", [state.laneId, String(level), payload]);
  }
  outlet(2, payload);
  if (state.debug) {
    post("[av_lane_sender][" + level + "] " + payload + "\n");
    if (AV.appendLog) {
      AV.appendLog(level, "sender:" + (state.laneName || state.laneId || "?"), payload);
    }
  }
}

function sendOsc(address, args) {
  var packet = [String(address)];
  if (args && args.length) {
    Array.prototype.push.apply(packet, args);
  }
  state.txCount += 1;
  outlet(0, packet);
  emitCounters();
}

function emitCounters() {
  outlet(
    5,
    "tx=" + state.txCount +
      " fr=" + state.frameCount +
      " ev=" + state.eventCount +
      " rg=" + state.registerCount +
      " er=" + state.errorCount
  );
}
