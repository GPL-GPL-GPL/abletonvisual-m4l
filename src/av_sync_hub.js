autowatch = 1;
inlets = 1;
outlets = 4;

include("av_util.js");
include("config_loader.js");
include("osc_emitter.js");
include("osc_receiver.js");
include("handshake_client.js");

var HELLO_INTERVAL_MIN_MS = 500;
var HELLO_INTERVAL_MAX_MS = 2000;
var HEARTBEAT_INTERVAL_MS = 1000;
var APP_PORT_RANGE_START = 9100;
var APP_PORT_RANGE_END = 9119;
var HUB_INBOUND_PORT = 7788;

var state = {
  enabled: true,
  debug: true,
  txCount: 0,
  rxCount: 0,
  ctrlCount: 0,
  droppedCount: 0,
  errorCount: 0,
  lastStatus: "",
  lastDebug: "",
  helloIntervalMs: HELLO_INTERVAL_MIN_MS,
  portScanIndex: 0,
  currentPort: APP_PORT_RANGE_START
};

var config = new AV.ConfigLoader({
  appPort: APP_PORT_RANGE_START,
  hubPort: HUB_INBOUND_PORT,
  schemaVersion: AV.PROTOCOL_SCHEMA_VERSION
});
var emitter = new AV.OscEmitter(function (index, packet) {
  outlet(index, packet);
}, 0);
var receiver = new AV.OscReceiver();
var handshake = new AV.HandshakeClient({
  log: function (level, message) {
    emitDebug(level, message);
  }
});

var helloTask = null;
var heartbeatTask = null;

bindReceiverHandlers();

function loadbang() {
  setUdpSendPort(APP_PORT_RANGE_START);
  emitCounters();
  emitStatus("hub loaded -> scanning " + APP_PORT_RANGE_START + "-" + APP_PORT_RANGE_END);
  emitDebug("info", "hub loaded; schema=" + handshake.schemaVersion + " hub_port=" + HUB_INBOUND_PORT);
  startHelloLoop();
}

function freebang() {
  if (handshake.isStreamingAllowed() && handshake.sessionId) {
    emitter.send("/av/hs/bye", [handshake.sessionId, "hub device freed"]);
  }
  stopHelloLoop();
  stopHeartbeatLoop();
}

function bindReceiverHandlers() {
  receiver.on("/av/hs/welcome", function (payload) {
    var ok = handshake.handleWelcome(payload);
    if (ok && handshake.isStreamingAllowed()) {
      state.helloIntervalMs = HELLO_INTERVAL_MAX_MS;
      stopHelloLoop();
      startHeartbeatLoop();
      emitStatus("welcome session=" + handshake.sessionId + " port=" + state.currentPort);
    } else if (handshake.state === "degraded") {
      state.helloIntervalMs = 5000;
      scheduleHelloLoop();
      emitStatus("schema mismatch — retrying at 5s");
    }
  });
  receiver.on("/av/hs/bye", function (payload) {
    var reason = payload && payload.length > 1 ? String(payload[1]) : "unknown";
    handshake.markPeerDown("bye " + reason);
    stopHeartbeatLoop();
    state.helloIntervalMs = HELLO_INTERVAL_MIN_MS;
    scheduleHelloLoop();
    emitStatus("peer bye — resuming hello");
  });
  receiver.on("/av/hs/lane_ack", function (payload) {
    var result = handshake.handleLaneAck(payload);
    if (!result) {
      return;
    }
    var level = result.downgraded ? "warn" : "info";
    emitDebug(
      level,
      "lane_ack lane=" + result.laneId + " assigned=" + result.assignedRole +
        (result.downgraded ? " (downgraded)" : "")
    );
    emitStatus("lane " + result.laneId + " -> " + result.assignedRole);
  });
  receiver.on("/av/hs/ping", function (payload) {
    var reply = handshake.handlePing(payload);
    if (!reply) {
      return;
    }
    emitter.send("/av/hs/pong", [handshake.sessionId, reply.seq, reply.tsMs]);
    state.txCount += 1;
  });
  receiver.on("/av/hs/pong", function (payload) {
    handshake.handlePong(payload);
  });
  receiver.onAny(function (address, payload) {
    if (
      state.debug &&
      address !== "/av/hs/welcome" &&
      address !== "/av/hs/bye" &&
      address !== "/av/hs/lane_ack" &&
      address !== "/av/hs/ping" &&
      address !== "/av/hs/pong"
    ) {
      emitDebug("debug", "inbound " + address + " args=" + payload.length);
    }
  });
}

