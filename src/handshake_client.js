var AV = AV || {};

(function () {
  var PROTOCOL_SCHEMA_VERSION = 1;
  var HUB_VERSION = "0.1.0";
  var HEARTBEAT_MISS_THRESHOLD = 3;

  function HandshakeClient(options) {
    options = options || {};
    this.schemaVersion = typeof options.schemaVersion === "number"
      ? options.schemaVersion
      : PROTOCOL_SCHEMA_VERSION;
    this.hubVersion = options.hubVersion || HUB_VERSION;
    this.log = options.log || function () {};
    this.state = "listening";
    this.sessionId = "";
    this.peerAlive = false;
    this.nonceCounter = 0;
    this.lastNonce = 0;
    this.lastHelloAt = 0;
    this.lastWelcomeAt = 0;
    this.rejectReason = "";
    this.lanes = {};
    this.pingSeq = 0;
    this.consecutiveMissed = 0;
    this.lastPongSeq = 0;
    this.lastPongAt = 0;
  }

  HandshakeClient.prototype._resetHeartbeat = function () {
    this.pingSeq = 0;
    this.consecutiveMissed = 0;
    this.lastPongSeq = 0;
    this.lastPongAt = 0;
  };

  HandshakeClient.prototype.nextNonce = function () {
    this.nonceCounter = (this.nonceCounter + 1) | 0;
    if (this.nonceCounter <= 0) {
      this.nonceCounter = 1;
    }
    this.lastNonce = this.nonceCounter;
    return this.nonceCounter;
  };

  HandshakeClient.prototype.noteHelloSent = function () {
    this.lastHelloAt = Date.now();
  };

  HandshakeClient.prototype.handleWelcome = function (payload) {
    if (!payload || payload.length < 5) {
      this.log("warn", "welcome payload too short");
      return false;
    }
    var sessionId = String(payload[0]);
    var schemaVersion = Number(payload[1]) | 0;
    var nonce = Number(payload[3]) | 0;
    var accepted = Number(payload[4]) !== 0;
    var rejectReason = payload.length > 5 ? String(payload[5]) : "";

    if (nonce !== this.lastNonce) {
      this.log("warn", "welcome nonce mismatch got=" + nonce + " expected=" + this.lastNonce);
      return false;
    }

    this.sessionId = sessionId;
    this.rejectReason = accepted ? "" : rejectReason;
    this.lastWelcomeAt = Date.now();
    this.peerAlive = true;

    if (accepted && schemaVersion === this.schemaVersion) {
      this.state = "streaming";
      this._resetHeartbeat();
      this.log("info", "welcome accepted session=" + sessionId + " schema=" + schemaVersion);
    } else {
      this.state = "degraded";
      this.log("warn", "welcome rejected schema=" + schemaVersion + " reason=" + rejectReason);
    }
    return true;
  };

  HandshakeClient.prototype.markPeerDown = function (reason) {
    if (this.state === "listening") {
      return;
    }
    this.state = "listening";
    this.peerAlive = false;
    this.sessionId = "";
    this.lanes = {};
    this._resetHeartbeat();
    this.log("warn", "peer down: " + reason);
  };

  HandshakeClient.prototype.beginLaneRegistration = function (laneId, laneName, claimedRole, trackName) {
    var existing = this.lanes[laneId];
    var roleChanged = !existing || existing.claimedRole !== claimedRole;
    var metaChanged = !existing || existing.laneName !== laneName || existing.trackName !== trackName;
    if (existing && existing.status === "active" && !roleChanged && !metaChanged) {
      return null;
    }
    var nonce = this.nextNonce();
    this.lanes[laneId] = {
      laneId: laneId,
      laneName: laneName,
      claimedRole: claimedRole,
      trackName: trackName,
      assignedRole: existing && !roleChanged ? existing.assignedRole : null,
      status: existing && existing.status === "active" && !roleChanged ? "active" : "pending",
      nonce: nonce,
      lastSentAt: Date.now()
    };
    return nonce;
  };

  HandshakeClient.prototype.handleLaneAck = function (payload) {
    if (!payload || payload.length < 4) {
      this.log("warn", "lane_ack payload too short");
      return null;
    }
    var sessionId = String(payload[0]);
    var laneId = String(payload[1]);
    var assignedRole = String(payload[2]);
    var nonce = Number(payload[3]) | 0;

    if (this.sessionId && sessionId !== this.sessionId) {
      this.log("warn", "lane_ack session mismatch got=" + sessionId + " expected=" + this.sessionId);
      return null;
    }
    var entry = this.lanes[laneId];
    if (!entry) {
      this.log("warn", "lane_ack for unknown lane " + laneId);
      return null;
    }
    if (entry.nonce !== nonce) {
      this.log("warn", "lane_ack nonce mismatch lane=" + laneId + " got=" + nonce + " expected=" + entry.nonce);
      return null;
    }
    entry.assignedRole = assignedRole;
    entry.status = "active";
    entry.lastAckAt = Date.now();
    return { laneId: laneId, assignedRole: assignedRole, downgraded: entry.claimedRole === "master" && assignedRole !== "master" };
  };

  HandshakeClient.prototype.isLaneActive = function (laneId) {
    var entry = this.lanes[laneId];
    return !!(entry && entry.status === "active");
  };

  HandshakeClient.prototype.laneAssignedRole = function (laneId) {
    var entry = this.lanes[laneId];
    return entry ? entry.assignedRole : null;
  };

  HandshakeClient.prototype.isStreamingAllowed = function () {
    return this.state === "streaming";
  };

  HandshakeClient.prototype.beginHeartbeatTick = function () {
    if (this.state !== "streaming") {
      return null;
    }
    this.pingSeq = (this.pingSeq + 1) | 0;
    if (this.pingSeq <= 0) {
      this.pingSeq = 1;
    }
    this.consecutiveMissed = this.consecutiveMissed + 1;
    var result = {
      seq: this.pingSeq,
      tsMs: Date.now(),
      peerDown: false,
      missed: this.consecutiveMissed
    };
    if (this.consecutiveMissed >= HEARTBEAT_MISS_THRESHOLD) {
      result.peerDown = true;
    }
    return result;
  };

  HandshakeClient.prototype.handlePing = function (payload) {
    if (!payload || payload.length < 3) {
      this.log("warn", "ping payload too short");
      return null;
    }
    if (this.state !== "streaming") {
      return null;
    }
    var sessionId = String(payload[0]);
    var seq = Number(payload[1]) | 0;
    var tsMs = Number(payload[2]) | 0;
    if (this.sessionId && sessionId !== this.sessionId) {
      this.log("warn", "ping session mismatch got=" + sessionId);
      return null;
    }
    return { seq: seq, tsMs: tsMs };
  };

  HandshakeClient.prototype.handlePong = function (payload) {
    if (!payload || payload.length < 3) {
      this.log("warn", "pong payload too short");
      return false;
    }
    if (this.state !== "streaming") {
      return false;
    }
    var seq = Number(payload[1]) | 0;
    this.consecutiveMissed = 0;
    this.lastPongSeq = seq;
    this.lastPongAt = Date.now();
    return true;
  };

  HandshakeClient.prototype.status = function () {
    return {
      state: this.state,
      sessionId: this.sessionId,
      schemaVersion: this.schemaVersion,
      peerAlive: this.peerAlive,
      rejectReason: this.rejectReason
    };
  };

  AV.PROTOCOL_SCHEMA_VERSION = PROTOCOL_SCHEMA_VERSION;
  AV.HUB_VERSION = HUB_VERSION;
  AV.HandshakeClient = HandshakeClient;
})();
