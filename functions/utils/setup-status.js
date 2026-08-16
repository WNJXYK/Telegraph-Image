import { isEmptyBinding } from './http.js';
import { hasMetadataStore, metadataProvider, postgresConnectionString } from './metadata-store.js';

// Deployment self-check. Most support requests about this project are a missing
// binding or an unset variable that only surfaces as a failed upload much later,
// so the homepage asks for this and says what is wrong up front.
//
// Only enum-valued status is reported, never a configured value: the states here
// are already observable by using the site, so publishing them adds no
// information an attacker could not get by trying an upload.

export function getSetupStatus(env) {
  const storage = storageStatus(env);
  const checks = {
    storage,
    dashboard: hasMetadataStore(env) ? 'ok' : 'unbound',
    metadata: metadataStatus(env),
    moderation: moderationStatus(env),
  };

  return {
    ready: storage.state === 'ok',
    checks: {
      storage: storage.state,
      storageProvider: storage.provider,
      dashboard: checks.dashboard,
      metadataProvider: checks.metadata.provider,
      metadata: checks.metadata.state,
      moderation: checks.moderation,
    },
    problems: problemsFor(storage, checks),
  };
}

function metadataStatus(env) {
  const provider = metadataProvider(env);
  if (provider === 'postgres') {
    return {
      provider,
      state: postgresConnectionString(env) ? 'ok' : 'missing-config',
    };
  }
  if (provider === 'kv') {
    return { provider, state: env.img_url ? 'ok' : 'missing-binding' };
  }
  if (provider === 'none') return { provider, state: 'disabled' };
  return { provider, state: 'unknown-provider' };
}

function storageStatus(env) {
  const provider = (env.STORAGE_PROVIDER || 'telegram').toLowerCase();

  if (provider === 'r2') {
    return {
      provider: 'r2',
      state: env.img_r2 ? 'ok' : 'missing-binding',
      missing: env.img_r2 ? [] : ['img_r2'],
    };
  }

  if (provider !== 'telegram') {
    return { provider, state: 'unknown-provider', missing: ['STORAGE_PROVIDER'] };
  }

  const missing = [];
  if (isEmptyBinding(env.TG_Bot_Token)) missing.push('TG_Bot_Token');
  if (isEmptyBinding(env.TG_Chat_ID)) missing.push('TG_Chat_ID');

  return {
    provider: 'telegram',
    state: missing.length ? 'missing-config' : 'ok',
    missing,
  };
}

function moderationStatus(env) {
  const explicit = (env.MODERATION_PROVIDER || '').toLowerCase();
  if (explicit) {
    if (explicit === 'cloudflare-ai') return env.AI ? 'cloudflare-ai' : 'cloudflare-ai-missing-binding';
    if (explicit === 'moderatecontent') {
      return isEmptyBinding(env.ModerateContentApiKey) ? 'moderatecontent-missing-key' : 'moderatecontent';
    }
    if (explicit === 'none') return 'none';
    return 'unknown-provider';
  }

  if (!isEmptyBinding(env.ModerateContentApiKey)) return 'moderatecontent';
  if (env.AI) return 'cloudflare-ai';
  return 'none';
}

// Messages name the variable or binding to fix and where to set it, because the
// reader is a deploying user looking at their own site, not a developer.
function problemsFor(storage, checks) {
  const problems = [];

  if (storage.state === 'missing-config') {
    problems.push({
      severity: 'error',
      message: `上传不可用：缺少环境变量 ${storage.missing.join('、')}。请在 Cloudflare Pages 项目的「设置 → 环境变量」中添加，然后重新部署。`,
    });
  }

  if (storage.state === 'missing-binding') {
    problems.push({
      severity: 'error',
      message: '上传不可用：STORAGE_PROVIDER=r2 但没有绑定名为 img_r2 的 R2 存储桶。请在「设置 → 函数 → R2 存储桶绑定」中添加，然后重新部署。',
    });
  }

  if (storage.state === 'unknown-provider') {
    problems.push({
      severity: 'error',
      message: `上传不可用：STORAGE_PROVIDER 的值 "${storage.provider}" 无法识别，可用值为 telegram 或 r2。`,
    });
  }

  if (checks.dashboard === 'unbound') {
    if (checks.metadata.provider === 'postgres' && checks.metadata.state === 'missing-config') {
      problems.push({
        severity: 'info',
        message: '后台图片管理未启用：METADATA_PROVIDER=postgres 时需要设置密钥 POSTGRES_URL（或 DATABASE_URL）并重新部署。',
      });
    } else if (checks.metadata.state === 'unknown-provider') {
      problems.push({
        severity: 'info',
        message: '后台图片管理未启用：METADATA_PROVIDER 可用值为 kv、postgres 或 none。',
      });
    } else {
      problems.push({
        severity: 'info',
        message: '后台图片管理未启用：绑定名为 img_url 的 KV，或设置 METADATA_PROVIDER=postgres 及 POSTGRES_URL。短链接功能也依赖元数据存储。',
      });
    }
  }

  if (checks.moderation === 'cloudflare-ai-missing-binding') {
    problems.push({
      severity: 'warning',
      message: '图片审查未生效：MODERATION_PROVIDER=cloudflare-ai 但没有绑定 Workers AI（变量名 AI）。',
    });
  }

  if (checks.moderation === 'moderatecontent-missing-key') {
    problems.push({
      severity: 'warning',
      message: '图片审查未生效：MODERATION_PROVIDER=moderatecontent 但没有设置 ModerateContentApiKey。该服务已停止新用户注册，建议改用 Workers AI。',
    });
  }

  if (checks.moderation === 'unknown-provider') {
    problems.push({
      severity: 'warning',
      message: 'MODERATION_PROVIDER 的值无法识别，审查已按 none 处理。可用值为 cloudflare-ai、moderatecontent、none。',
    });
  }

  return problems;
}
