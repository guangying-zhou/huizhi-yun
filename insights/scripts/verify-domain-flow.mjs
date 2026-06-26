#!/usr/bin/env node
/**
 * 开发辅助脚本：创建一个 pending_dns 域并触发内部验证流程。
 * 前置：确保 .env.dev (或 .env) 已设置 CF_API_TOKEN / CF_ZONE_ID / PLATFORM_CNAME_TARGET / INTERNAL_CRON_TOKEN
 * 运行：
 *   node scripts/verify-domain-flow.mjs --business <businessId> --host <custom.domain.com>
 * 可选：
 *   --limit 10            一次批处理数量 (默认20)
 *   --base http://...     API 基础地址 (默认 http://localhost:3000)
 *   --token xxx           INTERNAL_CRON_TOKEN (否则读取环境变量)
 *   --no-create           跳过创建 (仅验证)
 *   --verbose             输出更详细信息
 *   --dotenv .env.dev     指定要加载的 env 文件
 */
import fetch from 'node-fetch';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

// ---------------- env 加载 ----------------
function loadDotEnv(file) {
  if (!file || !fs.existsSync(file)) return;
  const txt = fs.readFileSync(file, 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

// ---------------- 参数解析 ----------------
const args = process.argv.slice(2);
const opts = { verbose: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--business') opts.businessId = args[++i];
  else if (a === '--host' || a === '--hostname') opts.hostname = args[++i];
  else if (a === '--limit') opts.limit = args[++i];
  else if (a === '--base') opts.base = args[++i];
  else if (a === '--token') opts.token = args[++i];
  else if (a === '--no-create') opts.noCreate = true;
  else if (a === '--verbose') opts.verbose = true;
  else if (a === '--dotenv') opts.dotenv = args[++i];
  else if (a === '--recover') opts.recover = true;
}

// 推断仓库根目录
const scriptFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptFile), '..');

// 先按优先级加载 dotenv
if (opts.dotenv) {
  loadDotEnv(path.resolve(process.cwd(), opts.dotenv));
} else {
  const candidates = ['.env.local', '.env.dev', '.env'];
  for (const f of candidates) {
    const full = path.join(repoRoot, f);
    if (fs.existsSync(full)) {
      loadDotEnv(full);
      if (opts.verbose) console.log('[dotenv] loaded', f);
      break;
    }
  }
}

if (!opts.businessId && !opts.noCreate) {
  console.error('\n缺少 --business');
  process.exit(1);
}
if (!opts.hostname && !opts.noCreate) {
  console.error('\n缺少 --host');
  process.exit(1);
}

const base = opts.base || process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3000';
const internalToken = opts.token || process.env.INTERNAL_CRON_TOKEN;
if (!internalToken) {
  console.error('缺少 INTERNAL_CRON_TOKEN (可用 --token 或在 .env.dev 中设置)');
  process.exit(1);
}

async function listDomains() {
  try {
    const url = base.replace(/\/$/, '') + '/api/account/domains';
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.success) return null;
    return data.data;
  } catch (e) {
    return null;
  }
}

async function createDomain() {
  if (opts.noCreate) return null;
  const url = base.replace(/\/$/, '') + '/api/account/domains';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessId: opts.businessId, hostname: opts.hostname })
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok || !data?.success) {
    console.error('创建域失败, 尝试读取已有记录:', data || res.status);
    const existing = await listDomains();
    if (existing) {
      const found = existing.find(d => d.hostname === opts.hostname);
      if (found) {
        console.log('使用已存在域:', found);
        return found;
      }
    }
    // 尝试内部 lookup (需要 token)
    try {
      const lookupUrl = base.replace(/\/$/, '') + `/api/internal/domains/lookup?hostname=${encodeURIComponent(opts.hostname)}`;
      const lres = await fetch(lookupUrl, { headers: { 'x-internal-cron-token': internalToken } });
      if (lres.ok) {
        const ldata = await lres.json();
        if (ldata.ok && ldata.found) {
          console.log('内部 lookup 获取已有域:', ldata.domain);
          return ldata.domain;
        } else if (opts.verbose) {
          console.log('内部 lookup 未找到或失败:', ldata);
        }
      } else if (opts.verbose) {
        console.log('内部 lookup HTTP', lres.status);
      }
    } catch (e) {
      if (opts.verbose) console.log('内部 lookup 异常:', e.message);
    }
    process.exit(1);
  }
  return data.data;
}

async function triggerVerify() {
  const limit = opts.limit || 20;
  const url = base.replace(/\/$/, '') + `/api/internal/domains/verify?limit=${encodeURIComponent(limit)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'x-internal-cron-token': internalToken }
  });
  if (!res.ok) {
    console.error('触发验证失败: HTTP', res.status, await res.text());
    process.exit(1);
  }
  return await res.json();
}

async function recoverDomain() {
  const url = base.replace(/\/$/, '') + '/api/internal/domains/recover';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'x-internal-cron-token': internalToken, 'content-type': 'application/json' },
    body: JSON.stringify({ hostname: opts.hostname, refresh: true })
  });
  if (!res.ok) {
    console.error('恢复失败: HTTP', res.status, await res.text());
    process.exit(1);
  }
  return await res.json();
}

function summarize(domains) {
  if (!domains) return '无权限或无法获取列表';
  const byStatus = domains.reduce((acc, d) => { acc[d.status] = (acc[d.status] || 0) + 1; return acc; }, {});
  return Object.entries(byStatus).map(([k,v]) => `${k}:${v}`).join(', ');
}

(async () => {
  if (opts.verbose) {
    console.log('[config] base =', base);
  }
  const beforeList = await listDomains();
  if (opts.verbose) console.log('验证前状态汇总:', summarize(beforeList));

  let domain = null;
  if (opts.recover) {
    console.log('== 尝试恢复域状态 ==');
    const r = await recoverDomain();
    if (!r.ok) {
      console.error('恢复失败:', r);
      process.exit(1);
    }
    console.log('恢复结果:', r.domain.status, 'sslStatus=', r.domain.sslStatus, 'lastError=', r.domain.lastError);
  }
  if (!opts.noCreate) {
    console.log('== 创建域 (pending_dns) ==');
    domain = await createDomain();
    if (domain) {
      console.log('创建/获取域成功:', domain.hostname, 'status=', domain.status);
      console.log('\n请确保 DNS 已配置:');
      console.log(`  ${domain.hostname}  CNAME  ${process.env.PLATFORM_CNAME_TARGET || 'sites.repoinsight.com'}`);
    }
  } else {
    console.log('跳过创建 (--no-create)');
  }
  console.log('\n== 触发内部验证 ==');
  const result = await triggerVerify();
  console.log('验证执行结果:', JSON.stringify(result, null, 2));

  const afterList = await listDomains();
  if (opts.verbose) console.log('验证后状态汇总:', summarize(afterList));

  if (domain && domain.status === 'pending_dns') {
    console.log('\n若仍是 pending_dns：确认 CNAME 已在公共 DNS 生效并稍后再运行。');
  }
})();
