var AV = AV || {};

(function () {
  var DEFAULT_HOST = "127.0.0.1";
  var DEFAULT_APP_PORT = 7777;
  var DEFAULT_HUB_PORT = 7788;

  function ConfigLoader(options) {
    options = options || {};
    this.host = options.host || DEFAULT_HOST;
    this.appPort = options.appPort || DEFAULT_APP_PORT;
    this.hubPort = options.hubPort || DEFAULT_HUB_PORT;
    this.schemaVersion = typeof options.schemaVersion === "number" ? options.schemaVersion : 0;
    this.sessionId = "";
  }

  ConfigLoader.prototype.setHost = function (value) {
    this.host = String(value || DEFAULT_HOST);
  };

  ConfigLoader.prototype.setAppPort = function (value) {
    var port = Math.round(Number(value));
    if (port >= 1 && port <= 65535) {
      this.appPort = port;
    }
  };

  ConfigLoader.prototype.setHubPort = function (value) {
    var port = Math.round(Number(value));
    if (port >= 1 && port <= 65535) {
      this.hubPort = port;
    }
  };

  ConfigLoader.prototype.snapshot = function () {
    return {
      host: this.host,
      appPort: this.appPort,
      hubPort: this.hubPort,
      schemaVersion: this.schemaVersion,
      sessionId: this.sessionId
    };
  };

  AV.ConfigLoader = ConfigLoader;
})();
