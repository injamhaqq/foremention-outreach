import { createHash, createPrivateKey, createPublicKey, sign } from "crypto";

const ED25519_PKCS8_SEED_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function secretSeed(secret: string) {
  const normalized = secret.trim();
  if (!normalized) throw new Error("Foremention mini-audit secret is not configured.");
  return createHash("sha256").update(normalized, "utf8").digest();
}

function privateKeyFromSecret(secret: string) {
  const der = Buffer.concat([ED25519_PKCS8_SEED_PREFIX, secretSeed(secret)]);
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

export function miniAuditPublicKeyFromSecret(secret: string) {
  const publicKey = createPublicKey(privateKeyFromSecret(secret));
  const der = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  return der.toString("base64url");
}

export function miniAuditSigningKeyId(secret: string) {
  const publicKey = miniAuditPublicKeyFromSecret(secret);
  return createHash("sha256").update(publicKey, "utf8").digest("hex").slice(0, 16);
}

export function miniAuditRequestPayload(input: {
  timestamp: string;
  method: string;
  path: string;
  body: string;
}) {
  const bodyHash = createHash("sha256").update(input.body, "utf8").digest("hex");
  return [
    "foremention-outreach-v1",
    input.timestamp,
    input.method.toUpperCase(),
    input.path,
    bodyHash,
  ].join("\n");
}

export function signMiniAuditRequest(secret: string, input: {
  timestamp: string;
  method: string;
  path: string;
  body: string;
}) {
  const payload = miniAuditRequestPayload(input);
  const signature = sign(null, Buffer.from(payload, "utf8"), privateKeyFromSecret(secret));
  return {
    signature: signature.toString("base64url"),
    publicKey: miniAuditPublicKeyFromSecret(secret),
    keyId: miniAuditSigningKeyId(secret),
  };
}
