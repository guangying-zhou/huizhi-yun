import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
type Deployment = { id: number, app_code: string, tenant_code: string, environment: string, status: string, deployment_code: string }
type Binding = { deployment_id: number, app_code: string, status: string, schema_status: string, last_error_code: string | null }

function harness() {
  const deployments: Deployment[] = []
  const bindings = new Map<string, Binding>()
  const statements: Array<{ sql: string, params: unknown[] }> = []
  const instance = {
    id: 10, runtime_code: 'fixture-runtime', tenant_code: 'FIXTURE', environment: 'prod',
    release_update_mode: 'pinned', desired_version: '1.0.0', release_signing_key_id: 'fixture-key',
    control_token_hash: require('node:crypto').createHash('sha256').update('hzy_ctl_fixture').digest('hex'),
    runtime_endpoint: 'http://127.0.0.1:23130'
  }
  const bindingOnly = (app: string) => ['console', 'enterprise', 'collab'].includes(app)
  function active(params: unknown[]) {
    assert.match(statements.at(-1)!.sql, /tenant_code = \? AND environment = \?/)
    assert.match(statements.at(-1)!.sql, /status = 'active'/)
    return deployments.filter(d => d.tenant_code === params[0] && d.environment === params[1]
      && d.status === 'active' && params.slice(2).includes(d.app_code))
  }
  function upsert(d: Deployment, status: string, schema: string) {
    const previous = bindings.get(d.app_code)
    bindings.set(d.app_code, {
      deployment_id: d.id, app_code: d.app_code,
      status: previous && !bindingOnly(d.app_code) ? previous.status : status,
      schema_status: previous && !bindingOnly(d.app_code) ? previous.schema_status : schema,
      last_error_code: bindingOnly(d.app_code) ? null : previous?.last_error_code ?? null
    })
  }
  const tx = {
    async queryRow(sql: string, params: unknown[]) {
      statements.push({ sql, params })
      assert.match(sql, /FROM tenant_runtime_instances/)
      return instance
    },
    async queryRows(sql: string, params: unknown[]) {
      statements.push({ sql, params })
      if (sql.includes('FROM deployments\n')) return active(params)
      assert.match(sql, /d\.status = 'active'.*d\.tenant_code = \?.*d\.environment = \?/s)
      assert.deepEqual(Array.from(params), [instance.id, instance.tenant_code, instance.environment])
      return [...bindings.values()].flatMap((b) => {
        const d = deployments.find(d => d.id === b.deployment_id && d.status === 'active'
          && d.tenant_code === params[1] && d.environment === params[2])
        return d ? [{ ...b, deployment_code: d.deployment_code }] : []
      })
    },
    async execute(sql: string, params: unknown[]) {
      statements.push({ sql, params })
      if (sql.includes('INSERT INTO tenant_runtime_instance_apps')) {
        if (sql.includes('SELECT ?, d.id')) {
          assert.match(sql, /MAX\(id\)/)
          assert.match(sql, /WHEN d\.app_code IN \('enterprise', 'collab'\) THEN 'active'/)
          assert.match(sql, /WHEN VALUES\(app_code\) IN \('console', 'enterprise', 'collab'\) THEN NULL/)
          const latest = new Map<string, Deployment>()
          for (const d of active(params.slice(1))) {
            if (!latest.has(d.app_code) || latest.get(d.app_code)!.id < d.id) latest.set(d.app_code, d)
          }
          for (const d of latest.values()) upsert(d, d.app_code === 'console' ? 'schema_ready' : bindingOnly(d.app_code) ? 'active' : 'pending', bindingOnly(d.app_code) ? 'not_applicable' : 'unknown')
        } else {
          const d = deployments.find(d => d.id === params[1])!
          upsert(d, String(params[3]), String(params[4]))
        }
      } else if (sql.includes('UPDATE tenant_runtime_instance_apps')) {
        if (sql.includes('NOT IN')) {
          assert.match(sql, /NOT IN \('console', 'enterprise', 'collab'\)/)
          for (const b of bindings.values()) if (!bindingOnly(b.app_code)) Object.assign(b, { status: params[0], schema_status: params[1], last_error_code: params[2] })
        } else {
          const app = String(params[4])
          assert.equal(bindingOnly(app), false, 'binding-only identities never enter schema loop')
          const b = bindings.get(app)
          if (b) Object.assign(b, { status: params[0], schema_status: params[1], last_error_code: params[2] })
        }
      }
      return { affectedRows: 1 }
    }
  }
  const dependencies: Record<string, unknown> = {
    '~~/server/utils/db': { withTransaction: (fn: (tx: object) => unknown) => fn(tx) },
    '~~/server/utils/dataRuntimeRelease': {},
    '~~/server/utils/platformSigning': { exportPubkey: async () => ({ kid: 'fixture', alg: 'EdDSA', publicKey: 'synthetic-public-key' }) }
  }
  const releaseEnvironment = {
    requireRuntimeReleaseEnvironment: (value: string) => {
      assert.ok(['test', 'prod'].includes(value))
      return value
    },
    requireRuntimeReleaseUpdateMode: (value: string) => {
      assert.equal(value, 'pinned')
      return value
    }
  }
  dependencies['./runtimeReleaseEnvironment'] = releaseEnvironment
  dependencies['~~/server/utils/runtimeReleaseEnvironment'] = releaseEnvironment
  function load(path: string) {
    const exports: Record<string, unknown> = {}
    const { outputText } = ts.transpileModule(source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
    runInNewContext(outputText, {
      exports, Buffer, console: { warn() {} },
      require: (name: string) => dependencies[name] ?? require(name),
      defineEventHandler: (fn: unknown) => fn,
      readBody: async (event: { body: object }) => event.body,
      getHeader: (event: { authorization: string }) => event.authorization,
      setResponseHeader() {}, createError: (input: object) => Object.assign(new Error('fixture error'), input)
    })
    return exports
  }
  const enrollment = load('server/utils/tenantRuntimeEnrollment.ts') as {
    TENANT_RUNTIME_APPS: Array<{ appCode: string }>
    TENANT_RUNTIME_BINDING_APP_CODES: string[]
    issueTenantRuntimeEnrollment: (input: object) => Promise<{ enabledApps: string[], deploymentBindings: Record<string, string> }>
  }
  dependencies['~~/server/utils/tenantRuntimeEnrollment'] = enrollment
  const heartbeat = load('server/api/v1/runtime/agent-heartbeat.post.ts').default as (event: object) => Promise<{ data: { status: string, deploymentBindings: Record<string, string> } }>
  function add(app: string, options: Partial<Deployment> = {}) {
    deployments.push({ id: deployments.length + 1, app_code: app, tenant_code: 'FIXTURE', environment: 'prod', status: 'active', deployment_code: `fixture-${app}-${deployments.length + 1}`, ...options })
  }
  const send = (body: object = {}, authorization = 'Bearer hzy_ctl_fixture') => heartbeat({ authorization, body: {
    runtimeCode: instance.runtime_code, runtimeVersion: '1.0.0', releaseSigningKeyId: 'fixture-key', databaseStatus: 'passed', ...body
  } })
  return { add, deployments, bindings, statements, instance, enrollment, send }
}

test('Collab is an exact binding identity, never a schema adapter', () => {
  const h = harness()
  assert.equal(h.enrollment.TENANT_RUNTIME_BINDING_APP_CODES.filter(app => app === 'collab').length, 1)
  assert.deepEqual(Array.from(h.enrollment.TENANT_RUNTIME_APPS, app => app.appCode), ['aims', 'altoc', 'assets', 'codocs', 'finance', 'people', 'workflow', 'webdev'])
})

test('registration followed by heartbeat reconciles only active exact tenant/environment deployments idempotently', async () => {
  const h = harness()
  h.add('console')
  h.add('enterprise')
  h.add('aims')
  assert.equal((await h.send()).data.deploymentBindings.collab, undefined)
  h.add('collab', { tenant_code: 'OTHER' })
  h.add('collab', { environment: 'test' })
  h.add('collab', { status: 'disabled' })
  assert.equal((await h.send()).data.deploymentBindings.collab, undefined)
  h.add('collab')
  h.add('collab')
  const result = await h.send({ tenantCode: 'OTHER', environment: 'test', deploymentCode: 'forged', apps: { collab: { enabled: false, schemaStatus: 'failed' }, aims: { enabled: true, schemaStatus: 'ok' } } })
  assert.equal(result.data.deploymentBindings.collab, h.deployments.at(-1)!.deployment_code)
  assert.deepEqual(h.bindings.get('collab'), { deployment_id: 8, app_code: 'collab', status: 'active', schema_status: 'not_applicable', last_error_code: null })
  assert.equal(h.bindings.get('console')!.status, 'schema_ready')
  assert.equal(h.bindings.get('enterprise')!.status, 'active')
  assert.equal(h.bindings.get('aims')!.status, 'schema_ready')
  const snapshot = JSON.stringify([...h.bindings])
  await h.send({ apps: { aims: { enabled: true, schemaStatus: 'ok' } } })
  assert.equal(JSON.stringify([...h.bindings]), snapshot)
  assert.doesNotMatch(h.statements.map(s => s.sql).join('\n'), /(?:SET|INSERT INTO)[^;]*?(?:control_token_hash\s*=|runtime_token_hash\s*=|tenant_runtime_enrollments)/)
})

test('unhealthy heartbeat and stale schema report do not poison binding-only readiness or rotate credentials', async () => {
  const h = harness()
  h.add('collab')
  h.add('aims')
  const hash = h.instance.control_token_hash
  const result = await h.send({ databaseStatus: 'failed', apps: { collab: { enabled: true, schemaStatus: 'failed' } } })
  assert.equal(result.data.status, 'unhealthy')
  assert.equal(h.bindings.get('collab')!.status, 'active')
  assert.equal(h.bindings.get('collab')!.schema_status, 'not_applicable')
  assert.equal(h.bindings.get('aims')!.status, 'blocked')
  assert.equal(h.instance.control_token_hash, hash)
  await assert.rejects(h.send({}, 'Bearer hzy_ctl_wrong'), { statusCode: 401 })
})

test('enrollment initializes Collab/Enterprise without exposing them as business adapters and preserves existing business readiness', async () => {
  const h = harness()
  h.add('console')
  h.add('enterprise')
  h.add('collab')
  h.add('aims')
  h.add('collab', { tenant_code: 'OTHER' })
  h.add('collab', { environment: 'test' })
  h.add('collab', { status: 'disabled' })
  h.bindings.set('aims', { deployment_id: 4, app_code: 'aims', status: 'schema_ready', schema_status: 'ok', last_error_code: null })
  const result = await h.enrollment.issueTenantRuntimeEnrollment({ tenantCode: 'FIXTURE', environment: 'prod', desiredVersion: '1.0.0', releaseSigningKeyId: 'fixture-key', ttlSeconds: 300 })
  assert.deepEqual(Array.from(result.enabledApps), ['aims'])
  assert.equal(result.deploymentBindings.collab, 'fixture-collab-3')
  for (const app of ['enterprise', 'collab']) {
    assert.equal(h.bindings.get(app)!.status, 'active')
    assert.equal(h.bindings.get(app)!.schema_status, 'not_applicable')
  }
  assert.equal(h.bindings.get('console')!.status, 'schema_ready')
  assert.equal(h.bindings.get('aims')!.status, 'schema_ready')
  assert.equal(h.bindings.get('aims')!.schema_status, 'ok')
})

test('binding readback excludes a disabled deployment and does not reuse cross-tenant/environment bindings', async () => {
  const h = harness()
  h.add('collab')
  await h.send()
  h.deployments[0]!.status = 'disabled'
  assert.equal((await h.send()).data.deploymentBindings.collab, undefined)
  for (const options of [{ tenant_code: 'OTHER' }, { environment: 'test' }]) {
    h.add('collab', options)
    h.bindings.get('collab')!.deployment_id = h.deployments.at(-1)!.id
    assert.equal((await h.send()).data.deploymentBindings.collab, undefined)
  }
  for (const statement of h.statements) {
    if (/^\s*(?:INSERT|UPDATE)/.test(statement.sql)) {
      assert.doesNotMatch(statement.sql, /control_token_hash|runtime_token_hash|tenant_runtime_enrollments/)
    }
  }
})
