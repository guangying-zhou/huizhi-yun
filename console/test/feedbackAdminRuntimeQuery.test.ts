import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

test('administrator list carries normalized page in fixed POST body without inheriting browser query', async () => {
  const source = readFileSync(new URL('../server/utils/feedbackAdmin.ts', import.meta.url), 'utf8')
  const compiled = ts.transpile(source.replace(/^import .*\n/gm, '').replace('export async function', 'async function'), { target: ts.ScriptTarget.ES2022 })
  const body = { payload: JSON.stringify({ page: 2 }), authorization: { operation: 'admin-list' } }
  const calls: unknown[][] = []
  const event = { path: '/console/api/v1/console/feedback', query: { page: '2' } }
  const run = new Function('createError', 'callConsoleTenantRuntime', 'feedbackPermission', 'loadPlatformRuntimeConfig', 'executeFeedbackRequest', 'requireConsoleRequestUid', 'loadPolicyScopedAuthorization', 'evaluateWithRevisionCheckedConsoleServicePolicy', `${compiled}; return consoleFeedback`)(
    (input: unknown) => input,
    async (...args: unknown[]) => {
      calls.push(args)
      return { data: { items: [], total: 0 } }
    },
    () => ({ resource: 'feedback', action: 'view' }),
    () => ({ tenantCode: 'C000001', deploymentCode: 'fixture-console' }),
    async (_event: unknown, _op: string, deps: { call: (body: unknown) => Promise<unknown> }) => deps.call(body),
    async () => 'fixture-user',
    async () => ({}),
    async (_event: unknown, _tenant: string, evaluate: () => Promise<unknown>) => evaluate()
  )
  await run(event, 'admin-list')
  assert.deepEqual(calls, [[event, '/v1/console/feedback:admin-list', { method: 'POST', query: {}, scope: 'console:feedback:view', body, idempotencyKey: undefined }]])
})
