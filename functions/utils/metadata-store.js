import pg from 'pg';

const { Client } = pg;

const POSTGRES_PROVIDER = 'postgres';

export function metadataProvider(env) {
  const configured = String(env.METADATA_PROVIDER || '').trim().toLowerCase();
  if (configured) return configured;
  return env.img_url ? 'kv' : 'none';
}

export function postgresConnectionString(env) {
  return env.POSTGRES_URL || env.DATABASE_URL || '';
}

export function hasMetadataStore(env) {
  const provider = metadataProvider(env);
  if (provider === POSTGRES_PROVIDER) return Boolean(postgresConnectionString(env));
  if (provider === 'kv') return Boolean(env.img_url);
  return false;
}

export function getMetadataStore(env) {
  const provider = metadataProvider(env);

  if (provider === POSTGRES_PROVIDER) {
    const connectionString = postgresConnectionString(env);
    if (!connectionString) {
      throw new Error('METADATA_PROVIDER=postgres requires POSTGRES_URL or DATABASE_URL');
    }
    return new PostgresKV(connectionString);
  }

  if (provider === 'kv') {
    if (!env.img_url) {
      throw new Error('METADATA_PROVIDER=kv requires the img_url KV binding');
    }
    return env.img_url;
  }

  return null;
}

// Implements the subset of the Workers KV API used by this project. Keeping
// the same interface lets existing metadata, short-link and dashboard code use
// PostgreSQL without duplicating business logic.
export class PostgresKV {
  constructor(connectionString, clientFactory = options => new Client(options)) {
    this.connectionString = connectionString;
    this.clientFactory = clientFactory;
  }

  async query(text, values) {
    const client = this.clientFactory({ connectionString: this.connectionString });
    await client.connect();
    try {
      return await client.query(text, values);
    } finally {
      await client.end();
    }
  }

  async getWithMetadata(key) {
    const result = await this.query(`
      SELECT value, metadata
      FROM telegraph_kv
      WHERE key = $1
        AND (expires_at IS NULL OR expires_at > NOW())
    `, [key]);

    if (!result.rows.length) return { value: null, metadata: null };
    return {
      value: result.rows[0].value,
      metadata: result.rows[0].metadata,
    };
  }

  async get(key) {
    const record = await this.getWithMetadata(key);
    return record.value;
  }

  async put(key, value, options = {}) {
    const metadata = options.metadata === undefined ? null : options.metadata;
    const ttl = Number.isFinite(options.expirationTtl) ? options.expirationTtl : null;

    await this.query(`
      INSERT INTO telegraph_kv (key, value, metadata, expires_at, updated_at)
      VALUES (
        $1,
        $2,
        $3::jsonb,
        CASE WHEN $4::double precision IS NULL
          THEN NULL
          ELSE NOW() + ($4 * INTERVAL '1 second')
        END,
        NOW()
      )
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        metadata = EXCLUDED.metadata,
        expires_at = EXCLUDED.expires_at,
        updated_at = NOW()
    `, [
      key,
      value == null ? null : String(value),
      metadata == null ? null : JSON.stringify(metadata),
      ttl,
    ]);
  }

  async delete(key) {
    await this.query('DELETE FROM telegraph_kv WHERE key = $1', [key]);
  }

  async list(options = {}) {
    const limit = Math.min(1000, Math.max(1, Number(options.limit) || 100));
    const prefix = String(options.prefix || '');
    const afterKey = decodeCursor(options.cursor);

    const result = await this.query(`
      SELECT key, metadata
      FROM telegraph_kv
      WHERE (expires_at IS NULL OR expires_at > NOW())
        AND key > $1
        AND key >= $2
        AND key < $3
      ORDER BY key ASC
      LIMIT $4
    `, [afterKey, prefix, prefix + '\uffff', limit + 1]);

    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit);
    return {
      keys: rows.map(row => ({ name: row.key, metadata: row.metadata })),
      list_complete: !hasMore,
      ...(hasMore && rows.length
        ? { cursor: encodeCursor(rows[rows.length - 1].key) }
        : {}),
    };
  }
}

function encodeCursor(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeCursor(cursor) {
  if (!cursor) return '';
  try {
    const binary = atob(cursor);
    return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
  } catch {
    return '';
  }
}
