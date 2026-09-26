/* eslint-disable @typescript-eslint/no-explicit-any -- isolated signed-boundary harness */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import { requireCodocsServiceAuth } from '../server/lib/serviceAuthPolicy'
import { buildServiceCommandRuntimeHeaders, hashServiceCommandPayload, verifyServiceCommandRuntimeHeaders } from '../../foundation/server/utils/tenantRuntimeClient'

const code = ts.transpileModule(readFileSync(new URL('../server/utils/projectDocumentAccessService.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
async function invoke(mode = '', action = 'check') {
  const calls: any[] = [], exports: any = {}
  const capability = action === 'create' ? 'codocs:project-document-access:create' : action === 'policy-update' ? 'codocs:project-document-access:manage' : 'codocs:project-document-access:read'
  const command: any = { actorUid: 'person-a', action, documentUuid: '12345678-1234-1234-1234-123456789abc', sourceProjectCode: 'PRJ-1', actorProjectCodes: ['PRJ-1'], actorRoles: [], accessAction: 'view', title: 'Test', content: 'body', current_user: 'forged' }
  const envelope: any = { operationId: 'op-1', targetApp: 'codocs', operationCode: `aims.codocs.project-document-access.${action}.v1`, requiredCapability: capability, commandSchemaVersion: 'aims-project-document-access.v1', idempotencyKey: 'test-key', commandSha256: await hashServiceCommandPayload(command), command }
  const signature = await buildServiceCommandRuntimeHeaders({ token: 'test-token', method: 'POST', requestTarget: '/codocs/api/v1/service/project-document-access/execute', requestId: 'req-1', tenantCode: 'TENANT', sourceDeploymentCode: 'AIMS', targetDeploymentCode: 'CODOCS', sourceApp: 'aims', sourceClientId: 'aims.runtime', targetApp: 'codocs', envelope, ...(mode === 'expired' ? { now: Date.now() - 120000 } : {}) })
  if (mode === 'expired') signature['x-hzy-service-command-signed-at'] = String(Date.now() - 120000)
  if (mode === 'tamper') command.actorUid = 'person-b'
  if (mode === 'deployment') signature['x-hzy-service-command-target-deployment'] = 'OTHER'
  const auth: any = { authenticated: true, tokenUse: 'service', subjectType: 'service', appCode: 'aims', clientCode: 'aims.runtime', tenant: 'TENANT', deployment: 'AIMS', scopes: [capability] }
  if (mode === 'scope') auth.scopes = ['codocs:admin']
  if (mode === 'source') auth.appCode = 'enterprise'
  if (mode === 'client') auth.clientCode = 'aims'
  if (mode === 'tenant') auth.tenant = 'OTHER'
  if (mode === 'unauthenticated') auth.authenticated = false
  const event: any = { method: 'POST', context: { consoleAuth: auth } }
  runInNewContext(code, { exports, require(name: string) {
    if (name === 'h3') return { createError, getHeader: (_event: any, key: string) => key === 'authorization' ? 'Bearer test-token' : key === 'x-request-id' ? 'req-1' : signature[key], getQuery: () => ({}), getRequestURL: () => ({ pathname: '/codocs/api/v1/service/project-document-access/execute' }), readBody: async () => ({ serviceCommand: envelope }) }
    if (name.endsWith('/consoleOidc')) return { requireConsoleAuthContext: async () => auth }
    if (name.endsWith('/tenantGatewayTrust')) return { resolveTrustedTenantGatewayContext: () => ({ appCode: mode === 'audience' ? 'aims' : 'codocs', tenant: 'TENANT', deployment: 'CODOCS' }) }
    if (name.endsWith('/tenantRuntimeClient')) return { hashServiceCommandPayload, verifyServiceCommandRuntimeHeaders }
    if (name.endsWith('/serviceAuthPolicy')) return { requireCodocsServiceAuth }
    if (name === './codocsRuntime') return { callCodocsTenantRuntime: async (...args: any[]) => {
      calls.push(args)
      return { allowed: true }
    } }
    if (name === './projectDocumentCreation') return { createProjectDocumentContent: async (...args: any[]) => {
      calls.push(args)
      return { code: 0 }
    } }
    throw Error(name)
  } })
  try {
    return { result: await exports.projectDocumentAccessService(event), calls }
  } catch (error) {
    return { error, calls }
  }
}

test('signed project scope is verified before Codocs uses its own runtime identity', async () => {
  const { result, calls } = await invoke()
  assert.equal(result.data.allowed, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][2].query.codocs_trusted_aims_document_access, '1')
  assert.equal(calls[0][2].query.aims_trusted_document_access_project_codes, 'PRJ-1')
  assert.equal(calls[0][2].body.current_user, undefined)
})
test('identity, capability, audience, tenant, deployment, expired and tampered commands fail before runtime/storage', async () => {
  for (const mode of ['scope', 'source', 'client', 'tenant', 'audience', 'deployment', 'expired', 'tamper', 'unauthenticated']) {
    const { error, calls } = await invoke(mode)
    assert.ok([401, 403].includes((error as any)?.statusCode), mode)
    assert.equal(calls.length, 0, mode)
  }
})
test('creation uses verified actor and stable UUID, discarding caller runtime fields', async () => {
  const { result, calls } = await invoke('', 'create')
  assert.equal(result.code, 0)
  assert.equal(calls[0][1].ownerUid, 'person-a')
  assert.equal(calls[0][1].uuid, '12345678-1234-1234-1234-123456789abc')
  assert.equal(calls[0][1].docType, 'project')
  assert.equal(calls[0][1].current_user, undefined)
})
