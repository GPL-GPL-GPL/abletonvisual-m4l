var AV = AV || {};

(function () {
  function OscReceiver() {
    this.handlers = {};
    this.wildcardHandler = null;
    this.rxCount = 0;
    this.parseErrorCount = 0;
  }

  OscReceiver.prototype.on = function (address, handler) {
    this.handlers[address] = handler;
  };

  OscReceiver.prototype.onAny = function (handler) {
    this.wildcardHandler = handler;
  };

  OscReceiver.prototype.handle = function (args) {
    if (!args || !args.length) {
      this.parseErrorCount += 1;
      return;
    }
    var address = String(args[0]);
    var payload = Array.prototype.slice.call(args, 1);
    this.rxCount += 1;
    var handler = this.handlers[address];
    if (handler) {
      handler(payload, address);
      return;
    }
    if (this.wildcardHandler) {
      this.wildcardHandler(address, payload);
    }
  };

  AV.OscReceiver = OscReceiver;
})();
