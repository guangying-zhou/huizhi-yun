import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const aimsClient = readFileSync(new URL('../server/utils/codocsApi.ts', import.meta.url), 'utf8')
const runtimeAccess = readFileSync(
  new URL('../../data-runtime/internal/apps/codocs/document_access.go', import.meta.url),
  'utf8'
)

test('Aims document access facts cross the signed Codocs service boundary', () => {
  const service = readFileSync(new URL('../../codocs/server/utils/projectDocumentAccessService.ts', import.meta.url), 'utf8')
  assert.match(aimsClient, /callCodocsProjectAccess.*'check'/)
  assert.match(service, /aims_trusted_document_access_project_codes: facts\(command.actorProjectCodes/)
  assert.match(service, /aims_trusted_document_access_roles: facts\(command.actorRoles/)
  assert.ok(service.indexOf('await verifyServiceCommandRuntimeHeaders') < service.indexOf('codocs_trusted_aims_document_access:'))
})

test('Codocs accepts Aims scope only for a signed delegated Aims actor', () => {
  assert.match(runtimeAccess, /query\.Get\("hzy_runtime_actor_delegated"\) != "1"/)
  assert.match(runtimeAccess, /query\.Get\("hzy_runtime_source_app"\)/)
  assert.match(runtimeAccess, /sourceApp != "aims"/)
  assert.match(runtimeAccess, /trustedAimsDocumentAccessScopeFacts\(query\)/)
  assert.doesNotMatch(runtimeAccess, /parseStringSlice\(body\["actorProjectCodes"\]\)/)
  assert.doesNotMatch(runtimeAccess, /parseStringSlice\(body\["actorRoles"\]\)/)
})
