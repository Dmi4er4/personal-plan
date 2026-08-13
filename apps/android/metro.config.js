const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const secureWebcrypto = path.resolve(__dirname, "shims/isomorphic-webcrypto.js");
const previousResolveRequest = config.resolver.resolveRequest;

// lib0/webcrypto (Yjs client IDs) imports isomorphic-webcrypto's React Native
// adapter, which has no secure RNG on Expo SDK 57. Route it to Expo Crypto.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "isomorphic-webcrypto" || moduleName.startsWith("isomorphic-webcrypto/")) {
    return { type: "sourceFile", filePath: secureWebcrypto };
  }
  return previousResolveRequest
    ? previousResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