function anything() {
  var args = arrayfromargs(arguments);

  switch (messagename) {
    case "forward":
      handleForward(args);
      break;
    case "inbound":
      handleInbound(args);
      break;
    case "enable":
      setEnabled(args[0]);
      break;
    case "debug":
      setDebug(args[0]);
      break;
    case "host":
      config.setHost(AV.joinArgs(args));
      emitStatus("host " + config.host + ":" + state.currentPort);
      break;
    case "port":
      var pinned = AV.toNumber(args[0], APP_PORT_RANGE_START);
      state.currentPort = pinned;
      setUdpSendPort(pinned);
      emitStatus("pinned app port " + pinned);
      break;
    case "rescan":
      handshake.markPeerDown("rescan requested");
      stopHeartbeatLoop();
      state.helloIntervalMs = HELLO_INTERVAL_MIN_MS;
      state.portScanIndex = 0;
      scheduleHelloLoop();
      break;
    case "diagnostics":
      diagnostics(AV.joinArgs(args) || "manual");
      break;
    default:
      emitDebug("warn", "unhandled message " + messagename + " " + AV.joinArgs(args));
      break;
  }
}

function bang() {
  diagnostics("manual bang");
}

function handleForward(args) {
  if (!state.enabled || !args || !args.length) {
    return;
  }
  state.rxCount += 1;
  emitter.forwardRaw(args);
  state.txCount += 1;
  emitCounters();
}

function interceptLaneRegister(args) {
  if (args.length < 5) {
    emitDebug("warn", "lane register forward missing fields");
    return;
  }
  var laneId = String(args[1]);
  var laneName = String(args[2]);
  var claimedRole = String(args[3]);
  var trackName = String(args[4]);
  var nonce = handshake.beginLaneRegistration(laneId, laneName, claimedRole, trackName);
  if (nonce === null) {
    return;
  }
  emitter.send("/av/hs/lane_register", [
    handshake.sessionId,
    laneId,
    laneName,
    claimedRole,
    trackName,
    nonce
  ]);
  state.txCount += 1;
  if (state.debug) {
    emitDebug("debug", "lane_register lane=" + laneId + " claimed=" + claimedRole + " nonce=" + nonce);
  }
}

function handleInbound(args) {
  if (!args || !args.length) {
    return;
  }
  state.ctrlCount += 1;
  receiver.handle(args);
  emitCounters();
}

function startHelloLoop() {
  if (!helloTask) {
    helloTask = new Task(helloTick, this);
  }
  scheduleHelloLoop();
}

function scheduleHelloLoop() {
  if (!helloTask) {
    return;
  }
  helloTask.interval = state.helloIntervalMs;
  stopHelloLoop();
  helloTask.repeat();
}

function stopHelloLoop() {
  if (!helloTask) {
    return;
  }
  try {
    helloTask.cancel();
  } catch (error) {
    // safe to ignore when task is idle
  }
}

function startHeartbeatLoop() {
  if (!heartbeatTask) {
    heartbeatTask = new Task(heartbeatTick, this);
  }
  heartbeatTask.interval = HEARTBEAT_INTERVAL_MS;
  try {
    heartbeatTask.cancel();
  } catch (error) {
    // idle
  }
  heartbeatTask.repeat();
}

function stopHeartbeatLoop() {
  if (!heartbeatTask) {
    return;
  }
  try {
    heartbeatTask.cancel();
  } catch (error) {
    // idle
  }
}

