import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID, sign as signBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { decodeJwt, exportJWK, exportSPKI, generateKeyPair, SignJWT } from 'jose'
import mysql from 'mysql2/promise'
import { buildServiceCommandEnvelope, validateServiceCommandReceipt } from '../../foundation/server/utils/serviceOperation.ts'
import { executeServiceTokenRequest } from '../../foundation/server/utils/serviceTokenRequest.ts'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from './support/temporary-mysql-harness.mjs'
import { buildLocalProcessGroupPlan, withLocalProcessGroup } from './support/local-process-group-supervisor.mjs'

const ROOT = resolve(import.meta.dirname, '../..')
const executeFile = promisify(execFile)
const RUN = process.env.HZY_RUN_G3_MYSQL_VERTICAL === '1'
const TENANT = 'g3-local-tenant'
const SOURCE_DEPLOYMENT = 'g3-aims-source'
const TARGET_DEPLOYMENT = 'g3-altoc-target'
const CLIENT_ID = 'g3-aims-runtime'
const OPERATION_CODE = 'aims.work-item.ticket-result.v1'
const CAPABILITY = 'altoc:service-ticket:delivery-result:sync'

async function reservePort() {
  const server = createNetServer()
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => resolveListen())
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
  if (!port) throw new Error('failed to reserve loopback port')
  return port
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

function operation(ticketCode: string, generation: number) {
  const operationKey = `aims:work-item:WI-${generation}:ticket-result:g1:v1`
  const command = {
    aimsProjectCode: 'PRJ-G3',
    deliveryGeneration: 1,
    deliveryStatus: 'processing',
    quotaConsumed: 0,
    ticketCode,
    workItemKey: `WI-${generation}`,
    workItemStatus: 'in_progress',
    workItemType: 'task'
  }
  return {
    operationId: randomUUID(), operationKey, command,
    commandSha256: sha256(stable(command))
  }
}

async function issueToken(consoleUrl: string, clientSecret: string) {
  const response = await fetch(`${consoleUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: clientSecret,
      audience: 'altoc', scope: CAPABILITY
    })
  })
  const body = await response.json() as Record<string, unknown>
  assert.equal(response.status, 200, JSON.stringify(body))
  assert.equal(body.token_type, 'Bearer')
  const token = String(body.access_token)
  const claims = decodeJwt(token)
  assert.equal(claims.tenant, TENANT)
  assert.equal(claims.deployment, SOURCE_DEPLOYMENT)
  assert.equal(claims.source_app, 'aims')
  assert.equal(claims.target_app, 'altoc')
  assert.equal(claims.client_id, CLIENT_ID)
  return token
}

async function startPlatformProfileStub(port: number, runtimeToken: string) {
  const expectedPath = `/api/v1/runtime/tenants/${encodeURIComponent(TENANT)}/profile`
  const server = createHttpServer((request, response) => {
    const url = new URL(request.url || '/', `http://127.0.0.1:${port}`)
    if (request.method !== 'GET' || url.pathname !== expectedPath || request.headers.authorization !== `Bearer ${runtimeToken}`) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      code: 0,
      data: {
        tenantCode: TENANT,
        tenantName: 'G3 Local Tenant',
        status: 'active',
        orgProfile: { orgName: 'G3 Local Tenant' }
      }
    }))
  })
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolveListen)
  })
  return async () => await new Promise<void>((resolveClose, reject) => {
    server.close(error => error ? reject(error) : resolveClose())
  })
}

async function postJson(url: string, token: string, body: unknown, requestId: string) {
  return await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': requestId,
      'x-request-id': requestId
    },
    body: JSON.stringify(body)
  })
}

