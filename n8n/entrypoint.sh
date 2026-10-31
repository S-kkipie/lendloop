#!/bin/sh
# Provisions LendLoop's n8n on every start, then hands over to n8n:
# render placeholders, import credentials from env (temp file, deleted at once),
# import the workflows and publish them. Same IDs overwrite, so it is idempotent.
# Secrets are read from env by node; they never appear on argv or in logs.
set -eu

for name in N8N_ENCRYPTION_KEY LENDLOOP_N8N_WEBHOOK_SECRET LENDLOOP_CONVEX_INBOUND_SECRET \
  CONVEX_SITE_URL MAIL_FROM OPS_EMAIL SMTP_HOST SMTP_PORT; do
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "lendloop-entrypoint: $name is required (run pnpm setup:local)" >&2
    exit 1
  fi
done
unset value

umask 077
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT INT TERM
mkdir "$WORK/workflows"
export WORK

# 1. Render workflows: only these three placeholders are substituted.
node <<'JS'
const fs = require("node:fs");
const path = require("node:path");
const src = "/opt/lendloop/workflows";
const placeholders = ["CONVEX_SITE_URL", "MAIL_FROM", "OPS_EMAIL"];
for (const file of fs.readdirSync(src).filter((f) => f.endsWith(".json"))) {
  let text = fs.readFileSync(path.join(src, file), "utf8");
  // Placeholders sit inside JSON strings, so values are inserted JSON-escaped.
  for (const key of placeholders) text = text.split(`{{${key}}}`).join(JSON.stringify(process.env[key]).slice(1, -1));
  JSON.parse(text); // fail fast on a broken render
  fs.writeFileSync(path.join(process.env.WORK, "workflows", file), text);
}
JS

# 2. Credentials: plaintext `data` objects are encrypted by import:credentials.
node <<'JS'
const fs = require("node:fs");
const env = process.env;
const credentials = [
  { id: "llCryptoInbound01", name: "LendLoop: Convex→n8n HMAC", type: "crypto", data: { hmacSecret: env.LENDLOOP_N8N_WEBHOOK_SECRET } },
  { id: "llCryptoOutbound1", name: "LendLoop: n8n→Convex HMAC", type: "crypto", data: { hmacSecret: env.LENDLOOP_CONVEX_INBOUND_SECRET } },
  {
    id: "llSmtp0000000001",
    name: "LendLoop SMTP",
    type: "smtp",
    data: {
      user: env.SMTP_USER ?? "",
      password: env.SMTP_PASS ?? "",
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT),
      secure: env.SMTP_SECURE === "true",
    },
  },
];
fs.writeFileSync(`${env.WORK}/credentials.json`, JSON.stringify(credentials), { mode: 0o600 });
JS
n8n import:credentials --input="$WORK/credentials.json"
rm -f "$WORK/credentials.json"

# 3. Workflows: imported inactive, then published so `n8n start` activates them.
n8n import:workflow --separate --input="$WORK/workflows"
for id in $(node -e 'const fs=require("node:fs");const d=process.env.WORK+"/workflows";for(const f of fs.readdirSync(d))console.log(JSON.parse(fs.readFileSync(d+"/"+f,"utf8")).id)'); do
  n8n publish:workflow --id="$id"
done

rm -rf "$WORK"
trap - EXIT INT TERM
unset WORK
exec n8n start
