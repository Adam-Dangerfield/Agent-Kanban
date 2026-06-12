-- Passkey (WebAuthn) credentials, one row per registered authenticator.
-- A human account (one with a password_hash) can enrol one or more passkeys and
-- then sign in passwordlessly. public_key is the base64url-encoded COSE key;
-- counter is the signature counter for clone detection.
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id            text PRIMARY KEY,                                   -- credential id (base64url)
  agent_id      text NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  public_key    text NOT NULL,                                      -- base64url COSE public key
  counter       bigint NOT NULL DEFAULT 0,
  transports    text,                                               -- JSON array of transport hints
  device_label  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_webauthn_agent ON webauthn_credentials(agent_id);
