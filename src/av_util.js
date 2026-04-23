var AV = AV || {};

(function () {
  AV.clamp = function (value, min, max) {
    return Math.max(min, Math.min(max, value));
  };

  AV.roundTo = function (value, digits) {
    var factor = Math.pow(10, digits);
    return Math.round(value * factor) / factor;
  };

  AV.positiveMod = function (value, size) {
    return ((value % size) + size) % size;
  };

  AV.nowMs = function () {
    return new Date().getTime();
  };

  AV.normalizeAtom = function (value) {
    if (value === null || typeof value === "undefined") {
      return null;
    }
    if (value instanceof Array) {
      if (!value.length) {
        return null;
      }
      if (value.length === 1) {
        return value[0];
      }
      if (value.length === 2 && typeof value[0] === "string") {
        return value[1];
      }
    }
    return value;
  };

  AV.toNumber = function (value, fallback) {
    var numeric = Number(AV.normalizeAtom(value));
    return isNaN(numeric) ? fallback : numeric;
  };

  AV.toBoolean = function (value) {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      return value !== "0" && value.toLowerCase() !== "false" && value !== "";
    }
    return !!value;
  };

  AV.joinArgs = function (args) {
    if (!args || !args.length) {
      return "";
    }
    var parts = [];
    var index;
    for (index = 0; index < args.length; index++) {
      parts.push(String(args[index]));
    }
    return parts.join(" ");
  };

  AV.normalizeRole = function (value) {
    var text = String(value).toLowerCase();
    if (text === "1" || text === "master") {
      return "master";
    }
    return "lane";
  };

  AV.createApi = function (path) {
    try {
      return new LiveAPI(null, path);
    } catch (primaryError) {
      return new LiveAPI(path);
    }
  };

  AV.getValue = function (api, property) {
    return AV.normalizeAtom(api.get(property));
  };
})();
