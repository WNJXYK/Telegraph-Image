CREATE TABLE IF NOT EXISTS telegraph_kv (
    key         TEXT PRIMARY KEY,
    value       TEXT,
    metadata    JSONB,
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS telegraph_kv_key_prefix_idx
    ON telegraph_kv (key text_pattern_ops);

CREATE INDEX IF NOT EXISTS telegraph_kv_expires_at_idx
    ON telegraph_kv (expires_at)
    WHERE expires_at IS NOT NULL;
