export function emailTlsRejectUnauthorized(env: NodeJS.ProcessEnv = process.env) {
  const allowInsecure = /^(1|true|yes|on)$/i.test(String(env.EMAIL_ALLOW_INSECURE_TLS || "").trim());
  return !allowInsecure;
}
