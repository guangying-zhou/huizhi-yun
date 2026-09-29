/* eslint-disable @typescript-eslint/no-explicit-any -- Controlled service boundary adapters. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import { hashServiceCommandPayload } from '../../foundation/server/utils/tenantRuntimeClient'
import { authorizationActionsAllow } from '../../foundation/shared/utils/authorizationActions'

const compiled = ts.transpileModule(readFileSync(new URL('../server/utils/enterpriseProjectDocumentsService.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

async function run(mode = '', action = 'open') {
  const exports: any = {}, calls: string[] = []
  const command: any = { actorUid: 'person-a', tenant: 'TENANT', sourceDeployment: 'ENTERPRISE', targetDeployment: 'AIMS', projectId: '12', documentId: '42', action, query: {}, scope: { current_user_project_admin_project_codes: 'PRJ-1' } }
  if (action === 'list') delete command.documentId
  const envelope: any = { operationId: crypto.randomUUID(), targetApp: 'aims', operationCode: `enterprise.aims.project-documents.${action}.v1`, requiredCapability: 'aims:project-documents:read', commandSchemaVersion: 'enterprise-project-documents.v1', idempotencyKey: 'read-key', commandSha256: await hashServiceCommandPayload(command), command }
  if (mode === 'tenant') command.tenant = 'OTHER'
  runInNewContext(compiled, { exports, require: (name: string) => {
    if (name.endsWith('/authorizationActions')) return { authorizationActionsAllow }
    if (name === 'h3') return { createError, setHeader: () => {}, getQuery: () => ({}), getHeader: (e: any, key: string) => key === 'authorization' ? 'Bearer token' : 'request-1', getRequestURL: () => ({ pathname: '/aims/api/v1/service/enterprise/project-documents/read' }), readBody: async () => ({ serviceCommand: envelope }) }
    if (name.endsWith('/consoleOidc')) return { requireConsoleAuthContext: async () => ({ appCode: 'enterprise', clientCode: 'enterprise.runtime', tenant: 'TENANT', deployment: 'ENTERPRISE' }) }
    if (name.endsWith('/tenantGatewayTrust')) return { resolveTrustedTenantGatewayContext: () => ({ tenant: 'TENANT', appCode: 'aims', deployment: 'AIMS' }) }
    if (name === './serviceAuth') return { requireServiceScope: () => { if (mode === 'identity') throw createError({ statusCode: 403 }) } }
    if (name.endsWith('/subjectScopedAuthorization')) return { loadSubjectScopedAuthorizationByService: async () => ({ grants: mode === 'denied' ? [] : [{ permissions: [{ appCode: 'aims', resourceCode: 'projects', action: 'view' }] }] }) }
    if (name === './codocsApi') return { getCodocsProjectDocumentContent: async (input: any) => { calls.push('codocs'); assert.equal(input.actorUid, 'person-a'); assert.equal(input.projectCode, 'PRJ-1'); assert.equal(input.documentUuid, 'doc-uuid'); return { data: { content: 'safe' } } } }
    if (name === './aimsRuntimeForward') return { runtimeEnvelopeError: (response: any) => createError({ statusCode: response.code === 404 ? 404 : 503 }) }
    if (name.endsWith('/tenantRuntimeClient')) return { hashServiceCommandPayload, verifyServiceCommandRuntimeHeaders: async () => { calls.push('signature'); if (mode === 'signature') throw createError({ statusCode: 403 }) }, maybeCallTenantRuntime: async (_event: any, path: string, options: any) => { calls.push(path); assert.equal(options.serviceCommandActor.uid, 'person-a'); assert.equal(options.query.current_user, 'person-a'); if (mode === 'object' && path.includes('/documents/42')) return { handled: true, data: { code: 404 } }; return { handled: true, data: { code: 0, data: path.endsWith('/projects/12') ? { projectCode: 'PRJ-1' } : path.includes('/documents/42') ? { id: 42, documentSource: 'codocs', codocsUuid: 'doc-uuid' } : { items: [] } } } } }
    throw new Error(name)
  } })
  try { return { calls, result: await exports.handleEnterpriseProjectDocumentsService({ method: 'POST' }) } } catch (error) { return { calls, error } }
}

test('project document proxy verifies Enterprise delegation before Aims and Codocs reads', async () => {
  const { result, calls } = await run()
  assert.equal(result.data.content.content, 'safe')
  assert.deepEqual(calls, ['signature', '/v1/aims/projects/12/documents/42', '/v1/aims/projects/12', 'codocs'])
})

test('project document proxy rejects identity, tenant, permission, signature and object mismatch before Codocs', async () => {
  for (const mode of ['identity', 'tenant', 'denied', 'signature', 'object']) {
    const { error, calls } = await run(mode)
    assert.ok([403, 404].includes((error as any)?.statusCode))
    assert.equal(calls.includes('codocs'), false)
  }
})

test('project document list stays metadata-only', async () => {
  const { result, calls } = await run('', 'list')
  assert.deepEqual(result.data.items, [])
  assert.equal(calls.includes('codocs'), false)
})
