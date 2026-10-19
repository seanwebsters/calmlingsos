// Allow server modules (which import "server-only") to run in plain Node scripts.
const Module = require("module");
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only") return require.resolve("./server-only-noop.cjs");
  return orig.call(this, request, ...rest);
};
