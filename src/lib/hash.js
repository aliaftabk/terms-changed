// hash.js
// Local SHA-256 hashing using the Web Crypto API (crypto.subtle).
// Falls back to a small pure-JS hash if crypto.subtle is unavailable.

/**
 * Compute a SHA-256 hex hash of a string.
 * @param {string} text
 * @returns {Promise<string>} lowercase hex digest
 */
export async function sha256(text) {
  const input = String(text || "");
  try {
    if (globalThis.crypto && globalThis.crypto.subtle) {
      const data = new TextEncoder().encode(input);
      const buffer = await globalThis.crypto.subtle.digest("SHA-256", data);
      return bufferToHex(buffer);
    }
  } catch (err) {
    // Fall through to the JS fallback below.
  }
  return fallbackHash(input);
}

/**
 * Convert an ArrayBuffer to a lowercase hex string.
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function bufferToHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Deterministic non-cryptographic fallback hash (FNV-1a variant).
 * Only used if crypto.subtle is not available in the runtime.
 * @param {string} str
 * @returns {string}
 */
function fallbackHash(str) {
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x85ebca6b);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const part2 = (h2 >>> 0).toString(16).padStart(8, "0");
  return part1 + part2;
}