async function runtimePost(baseUrl: string, staticToken: string, path: string, body: unknown, requestId: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${staticToken}`, 'content-type': 'application/json', 'x-request-id': requestId },
    body: JSON.stringify(body)
  })
  const payload = await response.json() as Record<string, unknown>
  assert.equal(response.status, 200, JSON.stringify(payload))
  assert.equal(String(payload.code ?? 0), '0', JSON.stringify(payload))
  return (payload.data ?? payload) as Record<string, unknown>
}

async function seedDatabases(context: any, fixture: {
  clientSecret: string
  privateJwk: Record<string, unknown>
  publicJwk: Record<string, unknown>
  operations: ReturnType<typeof operation>[]
}) {
  const consoleDb = await mysql.createConnection(context.connection('console'))
  const aimsDb = await mysql.createConnection(context.connection('aims'))
  const altocDb = await mysql.createConnection(context.connection('altoc'))
  try {
    await consoleDb.execute(`INSERT INTO auth_signing_keys (id,kid,alg,use_type,public_jwk_json,private_key_ref,status) VALUES (1,'g3-local-key','EdDSA','sig',?,'env:CONSOLE_AUTH_SIGNING_PRIVATE_JWK','current')`, [JSON.stringify(fixture.publicJwk)])
    await consoleDb.execute(`INSERT INTO vault_secrets (id,secret_code,secret_ref,secret_name,secret_type,usage_type,owner_type,storage_backend,reveal_policy,status) VALUES (1,'g3-aims-secret','hzybase://vault/g3-aims-secret','G3 Aims Secret','client_secret','service','service_client','env_ref','deny','active')`)
    await consoleDb.execute(`INSERT INTO vault_secret_versions (id,secret_id,version_no,backend_secret_ref,content_hash,encryption_scheme,status) VALUES (1,1,1,'HZY_G3_AIMS_CLIENT_SECRET',?,'external-ref','active')`, [`sha256_${sha256(fixture.clientSecret)}`])
    await consoleDb.execute(`UPDATE vault_secrets SET current_version_id=1 WHERE id=1`)
    await consoleDb.execute(`INSERT INTO service_clients (id,client_code,client_name,client_type,app_code,status) VALUES (1,'aims.runtime','G3 Aims Runtime','app','aims','active')`)
    await consoleDb.execute(`INSERT INTO service_client_credentials (id,service_client_id,client_id,version_no,secret_id,status) VALUES (1,1,?,1,1,'active')`, [CLIENT_ID])
    await consoleDb.execute(`UPDATE service_clients SET current_credential_id=1 WHERE id=1`)
    await consoleDb.execute(`INSERT INTO service_client_grants (id,service_client_id,resource_code,action,status) VALUES (1,1,'altoc:service-ticket:delivery-result','sync','active')`)

    for (const item of fixture.operations) {
      await aimsDb.execute(`INSERT INTO integration_operation (operation_id,operation_key,correlation_key,tenant_code,deployment_code,source_app,target_app,operation_code,required_capability,source_biz_type,source_biz_code,idempotency_key,command_schema_version,command_json,command_sha256,status,original_request_id,service_client_id,created_by,updated_by) VALUES (?,?,?,? ,?,'aims','altoc',?,?,'work_item',?,?,'v1',?,?, 'pending','g3-seed','aims.runtime','g3-seed','g3-seed')`, [item.operationId, item.operationKey, item.operationKey, TENANT, SOURCE_DEPLOYMENT, OPERATION_CODE, CAPABILITY, String(item.command.workItemKey), item.operationKey, JSON.stringify(item.command), item.commandSha256])
    }
    const [customerResult] = await altocDb.execute<mysql.ResultSetHeader>(`INSERT INTO customer (code,name,status,owner_user_id) VALUES ('CU-G3','G3 Customer','active','u-g3')`)
    const customerId = customerResult.insertId
    for (const item of fixture.operations) {
      await altocDb.execute(`INSERT INTO service_ticket (code,customer_id,ticket_type,title,status,owner_user_id,aims_project_code,aims_work_item_key) VALUES (?,?,'incident',?,'accepted','u-g3','PRJ-G3',?)`, [item.command.ticketCode, customerId, `G3 ${item.command.ticketCode}`, item.command.workItemKey])
    }
  } finally {
    await Promise.all([consoleDb.end(), aimsDb.end(), altocDb.end()])
  }
}

test('real Console service JWT drives source operation through target receipt and separates inactive/503 outcomes', { skip: !RUN, timeout: 180_000 }, async (t) => {
  const work = await mkdtemp(join(tmpdir(), 'hzy-g3-jwt-vertical-'))
  t.after(() => rm(work, { recursive: true, force: true }))
  const runtimeBinary = join(work, 'hzy-data-runtime')
  await executeFile('go', ['build', '-o', runtimeBinary, './cmd/hzy-data-runtime'], { cwd: join(ROOT, 'data-runtime'), timeout: 60_000 })
  await chmod(runtimeBinary, 0o700)

  const mysqlPlan = await buildTemporaryMySqlPlan({
    rootDir: ROOT,
    mysqld: '/opt/homebrew/bin/mysqld',
    mysql: '/opt/homebrew/opt/mysql-client@8.4/bin/mysql',
    sqlFiles: [
      { appCode: 'console', path: 'scripts/fixtures/g3-real-http/console-service-jwt-minimal.sql' },
      { appCode: 'aims', path: 'aims/docs/aims_schema.sql' },
      { appCode: 'altoc', path: 'altoc/docs/altoc_schema.sql' }
    ]
  })
  assert.equal(mysqlPlan.readsDefaultFiles, false)
  assert.equal(mysqlPlan.freshDatadirPerRun, true)

  await withTemporaryMySql(mysqlPlan, async (database) => {
    const [aimsPort, altocRuntimePort, consolePort, altocPort, platformPort] = await Promise.all([reservePort(), reservePort(), reservePort(), reservePort(), reservePort()])
    const clientSecret = randomBytes(32).toString('base64url')
    const runtimeToken = randomBytes(32).toString('base64url')
    const platformRuntimeToken = randomBytes(32).toString('base64url')
    const consoleUrl = `http://127.0.0.1:${consolePort}`
    const consoleIssuer = `${consoleUrl}/console`
    const { publicKey, privateKey } = await generateKeyPair('EdDSA', { extractable: true })
    const publicJwk = { ...await exportJWK(publicKey), kid: 'g3-local-key', alg: 'EdDSA', use: 'sig' }
    const privateJwk = { ...await exportJWK(privateKey), kid: 'g3-local-key', alg: 'EdDSA', use: 'sig' }
    const platformSigningPublicKey = await exportSPKI(publicKey)
    const licensePayload = {
      tenantCode: TENANT,
      deploymentCode: SOURCE_DEPLOYMENT,
      appCode: 'console',
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString()
    }
    const platformLicenseToken = JSON.stringify({
      schemaVersion: 'license-token.v1',
      alg: 'Ed25519',
      kid: 'g3-local-platform-key',
      payload: licensePayload,
      signature: signBytes(null, Buffer.from(JSON.stringify(licensePayload)), privateKey).toString('base64url')
    })
    const sourceRuntimeToken = await new SignJWT({
      token_use: 'service', tenant: TENANT, deployment: SOURCE_DEPLOYMENT,
      app_code: 'aims', client_id: CLIENT_ID, scope: 'aims.write aims:integration_operation:execute',
      hzy: { appCode: 'aims', subjectType: 'service', credentialId: 1 }
    }).setProtectedHeader({ alg: 'EdDSA', kid: 'g3-local-key', typ: 'JWT' })
      .setIssuer(consoleIssuer).setAudience('data-runtime').setSubject(`client:${CLIENT_ID}`)
      .setIssuedAt().setExpirationTime('10m').sign(privateKey)
    const operations = [1, 2, 3, 4, 5].map(index => operation(`ST-G3-${index}`, index))
    await seedDatabases(database, { clientSecret, privateJwk, publicJwk, operations })

    const aimsRuntimeUrl = `http://127.0.0.1:${aimsPort}`
    const altocRuntimeUrl = `http://127.0.0.1:${altocRuntimePort}`
    const altocUrl = `http://127.0.0.1:${altocPort}/altoc`
    const commonDb = (app: 'aims' | 'altoc', prefix: string) => database.connectionEnv(app, prefix)
    const processes = [
      { name: 'aims-runtime', command: runtimeBinary, args: [], cwd: work, env: {
        HZY_DATA_RUNTIME_HOST: '127.0.0.1', HZY_DATA_RUNTIME_PORT: String(aimsPort), HZY_DATA_RUNTIME_TENANT: TENANT, HZY_DATA_RUNTIME_DEPLOYMENT: SOURCE_DEPLOYMENT,
        HZY_DATA_RUNTIME_AUTH_MODE: 'jwt', HZY_DATA_RUNTIME_JWT_ISSUER: consoleIssuer, HZY_DATA_RUNTIME_JWT_AUDIENCE: 'data-runtime', HZY_DATA_RUNTIME_JWKS_URL: `${consoleIssuer}/.well-known/jwks.json`, HZY_AIMS_AGENT_ENABLED: 'true', HZY_ALTOC_AGENT_ENABLED: 'false', HZY_FINANCE_AGENT_ENABLED: 'false',
        ...commonDb('aims', 'HZY_AIMS_DB')
      }, readiness: { url: `${aimsRuntimeUrl}/runtime/healthz`, status: 200 } },
      { name: 'altoc-runtime', command: runtimeBinary, args: [], cwd: work, env: {
        HZY_DATA_RUNTIME_HOST: '127.0.0.1', HZY_DATA_RUNTIME_PORT: String(altocRuntimePort), HZY_DATA_RUNTIME_TENANT: TENANT, HZY_DATA_RUNTIME_DEPLOYMENT: TARGET_DEPLOYMENT,
        HZY_DATA_RUNTIME_AUTH_MODE: 'static_token', HZY_DATA_RUNTIME_STATIC_TOKEN: runtimeToken, HZY_AIMS_AGENT_ENABLED: 'false', HZY_ALTOC_AGENT_ENABLED: 'true', HZY_FINANCE_AGENT_ENABLED: 'false',
        ...commonDb('altoc', 'HZY_ALTOC_DB')
      }, readiness: { url: `${altocRuntimeUrl}/runtime/healthz`, status: 200 } },
      { name: 'console', command: 'pnpm', args: ['exec', 'nuxi', 'dev', '--dotenv', join(ROOT, 'scripts/fixtures/g3-real-http/explicit-empty.env'), '--host', '127.0.0.1', '--port', String(consolePort)], cwd: join(ROOT, 'console'), env: {
        NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(consolePort), NITRO_HOST: '127.0.0.1', NITRO_PORT: String(consolePort),
        HZY_APP_CODE: 'console', HZY_PLATFORM_TENANT_CODE: TENANT, HZY_PLATFORM_DEPLOYMENT_CODE: SOURCE_DEPLOYMENT, HZY_PLATFORM_RUNTIME_ENABLED: 'true',
        HZY_PLATFORM_URL: `http://127.0.0.1:${platformPort}`, HZY_PLATFORM_RUNTIME_TOKEN: platformRuntimeToken,
        HZY_PLATFORM_SIGNING_KID: 'g3-local-platform-key', HZY_PLATFORM_SIGNING_PUBKEY: platformSigningPublicKey, HZY_PLATFORM_LICENSE_TOKEN: platformLicenseToken,
        HZY_PLATFORM_BUNDLE_CACHE_DIR: work, HZY_PLATFORM_HEARTBEAT_ENABLED: 'false', HZY_PLATFORM_BUNDLE_REFRESH_ON_BOOT: 'false', HZY_PLATFORM_AUTH_CLIENT_MATERIALIZE: 'false',
        HZY_CONSOLE_RUN_MODE: 'test', HZY_CONSOLE_BACKGROUND_JOBS_ENABLED: 'false', CONSOLE_COLLAB_MODE: 'disabled', CONSOLE_OIDC_ISSUER: consoleIssuer,
        CONSOLE_ACCESS_TOKEN_TTL_SECONDS: '5', CONSOLE_AUTH_SIGNING_PRIVATE_JWK: JSON.stringify(privateJwk), HZY_G3_AIMS_CLIENT_SECRET: clientSecret,
        ...database.connectionEnv('console')
      }, readiness: { url: `${consoleUrl}/`, status: 302 } },
      { name: 'altoc', command: 'pnpm', args: ['exec', 'nuxi', 'dev', '--dotenv', join(ROOT, 'scripts/fixtures/g3-real-http/explicit-empty.env'), '--host', '127.0.0.1', '--port', String(altocPort)], cwd: join(ROOT, 'altoc'), env: {
        NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(altocPort), NITRO_HOST: '127.0.0.1', NITRO_PORT: String(altocPort), HZY_APP_CODE: 'altoc', HZY_AUTH_MODE: 'oidc',
        HZY_CONSOLE_URL: consoleIssuer, NUXT_PUBLIC_CONSOLE_URL: consoleIssuer, HZY_CONSOLE_OIDC_API_URL: consoleIssuer,
        HZY_DATA_ACCESS_MODE: 'tenant-runtime', HZY_TENANT_RUNTIME_URL: altocRuntimeUrl, HZY_TENANT_RUNTIME_TOKEN: runtimeToken,
        HZY_TENANT_RUNTIME_TENANT: TENANT, HZY_TENANT_RUNTIME_DEPLOYMENT: TARGET_DEPLOYMENT, HZY_PLATFORM_TENANT_CODE: TENANT, HZY_PLATFORM_DEPLOYMENT_CODE: 'g3-altoc-app'
      }, readiness: { url: `${altocUrl}/`, status: 200 } }
    ]
    const allowedEnvironment = [...new Set(processes.flatMap(item => Object.keys(item.env)))].sort()
    const processPlan = await buildLocalProcessGroupPlan({ rootDir: ROOT, allowedWorkingRoots: [ROOT, work], allowedFileRoots: [ROOT, work], allowedEnvironment, totalTimeoutMs: 150_000, processes })
    assert.equal(JSON.stringify(processPlan).includes(clientSecret), false)
    assert.equal(JSON.stringify(processPlan).includes(runtimeToken), false)
    assert.equal(JSON.stringify(processPlan).includes(platformRuntimeToken), false)
    assert.equal(JSON.stringify(processPlan).includes(platformLicenseToken), false)

    const stopPlatformProfileStub = await startPlatformProfileStub(platformPort, platformRuntimeToken)
    try {
      await withLocalProcessGroup(processPlan, async () => {
      const source = operations[0]
      const dispatcherRequestId = 'g3-delivery-success'
      const claimed = await runtimePost(aimsRuntimeUrl, sourceRuntimeToken, `/v1/aims/integration-operations/${encodeURIComponent(source.operationKey)}:claim`, {}, dispatcherRequestId)
      assert.equal(claimed.operationId, source.operationId)
      assert.ok(Number(claimed.fencingToken) > 0)
      assert.ok(Date.parse(String(claimed.lockedUntil)) > Date.now())
      const envelope = buildServiceCommandEnvelope(claimed as any)
      const targetUrl = `${altocUrl}/api/v1/service/service-tickets/${encodeURIComponent(source.command.ticketCode)}/delivery-result:sync`
      const response = await executeServiceTokenRequest({
        getToken: async () => await issueToken(consoleIssuer, clientSecret),
        request: async token => await postJson(targetUrl, token, envelope, source.operationKey),
        statusCode: value => (value as Response).status
      })
      assert.equal(response.status, 200, await response.clone().text())
      const receipt = validateServiceCommandReceipt(claimed as any, ((await response.json()) as any).data, { targetBizType: 'service_ticket', targetBizCode: source.command.ticketCode })
      await runtimePost(aimsRuntimeUrl, sourceRuntimeToken, `/v1/aims/integration-operations/${encodeURIComponent(source.operationKey)}:succeed`, {
        operationId: source.operationId, fencingToken: claimed.fencingToken, httpStatus: 200,
        targetReceiptId: receipt.receiptId, receiptOperationId: receipt.operationId, receiptOperationCode: receipt.operationCode,
        receiptIdempotencyKey: receipt.idempotencyKey, receiptCommandSchemaVersion: receipt.commandSchemaVersion,
        receiptCommandSha256: receipt.commandSha256, targetBizType: receipt.targetBizType, targetBizCode: receipt.targetBizCode,
        responseSummarySha256: receipt.responseSummarySha256
      }, dispatcherRequestId)

      const consoleDb = await mysql.createConnection(database.connection('console'))
      const aimsDb = await mysql.createConnection(database.connection('aims'))
      const altocDb = await mysql.createConnection(database.connection('altoc'))
      try {
        const [[sourceRow]] = await aimsDb.query<any[]>(`SELECT status,target_receipt_id FROM integration_operation WHERE operation_id=?`, [source.operationId])
        const [[targetRow]] = await altocDb.query<any[]>(`SELECT status,aims_delivery_generation FROM service_ticket WHERE code=?`, [source.command.ticketCode])
        const [[receiptRow]] = await altocDb.query<any[]>(`SELECT status FROM service_command_receipt WHERE operation_id=?`, [source.operationId])
        assert.deepEqual([sourceRow.status, Boolean(sourceRow.target_receipt_id), targetRow.status, Number(targetRow.aims_delivery_generation), receiptRow.status], ['succeeded', true, 'processing', 1, 'succeeded'])

        const failureBaseline = async (index: number) => {
          const item = operations[index]
          const [[operationRow]] = await aimsDb.query<any[]>(`SELECT status,target_receipt_id FROM integration_operation WHERE operation_id=?`, [item.operationId])
          const [[ticketRow]] = await altocDb.query<any[]>(`SELECT status,aims_delivery_generation FROM service_ticket WHERE code=?`, [item.command.ticketCode])
          const [[countRow]] = await altocDb.query<any[]>(`SELECT COUNT(*) count FROM service_command_receipt WHERE operation_id=?`, [item.operationId])
          assert.deepEqual([operationRow.status, operationRow.target_receipt_id, ticketRow.status, Number(ticketRow.aims_delivery_generation), Number(countRow.count)], ['pending', null, 'accepted', 0, 0])
        }
        const failedCall = async (index: number, token: string, expected: number) => {
          const item = operations[index]
          const fakeClaim = { operationId: item.operationId, operationKey: item.operationKey, targetApp: 'altoc', operationCode: OPERATION_CODE, requiredCapability: CAPABILITY, idempotencyKey: item.operationKey, commandSchemaVersion: 'v1', commandSha256: item.commandSha256, command: item.command }
          const url = `${altocUrl}/api/v1/service/service-tickets/${item.command.ticketCode}/delivery-result:sync`
          const result = await postJson(url, token, buildServiceCommandEnvelope(fakeClaim), item.operationKey)
          await failureBaseline(index)
          assert.equal(result.status, expected)
        }

        const expired = await issueToken(consoleIssuer, clientSecret)
        await new Promise(resolveWait => setTimeout(resolveWait, 5_500))
        await failedCall(1, expired, 401)

        const rotated = await issueToken(consoleIssuer, clientSecret)
        await consoleDb.execute(`UPDATE service_client_credentials SET status='retired' WHERE id=1`)
        await consoleDb.execute(`INSERT INTO service_client_credentials (id,service_client_id,client_id,version_no,secret_id,rotated_from_id,status) VALUES (2,1,'g3-aims-runtime-v2',2,1,1,'active')`)
        await consoleDb.execute(`UPDATE service_clients SET current_credential_id=2 WHERE id=1`)
        await failedCall(2, rotated, 401)
        await consoleDb.execute(`UPDATE service_client_credentials SET status='retired' WHERE id=2`)
        await consoleDb.execute(`UPDATE service_client_credentials SET status='active' WHERE id=1`)
        await consoleDb.execute(`UPDATE service_clients SET current_credential_id=1 WHERE id=1`)

        const grantRevoked = await issueToken(consoleIssuer, clientSecret)
        await consoleDb.execute(`UPDATE service_client_grants SET status='inactive' WHERE id=1`)
        await failedCall(3, grantRevoked, 401)
        await consoleDb.execute(`UPDATE service_client_grants SET status='active' WHERE id=1`)

        const unavailable = await issueToken(consoleIssuer, clientSecret)
        await consoleDb.execute(`RENAME TABLE service_client_grants TO service_client_grants_g3_unavailable`)
        try {
          const introspection = await fetch(`${consoleIssuer}/oauth/introspect`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: unavailable })
          })
          const introspectionBody = await introspection.json() as Record<string, unknown>
          const introspectionErrorCode = String(introspectionBody.message || introspectionBody.statusMessage || '')
          assert.equal(introspection.status, 503, introspectionErrorCode)
          assert.equal(introspectionErrorCode, 'service_token_introspection_unavailable')
          await failedCall(4, unavailable, 503)
        } finally {
          await consoleDb.execute(`RENAME TABLE service_client_grants_g3_unavailable TO service_client_grants`)
        }
      } finally {
        await Promise.all([consoleDb.end(), aimsDb.end(), altocDb.end()])
      }
      }, { execute: true, confirm: processPlan.confirmationSha256, captureBytes: 16_384 })
    } finally {
      await stopPlatformProfileStub()
    }
  }, { execute: true, confirm: mysqlPlan.confirmationSha256, startupTimeoutMs: 30_000 })
})
