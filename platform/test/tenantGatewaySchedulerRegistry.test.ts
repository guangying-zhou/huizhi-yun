import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { RowDataPacket } from 'mysql2/promise'
import { listTenantGatewaySchedulerPageWithQueries } from '../server/utils/tenantGatewaySchedulerRegistry.ts'

const root = fileURLToPath(new URL('..', import.meta.url))

function rows(offset: number, limit: number) {
  const all = [
    { id: 1, tenant_code: 'tenant-a', environment: 'prod', public_url: 'https://a.huizhi.yun', app_codes: 'aims,console,finance,people,workflow' },
    { id: 2, tenant_code: 'tenant-b', environment: 'prod', public_url: 'https://b.huizhi.yun', app_codes: 'altoc' },
    { id: 3, tenant_code: 'tenant-c', environment: 'prod', public_url: 'https://c.huizhi.yun', app_codes: 'aims,altoc' },
    { id: 4, tenant_code: 'tenant-d', environment: 'prod', public_url: 'https://d.huizhi.yun', app_codes: 'aims' }
  ]
  return all.slice(offset, offset + limit) as unknown as RowDataPacket[]
}

function queries(sqlCalls: string[]) {
  return {
    async queryRows<T extends RowDataPacket[]>(sql: string, params: unknown[] = []) {
      sqlCalls.push(sql)
      if (sql.includes('COUNT(*)')) return [{ total: 4 }] as unknown as T
      const limit = Number(params.at(-2))
      const offset = Number(params.at(-1))
      return rows(offset, limit) as T
    }
  }
}

describe('tenant gateway scheduler registry', () => {
  test('rotates a bounded shard window and carries an opaque bound cursor', async () => {
    const sql: string[] = []
    const input = { slot: 4, shardIndex: 0, shardCount: 4, limit: 2, windowSize: 3 }
    const first = await listTenantGatewaySchedulerPageWithQueries(queries(sql), input)
    assert.deepEqual(first.items.map(item => item.tenantCode), ['tenant-d', 'tenant-a'])
    assert.deepEqual(first.items[1]?.appCodes, ['aims', 'console', 'finance', 'people', 'workflow'])
    assert.ok(first.nextCursor)

    const second = await listTenantGatewaySchedulerPageWithQueries(queries(sql), { ...input, cursor: first.nextCursor! })
    assert.deepEqual(second.items.map(item => item.tenantCode), ['tenant-b'])
    assert.equal(second.nextCursor, null)
    assert.match(sql.join('\n'), /t\.status = 'active'/)
    assert.match(sql.join('\n'), /eligible\.app_code IN \('aims', 'altoc', 'console', 'finance', 'people', 'workflow'\)/)
    assert.doesNotMatch(JSON.stringify({ first, second }), /token|runtime|secret/i)
  })

  test('rejects cursors replayed into another slot or shard', async () => {
    const input = { slot: 0, shardIndex: 0, shardCount: 4, limit: 1, windowSize: 2 }
    const first = await listTenantGatewaySchedulerPageWithQueries(queries([]), input)
    await assert.rejects(
      () => listTenantGatewaySchedulerPageWithQueries(queries([]), { ...input, slot: 1, cursor: first.nextCursor! }),
      /cursor does not match/
    )
  })

  test('scheduler page remains under Platform internal-token middleware', () => {
    const middleware = readFileSync(`${root}/server/middleware/platform-access.ts`, 'utf8')
    const route = readFileSync(`${root}/server/api/platform/internal/tenant-gateway/scheduler-page.get.ts`, 'utf8')
    assert.match(middleware, /path\.startsWith\(INTERNAL_PREFIX\)/)
    assert.match(middleware, /HZY_CLOUDFLARE_INTERNAL_TOKEN/)
    assert.match(route, /windowSize/)
    assert.doesNotMatch(route, /staticToken|runtime_endpoint|secret_value/)
  })
})

// 走查 ISSUE-B-025：Tenant Gateway 定时 drain 的唤醒清单同时在两个仓库位置维护——
// 本文件的 SCHEDULER_APP_CODES，与 deploy/cloudflare/tenant-gateway 的
// SCHEDULER_APPS。网关取的是两者的**交集**（scheduler registry 上报的 appCodes
// ∩ SCHEDULER_APPS），因此任何一侧漏掉某个应用，它就永远不会被唤醒，而且不会
// 报任何错——finance 加进网关后仍然零唤醒，就是因为本侧没同步。
//
// 网关侧另有对应断言：被唤醒的应用必须同时具备 SCHEDULER_APPS 条目、
// APP_SERVICE_BINDINGS 映射与 wrangler.jsonc 声明。两侧合起来锁住整条链。
describe('scheduler app list stays in sync with the tenant gateway', () => {
  test('platform registry and gateway SCHEDULER_APPS declare the same apps', () => {
    const registry = readFileSync(
      new URL('../server/utils/tenantGatewaySchedulerRegistry.ts', import.meta.url), 'utf8')
    const gateway = readFileSync(
      new URL('../../deploy/cloudflare/tenant-gateway/src/index.js', import.meta.url), 'utf8')

    const registryMatch = registry.match(/const SCHEDULER_APP_CODES = new Set\(\[([^\]]*)\]\)/)
    const gatewayMatch = gateway.match(/const SCHEDULER_APPS = new Set\(\[([^\]]*)\]\)/)
    assert.ok(registryMatch, 'platform SCHEDULER_APP_CODES declaration must be present')
    assert.ok(gatewayMatch, 'gateway SCHEDULER_APPS declaration must be present')

    const parse = (value: string) => [...value.matchAll(/'([a-z-]+)'/g)].map(item => item[1]).sort()
    assert.deepEqual(
      parse(registryMatch[1]),
      parse(gatewayMatch[1]),
      'platform scheduler registry and gateway SCHEDULER_APPS must list the same apps; '
      + 'the gateway wakes only their intersection, so a mismatch silently disables drain for that app'
    )
  })

  test('the SQL app filter is derived from the constant instead of hand-written', () => {
    const registry = readFileSync(
      new URL('../server/utils/tenantGatewaySchedulerRegistry.ts', import.meta.url), 'utf8')
    assert.doesNotMatch(
      registry,
      /app_code IN \('[a-z]/,
      'SQL app filters must interpolate SCHEDULER_APP_CODE_SQL_LIST, not repeat the list literally'
    )
    assert.match(registry, /app_code IN \(\$\{SCHEDULER_APP_CODE_SQL_LIST\}\)/)
  })
})
