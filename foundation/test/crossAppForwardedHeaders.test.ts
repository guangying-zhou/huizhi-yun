import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  crossAppForwardedHeaders,
  crossAppForwardedHeaderNames
} from '../server/utils/crossAppForwardedHeaders.ts'

// 走查 ISSUE-B-025：altoc / finance 曾散落 11 处各自实现的转发白名单，其中三处残缺
// （5 / 1 / 9 个 header，均不含 runtime 定位）。开票申请恰好走的是 5 个那条，
// 于是目标应用拿不到租户 runtime 地址与凭据，入站服务令牌 introspection 只能返回
// 503 service_token_introspection_unavailable，整条跨应用调用失败且症状笼统难查。
//
// 白名单必须集中一处，并禁止各模块再自建。

function eventWithHeaders(headers: Record<string, string>) {
  return {
    node: { req: { headers } },
    headers: new Headers(headers)
  } as never
}

describe('cross-app forwarded headers', () => {
  test('carries the tenant runtime locator, without which the target cannot introspect', () => {
    for (const name of [
      'x-hzy-tenant-runtime-url',
      'x-hzy-tenant-runtime-token',
      'x-hzy-tenant-runtime-audience',
      'x-hzy-data-runtime-url',
      'x-hzy-data-runtime-token',
      'x-hzy-data-runtime-audience',
      'x-hzy-data-runtime-code'
    ]) {
      assert.ok(
        crossAppForwardedHeaderNames.includes(name),
        `${name} must be forwarded; the target app needs it to reach the tenant runtime`
      )
    }
  })

  test('carries the trusted gateway identity and tenant context', () => {
    for (const name of ['x-hzy-gateway', 'x-hzy-gateway-token', 'x-hzy-tenant', 'x-hzy-deployment']) {
      assert.ok(crossAppForwardedHeaderNames.includes(name), `${name} must be forwarded`)
    }
  })

  test('never forwards x-hzy-app-code', () => {
    // 它表示当前应用；跨应用直达时必须由受信 route helper 改写成目标应用，
    // 原样透传会让目标端拿到错误的 app 上下文。
    assert.ok(!crossAppForwardedHeaderNames.includes('x-hzy-app-code'))
  })

  test('only forwards headers present on the request', () => {
    const headers = crossAppForwardedHeaders(eventWithHeaders({ 'x-hzy-tenant': 'C000001' }))
    assert.equal(headers['x-hzy-tenant'], 'C000001')
    assert.ok(!('x-hzy-gateway' in headers), 'absent headers must not be fabricated')
  })

  test('sets idempotency-key only when provided', () => {
    const withKey = crossAppForwardedHeaders(eventWithHeaders({}), { idempotencyKey: 'k-1' })
    assert.equal(withKey['idempotency-key'], 'k-1')
    assert.ok(!('idempotency-key' in crossAppForwardedHeaders(eventWithHeaders({}))))
    assert.ok(!('idempotency-key' in crossAppForwardedHeaders(eventWithHeaders({}), { idempotencyKey: '  ' })))
  })

  test('tolerates a null event so scheduled callers can still pass an idempotency key', () => {
    const headers = crossAppForwardedHeaders(null, { idempotencyKey: 'k-2' })
    assert.deepEqual(headers, { 'idempotency-key': 'k-2' })
  })
})

// —— 防复发守卫 ——
// 扫描业务模块，禁止任何地方重新出现自建的跨应用转发白名单。

function walk(dir: string, out: string[] = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (full.endsWith('.ts')) out.push(full)
  }
  return out
}

describe('no module may rebuild its own forwarding allowlist', () => {
  test('business modules forward cross-app context through the shared helper only', () => {
    const repoRoot = resolve(import.meta.dirname, '..', '..')
    const offenders: string[] = []

    for (const moduleName of ['altoc', 'finance']) {
      const serverDir = join(repoRoot, moduleName, 'server')
      let files: string[]
      try {
        files = walk(serverDir)
      } catch {
        continue
      }
      for (const file of files) {
        const source = readFileSync(file, 'utf8')
        // 自建白名单的特征：同一文件里把多个受信 header 名硬编码成字面量数组
        const runtimeLocators = (source.match(/'x-hzy-(?:tenant|data)-runtime-[a-z-]+'/g) || []).length
        const gatewayNames = (source.match(/'x-hzy-gateway(?:-token)?'/g) || []).length
        if (runtimeLocators + gatewayNames >= 3 && !file.endsWith('crossAppForwardedHeaders.ts')) {
          offenders.push(file.slice(repoRoot.length + 1))
        }
      }
    }

    assert.deepEqual(
      offenders,
      [],
      'these files hardcode a trusted-header allowlist; use crossAppForwardedHeaders() instead — '
      + 'a partial allowlist makes the target app fail with an opaque 503'
    )
  })
})
