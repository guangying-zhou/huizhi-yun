import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import ts from 'typescript'

type Row = Record<string, unknown>
const code = ts.transpileModule(readFileSync(new URL('../server/api/reviews/publish-requests/[id]/workflow-instance.post.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

function harness(options: { unavailableRoute?: boolean, failure?: Error, bound?: boolean } = {}) {
  const event = { context: { tenant: 'tenant-1' } }
  const operation = { idempotencyKey: 'publish-request:42', command: { actorUid: 'U001' } }
  const forwarded = {
    'x-hzy-tenant': 'tenant-1', 'x-hzy-app-code': 'workflow',
    'x-hzy-deployment': 'workflow-deploy', 'x-forwarded-prefix': '/workflow',
    'x-hzy-gateway-token': 'test-gateway-context'
  }
  const runtimeCalls: string[] = []
  const serviceCalls: Row[] = []
  let receiptValidated = false
  const dependencies: Record<string, Row> = {
    'h3': { getRouterParam: (input: unknown, key: string) => {
      assert.equal(input, event)
      assert.equal(key, 'id')
      return '42'
    } },
    '@hzy/foundation/server/utils/serviceAppUrl': {
      resolveServiceAppBaseUrl: (input: unknown, app: string, config: Row) => {
        assert.equal(input, event)
        assert.equal(app, 'workflow')
        assert.equal(config.directTarget, true)
        return options.unavailableRoute ? '' : 'https://workflow.internal/workflow'
      }
    },
    '@hzy/foundation/server/utils/serviceOidc': {
      trustedServiceRequestHeaders: (input: unknown, app: string) => {
        assert.equal(input, event)
        assert.equal(app, 'workflow')
        return forwarded
      },
      requestWithServiceAccessToken: (input: { audience: string, scope: string, event: unknown, request: (token: string) => Promise<unknown> }) => {
        assert.equal(input.audience, 'workflow')
        assert.equal(input.scope, 'workflow:document-publish:create')
        assert.equal(input.event, event)
        return input.request('test-service-token')
      }
    },
    '@hzy/foundation/server/utils/appServiceBinding': {
      serviceAppFetch: async (input: unknown, app: string, url: string, request: Row) => {
        assert.equal(input, event)
        assert.equal(app, 'workflow')
        serviceCalls.push({ url, ...request })
        if (options.failure) throw options.failure
        return { data: { result: { instance: { instance_id: 71, instance_no: 'WF-71' } } } }
      }
    },
    '@hzy/foundation/server/utils/serviceOperation': {
      buildServiceCommandEnvelope: (input: unknown) => {
        assert.equal(input, operation)
        return { serviceCommand: input }
      },
      validateServiceCommandReceipt: (input: unknown, _receipt: unknown, target: Row) => {
        assert.equal(input, operation)
        assert.equal(target.targetBizCode, 'WF-71')
        receiptValidated = true
        return { idempotent: false }
      }
    },
    '~~/server/utils/authIdentity': { requireRequestUid: () => 'U001' },
    '~~/server/utils/checkPermission': { requirePermission: async (_event: unknown, resource: string, action: string) => {
      assert.equal(resource, 'reviews')
      assert.equal(action, 'submit')
    } },
    '~~/server/utils/codocsRuntime': {
      callCodocsTenantRuntime: async (_event: unknown, path: string) => {
        runtimeCalls.push(path)
        if (path.endsWith('/workflow-command')) return options.bound ? { bound: true, workflowInstanceId: 71 } : { serviceCommand: operation }
        assert.equal(receiptValidated, true, 'checkpoint must follow verified receipt')
        return { workflowInstanceId: 71 }
      }
    }
  }
  const exports: { default?: (event: unknown) => Promise<unknown> } = {}
  runInNewContext(code, {
    exports,
    require: (id: string) => {
      assert.ok(dependencies[id], `unexpected dependency ${id}`)
      return dependencies[id]
    },
    defineEventHandler: (handler: unknown) => handler,
    createError: (data: { message: string, statusCode: number }) => Object.assign(new Error(data.message), data)
  })
  return { run: () => exports.default!(event), serviceCalls, runtimeCalls, operation, forwarded }
}

test('publish approval uses the target Workflow transport and preserves trusted context and command identity', async () => {
  const h = harness()
  await h.run()
  assert.equal(h.serviceCalls.length, 1)
  const request = h.serviceCalls[0]!
  assert.equal(request.url, 'https://workflow.internal/workflow/api/v1/service/codocs-publish-approval')
  assert.equal(request.method, 'POST')
  assert.deepEqual({ ...request.headers as Row }, {
    ...h.forwarded, 'authorization': 'Bearer test-service-token', 'content-type': 'application/json',
    'idempotency-key': h.operation.idempotencyKey, 'x-hzy-actor-uid': 'U001'
  })
  assert.equal((request.body as Row).serviceCommand, h.operation)
  assert.equal(h.runtimeCalls.at(-1), '/v1/codocs/reviews/publish-requests/42/workflow-checkpoint')
})

test('missing trusted target route fails closed before sending the command', async () => {
  const h = harness({ unavailableRoute: true })
  await assert.rejects(h.run(), { statusCode: 503 })
  assert.equal(h.serviceCalls.length, 0)
  assert.equal(h.runtimeCalls.length, 1)
})

test('Workflow failure leaves the binding uncheckpointed for an idempotent retry', async () => {
  const failure = Object.assign(new Error('Workflow unavailable'), { statusCode: 503 })
  const h = harness({ failure })
  await assert.rejects(h.run(), error => error === failure)
  assert.equal(h.runtimeCalls.length, 1)
})

test('an already-bound publish request does not create another Workflow instance', async () => {
  const h = harness({ bound: true })
  await h.run()
  assert.equal(h.serviceCalls.length, 0)
  assert.equal(h.runtimeCalls.length, 1)
})
