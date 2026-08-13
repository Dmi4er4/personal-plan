// Secure replacement for `isomorphic-webcrypto` on React Native.
//
// `lib0/webcrypto` (used by Yjs for client IDs) imports
// `isomorphic-webcrypto/src/react-native`, whose legacy adapter looks for
// `NativeModules.RNSecureRandom` / `NativeUnimoduleProxy.ExpoRandom`. Neither
// exists in Expo SDK 57, so the adapter seeds an insecure `Math.random`
// fallback and `getRandomValues()` throws until `ensureSecure()` is awaited.
//
// Expo Crypto exposes a synchronous, natively secure `getRandomValues`, so this
// shim forwards to it and keeps no insecure fallback at all.
const { getRandomValues } = require("expo-crypto");

const webcrypto = {
  ensureSecure() {
    return Promise.resolve();
  },
  getRandomValues(typedArray) {
    return getRandomValues(typedArray);
  },
  subtle: (globalThis.crypto && globalThis.crypto.subtle) || undefined,
};

module.exports = webcrypto;
module.exports.default = webcrypto;
