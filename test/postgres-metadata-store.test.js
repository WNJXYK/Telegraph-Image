const assert = require('assert');

function fakeFactory(results, calls) {
  return options => ({
    async connect() { calls.push({ type: 'connect', options }); },
    async query(text, values) {
      calls.push({ type: 'query', text, values });
      return results.shift() || { rows: [] };
    },
    async end() { calls.push({ type: 'end' }); },
  });
}

describe('PostgreSQL metadata store', () => {
  let PostgresKV;
  let getMetadataStore;
  let hasMetadataStore;
  let metadataProvider;

  before(async () => {
    ({
      PostgresKV,
      getMetadataStore,
      hasMetadataStore,
      metadataProvider,
    } = await import('../functions/utils/metadata-store.js'));
  });

  it('keeps KV as the backwards-compatible default', () => {
    const img_url = {};
    const env = { img_url };
    assert.strictEqual(metadataProvider(env), 'kv');
    assert.strictEqual(hasMetadataStore(env), true);
    assert.strictEqual(getMetadataStore(env), img_url);
  });

  it('selects PostgreSQL explicitly from environment variables', () => {
    const env = {
      METADATA_PROVIDER: 'postgres',
      POSTGRES_URL: 'postgresql://example.invalid/db',
    };
    assert.strictEqual(metadataProvider(env), 'postgres');
    assert.strictEqual(hasMetadataStore(env), true);
    assert.ok(getMetadataStore(env) instanceof PostgresKV);
  });

  it('requires a PostgreSQL connection string', () => {
    const env = { METADATA_PROVIDER: 'postgres' };
    assert.strictEqual(hasMetadataStore(env), false);
    assert.throws(() => getMetadataStore(env), /POSTGRES_URL or DATABASE_URL/);
  });

  it('reads KV-compatible values and metadata', async () => {
    const calls = [];
    const store = new PostgresKV('postgresql://test', fakeFactory([
      { rows: [{ value: 'cat.png', metadata: { target: 'cat.png' } }] },
    ], calls));

    assert.deepStrictEqual(await store.getWithMetadata('short:AbC123'), {
      value: 'cat.png',
      metadata: { target: 'cat.png' },
    });
    assert.deepStrictEqual(calls.filter(call => call.type === 'query')[0].values, ['short:AbC123']);
    assert.strictEqual(calls.at(-1).type, 'end');
  });

  it('upserts metadata and TTL using parameters', async () => {
    const calls = [];
    const store = new PostgresKV('postgresql://test', fakeFactory([{ rows: [] }], calls));
    await store.put('moderation:live-models', '[1]', {
      metadata: { source: 'api' },
      expirationTtl: 3600,
    });

    const query = calls.find(call => call.type === 'query');
    assert.deepStrictEqual(query.values, [
      'moderation:live-models',
      '[1]',
      JSON.stringify({ source: 'api' }),
      3600,
    ]);
    assert.match(query.text, /ON CONFLICT \(key\) DO UPDATE/);
  });

  it('returns KV-compatible cursor pagination', async () => {
    const calls = [];
    const store = new PostgresKV('postgresql://test', fakeFactory([{
      rows: [
        { key: 'a.png', metadata: { fileName: 'a.png' } },
        { key: 'b.png', metadata: { fileName: 'b.png' } },
      ],
    }], calls));

    const page = await store.list({ limit: 1 });
    assert.strictEqual(page.keys.length, 1);
    assert.strictEqual(page.keys[0].name, 'a.png');
    assert.strictEqual(page.list_complete, false);
    assert.ok(page.cursor);
  });
});
