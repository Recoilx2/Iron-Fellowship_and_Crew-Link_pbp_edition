// dist/internal/auth/jwt.js from supabase/storage-api v1.89.12, patched for
// Iron-Fellowship ticket #152 (four changes, marked PATCH in the body):
// - no verification keys configured: refuse everything (fail closed),
// - HMAC tokens refused outright: no static-secret fallback,
// - an asymmetric token with no matching key refused: no secret fallback,
// - HMAC token signing refused: the stack mints no HS256 tokens.
// Built with the repo's own build.js and its lockfile-pinned esbuild 0.28.1.
// The image tag this file matches is pinned in tests/template.test.mjs.
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var jwt_exports = {};
__export(jwt_exports, {
  JWT_CACHE_TTL_RESOLUTION_MS: () => JWT_CACHE_TTL_RESOLUTION_MS,
  SIGNED_URL_SCOPE_DOWNLOAD: () => SIGNED_URL_SCOPE_DOWNLOAD,
  SIGNED_URL_SCOPE_UPLOAD: () => SIGNED_URL_SCOPE_UPLOAD,
  assertValidNumericJWTExpiration: () => assertValidNumericJWTExpiration,
  generateES256JWK: () => generateES256JWK,
  generateHS512JWK: () => generateHS512JWK,
  getMaxNumericJWTExpiration: () => getMaxNumericJWTExpiration,
  isDownloadScopedToken: () => isDownloadScopedToken,
  isJwtToken: () => isJwtToken,
  isUploadScopedToken: () => isUploadScopedToken,
  jwkSupportsPublic: () => jwkSupportsPublic,
  signJWT: () => signJWT,
  toPublicJwk: () => toPublicJwk,
  verifyJWT: () => verifyJWT,
  verifyJWTWithCache: () => verifyJWTWithCache
});
module.exports = __toCommonJS(jwt_exports);
var import_node_crypto = require("node:crypto");
var import_cache = require("../cache/index.js");
var import_errors = require("../errors/index.js");
var import_jose = require("jose");
var import_config = require("../../config.js");
var import_kid = require("./jwks/kid.js");
const { jwtAlgorithm, caches } = (0, import_config.getConfig)();
const JWT_HMAC_ALGOS = ["HS256", "HS384", "HS512"];
const JWT_RSA_ALGOS = ["RS256", "RS384", "RS512"];
const JWT_ECC_ALGOS = ["ES256", "ES384", "ES512"];
const JWT_ED_ALGOS = ["EdDSA"];
const JWT_DEFAULT_ALGOS = [jwtAlgorithm];
const MAX_ABSOLUTE_JWT_EXPIRATION_SECONDS = Math.floor(Number.MAX_SAFE_INTEGER / 1e3);
const SIGNED_URL_SCOPE_DOWNLOAD = "download";
const SIGNED_URL_SCOPE_UPLOAD = "upload";
function isUploadScopedToken(payload) {
  return payload.scope === SIGNED_URL_SCOPE_UPLOAD || payload.scope === void 0 && "upsert" in payload;
}
function isDownloadScopedToken(payload) {
  return payload.scope === SIGNED_URL_SCOPE_DOWNLOAD || payload.scope === void 0 && !("upsert" in payload);
}
const jwtJwksFingerprintCache = /* @__PURE__ */ new WeakMap();
const jwtAlgorithmsCache = /* @__PURE__ */ new WeakMap();
const encoder = new TextEncoder();
const preparedObjectVerificationKeys = /* @__PURE__ */ new WeakMap();
const preparedObjectSigningKeys = /* @__PURE__ */ new WeakMap();
const preparedSecretVerificationKeys = (0, import_cache.createLruCache)(
  import_cache.JWT_VERIFICATION_KEY_CACHE_NAME,
  {
    max: caches.jwtVerificationKey.maxEntries,
    ttl: caches.jwtVerificationKey.ttlMs
  }
);
const preparedSecretSigningKeys = (0, import_cache.createLruCache)(
  import_cache.JWT_SIGNING_KEY_CACHE_NAME,
  {
    max: caches.jwtSigningKey.maxEntries,
    ttl: caches.jwtSigningKey.ttlMs
  }
);
const HMAC_SIGN_USAGES = ["sign"];
const HMAC_VERIFY_USAGES = ["verify"];
function getSecretKeyCacheKey(alg, secret) {
  return `${alg}\0${secret}`;
}
function importHMACKey(key, alg, usages) {
  const keyData = key.buffer instanceof ArrayBuffer ? key : Uint8Array.from(key);
  return globalThis.crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: `SHA-${alg.slice(-3)}` },
    false,
    usages
  );
}
function importVerificationKey(key, alg) {
  if (typeof key === "string") {
    return importHMACKey(encoder.encode(key), alg, HMAC_VERIFY_USAGES);
  }
  if (key instanceof Uint8Array) {
    return importHMACKey(key, alg, HMAC_VERIFY_USAGES);
  }
  if (key.kty === "oct" && key.k) {
    return importHMACKey(Buffer.from(key.k, "base64"), alg, HMAC_VERIFY_USAGES);
  }
  return (0, import_jose.importJWK)(toPublicJwk(key), key.alg ?? alg).then((imported) => {
    if (imported instanceof Uint8Array) {
      return importHMACKey(imported, alg, HMAC_VERIFY_USAGES);
    }
    return imported;
  });
}
function importSigningKey(key, alg) {
  if (typeof key === "string") {
    return importHMACKey(encoder.encode(key), alg, HMAC_SIGN_USAGES);
  }
  if (key instanceof Uint8Array) {
    return importHMACKey(key, alg, HMAC_SIGN_USAGES);
  }
  return (0, import_jose.importJWK)(key).then((imported) => {
    if (imported instanceof Uint8Array) {
      return importHMACKey(imported, alg, HMAC_SIGN_USAGES);
    }
    return imported;
  });
}
function getPreparedJWTKey(key, alg, secretCache, objectCache, importKey) {
  if (typeof key === "string") {
    const cacheKey = getSecretKeyCacheKey(alg, key);
    const cachedKey2 = secretCache.get(cacheKey);
    if (cachedKey2) {
      return cachedKey2;
    }
    const importedKey2 = importKey(key, alg);
    secretCache.set(cacheKey, importedKey2);
    importedKey2.catch(() => {
      if (secretCache.get(cacheKey, import_cache.CACHE_LOOKUP_WITHOUT_METRICS) === importedKey2) {
        secretCache.delete(cacheKey);
      }
    });
    return importedKey2;
  }
  let byAlg = objectCache.get(key);
  if (!byAlg) {
    byAlg = /* @__PURE__ */ new Map();
    objectCache.set(key, byAlg);
  }
  const cachedKey = byAlg.get(alg);
  if (cachedKey) {
    return cachedKey;
  }
  const importedKey = importKey(key, alg);
  byAlg.set(alg, importedKey);
  importedKey.catch(() => {
    if (byAlg.get(alg) === importedKey) {
      byAlg.delete(alg);
    }
  });
  return importedKey;
}
function getPreparedJWTVerificationKey(key, alg) {
  return getPreparedJWTKey(
    key,
    alg,
    preparedSecretVerificationKeys,
    preparedObjectVerificationKeys,
    importVerificationKey
  );
}
function getPreparedJWTSigningKey(key, alg) {
  return getPreparedJWTKey(
    key,
    alg,
    preparedSecretSigningKeys,
    preparedObjectSigningKeys,
    importSigningKey
  );
}
const PUBLIC_JWK_FIELDS = {
  RSA: ["kid", "alg", "n", "e"],
  EC: ["kid", "alg", "crv", "x", "y"],
  OKP: ["kid", "alg", "crv", "x"]
};
function jwkSupportsPublic(jwk) {
  return Boolean(PUBLIC_JWK_FIELDS[jwk.kty]);
}
function toPublicJwk(jwk) {
  const publicFields = PUBLIC_JWK_FIELDS[jwk.kty];
  if (!publicFields) {
    throw new Error(`Cannot derive a public jwk for kty "${jwk.kty}"`);
  }
  const publicJwk = { kty: jwk.kty };
  for (const field of publicFields) {
    const value = jwk[field];
    if (value !== void 0) {
      publicJwk[field] = value;
    }
  }
  return publicJwk;
}
function kidsMatch(keyKid, headerKid) {
  if (keyKid === void 0 || headerKid === void 0) {
    return false;
  }
  return keyKid === headerKid || (0, import_kid.normalizeUrlSigningKid)(keyKid) === (0, import_kid.normalizeUrlSigningKid)(headerKid);
}
async function findJWKFromHeader(header, secret, jwks) {
  if (!jwks || !jwks.keys) {
    throw import_errors.ERRORS.AccessDenied("No JWT verification keys configured");
  }
  if (JWT_HMAC_ALGOS.indexOf(header.alg) > -1) {
    throw import_errors.ERRORS.AccessDenied(`JWT algorithm "${header.alg}" is not accepted`);
  }
  let kty = "RSA";
  if (JWT_ECC_ALGOS.indexOf(header.alg) > -1) {
    kty = "EC";
  } else if (JWT_ED_ALGOS.indexOf(header.alg) > -1) {
    kty = "OKP";
  }
  const jwk = jwks.keys.find((key) => {
    return (!key.kid && !header.kid || kidsMatch(key.kid, header.kid)) && key.kty === kty && (key.alg === void 0 || key.alg === header.alg);
  });
  if (!jwk) {
    throw import_errors.ERRORS.AccessDenied(
      `No JWT verification key matches algorithm "${header.alg}" and kid "${header.kid ?? ""}"`
    );
  }
  return getPreparedJWTVerificationKey(jwk, header.alg);
}
function getJWTVerificationKey(secret, jwks) {
  return (header) => findJWKFromHeader(header, secret, jwks);
}
function getJWTAlgorithms(jwks) {
  if (!jwks?.keys?.length) {
    return [];
  }
  const cachedAlgorithms = jwtAlgorithmsCache.get(jwks);
  if (cachedAlgorithms) {
    return cachedAlgorithms;
  }
  const hasRSA = jwks.keys.find((key) => key.kty === "RSA");
  const hasECC = jwks.keys.find((key) => key.kty === "EC");
  const hasED = jwks.keys.find(
    (key) => key.kty === "OKP" && (key.crv === "Ed25519" || key.crv === "Ed448")
  );
  const algorithms = [
    ...hasRSA ? JWT_RSA_ALGOS : [],
    ...hasECC ? JWT_ECC_ALGOS : [],
    ...hasED ? JWT_ED_ALGOS : []
  ];
  jwtAlgorithmsCache.set(jwks, algorithms);
  return algorithms;
}
function getJWTJwksFingerprint(jwks) {
  if (!jwks) {
    return "null";
  }
  const cachedFingerprint = jwtJwksFingerprintCache.get(jwks);
  if (cachedFingerprint) {
    return cachedFingerprint;
  }
  const fingerprint = (0, import_node_crypto.createHash)("sha256").update(JSON.stringify(jwks.keys ?? null)).digest("base64url");
  jwtJwksFingerprintCache.set(jwks, fingerprint);
  return fingerprint;
}
function getJWTCacheKey(token, secret, jwks) {
  const hash = (0, import_node_crypto.createHash)("sha256").update(token).update("\0").update(secret).update("\0").update(getJWTJwksFingerprint(jwks));
  return hash.digest("base64url");
}
const JWT_CACHE_TTL_RESOLUTION_MS = 5e3;
const jwtCache = (0, import_cache.createLruCache)(import_cache.JWT_CACHE_NAME, {
  max: caches.jwt.maxEntries,
  ttlResolution: JWT_CACHE_TTL_RESOLUTION_MS,
  purgeStaleIntervalMs: import_cache.DEFAULT_CACHE_PURGE_STALE_INTERVAL_MS
});
async function verifyJWTWithCache(token, secret, jwks) {
  const cacheKey = getJWTCacheKey(token, secret, jwks);
  const cachedPayload = jwtCache.get(cacheKey);
  if (cachedPayload && cachedPayload.exp && cachedPayload.exp * 1e3 > Date.now()) {
    return Promise.resolve(cachedPayload);
  }
  const payload = await verifyJWT(token, secret, jwks);
  if (!payload.exp) {
    return payload;
  }
  const remainingTtl = payload.exp * 1e3 - Date.now();
  const ttl = caches.jwt.ttlMs ? Math.min(remainingTtl, caches.jwt.ttlMs) : remainingTtl;
  if (ttl > 0) {
    jwtCache.set(cacheKey, payload, { ttl });
  }
  return payload;
}
async function verifyJWT(token, secret, jwks) {
  try {
    const { payload } = await (0, import_jose.jwtVerify)(token, getJWTVerificationKey(secret, jwks || null), {
      algorithms: getJWTAlgorithms(jwks || null)
    });
    return payload;
  } catch (e) {
    const err = e;
    throw import_errors.ERRORS.AccessDenied(err.message, err);
  }
}
async function signJWT(payload, secret, expiresIn) {
  if (typeof secret === "string" || secret.kty === "oct") {
    throw import_errors.ERRORS.AccessDenied("HMAC token signing is not accepted");
  }
  const signer = new import_jose.SignJWT(payload).setIssuedAt();
  if (expiresIn !== void 0) {
    const expiresInStr = getJWTExpirationTime(expiresIn);
    try {
      signer.setExpirationTime(expiresInStr);
    } catch (e) {
      throw import_errors.ERRORS.InvalidParameter("expiresIn", { error: e });
    }
  }
  if (typeof secret === "string") {
    const signingSecret2 = JWT_HMAC_ALGOS.includes(jwtAlgorithm) ? await getPreparedJWTSigningKey(secret, jwtAlgorithm) : encoder.encode(secret);
    return signer.setProtectedHeader({ alg: jwtAlgorithm }).sign(signingSecret2);
  }
  const alg = secret.alg || jwtAlgorithm;
  const signingSecret = await getPreparedJWTSigningKey(secret, alg);
  return signer.setProtectedHeader({ kid: secret.kid, alg }).sign(signingSecret);
}
function getJWTExpirationTime(expiresIn) {
  if (typeof expiresIn === "string") {
    return expiresIn;
  }
  assertValidNumericJWTExpiration(expiresIn);
  return `${Math.floor(expiresIn)}s`;
}
function getMaxNumericJWTExpiration(nowMs = Date.now()) {
  const nowSeconds = Math.floor(nowMs / 1e3);
  return Math.max(0, MAX_ABSOLUTE_JWT_EXPIRATION_SECONDS - nowSeconds);
}
function assertValidNumericJWTExpiration(expiresIn, nowMs = Date.now()) {
  if (!Number.isFinite(expiresIn)) {
    throw import_errors.ERRORS.InvalidParameter("expiresIn");
  }
  const expiresInSeconds = Math.floor(expiresIn);
  const maxRelativeExpirationSeconds = getMaxNumericJWTExpiration(nowMs);
  if (!Number.isSafeInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > maxRelativeExpirationSeconds) {
    throw import_errors.ERRORS.InvalidParameter("expiresIn");
  }
}
async function generateHS512JWK() {
  const secret = await (0, import_jose.generateSecret)("HS512", { extractable: true });
  const jwk = await (0, import_jose.exportJWK)(secret);
  jwk.alg = "HS512";
  return jwk;
}
async function generateES256JWK() {
  const { privateKey } = await (0, import_jose.generateKeyPair)("ES256", { extractable: true });
  const jwk = await (0, import_jose.exportJWK)(privateKey);
  jwk.alg = "ES256";
  return jwk;
}
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)?$/;
function isJwtToken(token) {
  return token.replace("Bearer ", "").match(JWT_SHAPE);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  JWT_CACHE_TTL_RESOLUTION_MS,
  SIGNED_URL_SCOPE_DOWNLOAD,
  SIGNED_URL_SCOPE_UPLOAD,
  assertValidNumericJWTExpiration,
  generateES256JWK,
  generateHS512JWK,
  getMaxNumericJWTExpiration,
  isDownloadScopedToken,
  isJwtToken,
  isUploadScopedToken,
  jwkSupportsPublic,
  signJWT,
  toPublicJwk,
  verifyJWT,
  verifyJWTWithCache
});
