import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const compiled = ts.transpileModule(readFileSync(new URL('../server/api/v1/console/notification-runtime/wecom-test.post.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
}).outputText

function load(failure: unknown, publicationFailure = false) {
  const captured: unknown[] = []
  const dependencies: Record<string, unknown> = {
    'node:crypto': { createHash },
    'h3': { readBody: async () => ({ touser: 'fixture-user', requestKey: 'fixture-request-key' }), createError: (input: Record<string, unknown>) => Object.assign(new Error(String(input.message)), input) },
    '~~/server/utils/directoryRuntime': { ok: (value: unknown) => value },
    '~~/server/utils/integrationAccess': { requireIntegrationAccess: async () => ({ actorId: 'fixture-user' }) },
    '~~/server/utils/integrations': { sendWecomIntegrationTestMessage: async () => { throw failure } },
    '~~/server/utils/notifications': {
      publishPortalNotification: async (value: unknown) => {
        captured.push(value)
        if (publicationFailure) throw failure
        return { notificationId: 'fixture-notification' }
      },
      recordPortalNotificationDelivery: async (value: unknown) => { captured.push(value) }
    }
  }
  const exports: { default?: (event: unknown) => Promise<unknown> } = {}
  new Function('require', 'exports', 'defineEventHandler', 'console', compiled)(
    (name: string) => dependencies[name], exports, (handler: unknown) => handler,
    { warn: (...args: unknown[]) => captured.push(args) })
  return { run: exports.default!, captured }
}

test('provider error text never enters notification, delivery or HTTP error', async () => {
  for (const failure of [new Error('Bearer fixture-secret https://fixture.invalid/?token=fixture-token'), 'password=fixture-password', { message: 'Cookie fixture-cookie' }]) {
    const { run, captured } = load(failure)
    await assert.rejects(run({}), (error: unknown) => {
      assert.equal((error as { statusCode: number }).statusCode, 502)
      assert.equal((error as Error).message, '企业微信测试发送失败，请检查集成配置后重试。')
      return true
    })
    assert.equal(captured.length, 2)
    const serialized = JSON.stringify(captured)
    assert.doesNotMatch(serialized, /fixture-secret|fixture-token|fixture-password|fixture-cookie|fixture\.invalid/)
    assert.match(serialized, /企业微信测试发送失败/)
  }
})

test('known HTTP failure preserves status but not provider payload', async () => {
  const { run, captured } = load(Object.assign(new Error('secret=fixture-secret'), { statusCode: 503 }))
  await assert.rejects(run({}), { statusCode: 503 })
  assert.doesNotMatch(JSON.stringify(captured), /fixture-secret/)
})

test('failure while publishing result logs only a fixed machine category', async () => {
  const { run, captured } = load(new Error('token=fixture-secret'), true)
  await assert.rejects(run({}), { statusCode: 502 })
  assert.doesNotMatch(JSON.stringify(captured), /fixture-secret/)
  assert.match(JSON.stringify(captured), /wecom_test_result_record_failed/)
})
