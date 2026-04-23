var AV = AV || {};

(function () {
  function OscEmitter(outletFn, outletIndex) {
    this.outletFn = outletFn;
    this.outletIndex = typeof outletIndex === "number" ? outletIndex : 0;
    this.txCount = 0;
  }

  OscEmitter.prototype.send = function (address, args) {
    var packet = [String(address)];
    if (args && args.length) {
      Array.prototype.push.apply(packet, args);
    }
    this.txCount += 1;
    this.outletFn(this.outletIndex, packet);
  };

  OscEmitter.prototype.forwardRaw = function (packet) {
    if (!packet || !packet.length) {
      return;
    }
    this.txCount += 1;
    this.outletFn(this.outletIndex, packet);
  };

  AV.OscEmitter = OscEmitter;
})();