function heartbeatTick() {
  if (!state.enabled) {
    return;
  }
  var tick = handshake.beginHeartbeatTick();
  if (!tick) {
    stopHeartbeatLoop();
    return;
  }
  emitter.send("/av/hs/ping", [handshake.sessionId, tick.seq, tick.tsMs]);
  state.txCount += 1;
  if (state.debug) {
    emitDebug("debug", "ping seq=" + tick.seq + " missed=" + tick.missed);
  }
  if (tick.peerDown) {
    emitter.send("/av/hs/bye", [handshake.sessionId, "heartbeat timeout"]);
    state.txCount += 1;
    emitDebug("warn", "peer timeout after " + tick.missed + " missed pongs");
    handshake.markPeerDown("heartbeat timeout");
    stopHeartbeatLoop();
    state.helloIntervalMs = HELLO_INTERVAL_MIN_MS;
    state.portScanIndex = 0;
    scheduleHelloLoop();
    emitStatus("peer timeout — resuming hello");
  }
  emitCounters();
}

function helloTick() {
  if (!state.enabled) {
    return;
  }
  if (handshake.isStreamingAllowed()) {
    stopHelloLoop();
    return;
  }

  var rangeSize = APP_PORT_RANGE_END - APP_PORT_RANGE_START + 1;
  var offset = state.portScanIndex % rangeSize;
  state.portScanIndex = (state.portScanIndex + 1) | 0;
  var candidate = APP_PORT_RANGE_START + offset;
  state.currentPort = candidate;
  setUdpSendPort(candidate);

  var nonce = handshake.nextNonce();
  emitter.send("/av/hs/hello", [
    handshake.schemaVersion,
    handshake.hubVersion,
    HUB_INBOUND_PORT,
    nonce
  ]);
  handshake.noteHelloSent();
  state.txCount += 1;
  emitCounters();
  if (state.debug) {
    emitDebug("debug", "hello -> " + config.host + ":" + candidate + " nonce=" + nonce);
  }
}

function setUdpSendPort(port) {
  outlet(0, ["port", port]);
}

function setEnabled(value) {
  state.enabled = AV.toBoolean(value);
  if (state.enabled) {
    scheduleHelloLoop();
    emitStatus("enabled");
  } else {
    stopHelloLoop();
    stopHeartbeatLoop();
    emitStatus("disabled");
  }
  emitDebug("info", "hub " + (state.enabled ? "enabled" : "disabled"));
}

function setDebug(value) {
  state.debug = AV.toBoolean(value);
  emitStatus("debug " + (state.debug ? "enabled" : "disabled"));
}

function diagnostics(reason) {
  emitStatus(
    "diag " + reason +
      " state=" + handshake.state +
      " port=" + state.currentPort +
      " tx=" + state.txCount +
      " rx=" + state.rxCount +
      " ctrl=" + state.ctrlCount +
      " drop=" + state.droppedCount +
      " er=" + state.errorCount
  );
  emitDebug(
    "info",
    "diag reason=" + reason +
      " state=" + handshake.state +
      " schema=" + handshake.schemaVersion +
      " enabled=" + (state.enabled ? 1 : 0) +
      " session=" + (handshake.sessionId || "-") +
      " port=" + state.currentPort +
      " tx=" + state.txCount +
      " rx=" + state.rxCount +
      " drop=" + state.droppedCount
  );
}

function emitStatus(message) {
  state.lastStatus = String(message);
  outlet(1, state.lastStatus);
}

function emitDebug(level, message) {
  var payload = String(message);
  state.lastDebug = payload;
  outlet(2, payload);
  if (state.debug) {
    post("[av_sync_hub][" + level + "] " + payload + "\n");
    if (AV.appendLog) {
      AV.appendLog(level, "hub", payload);
    }
  }
}

function emitCounters() {
  outlet(
    3,
    "tx=" + state.txCount +
      " rx=" + state.rxCount +
      " ctrl=" + state.ctrlCount +
      " drop=" + state.droppedCount +
      " er=" + state.errorCount
  );
}
