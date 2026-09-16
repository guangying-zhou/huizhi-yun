import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const aimsClient = readFileSync(new URL('../server/utils/codocsApi.ts', import.meta.url), 'utf8')
const runtimeAccess = readFileSync(
  new URL('../../data-runtime/internal/apps/codocs/document_access.go', import.meta.url),
  'utf8'
)

test('Aims document access scope uses request-target signed markers', () => {
  assert.match(aimsClient, /aims_trusted_document_access_project_codes/)
  assert.match(aimsClient, /aims_trusted_document_access_roles/)
  assert.match(
    aimsClient,
    /query:\s*\{[\s\S]*?AIMS_TRUSTED_DOCUMENT_ACCESS_PROJECT_CODES_QUERY[\s\S]*?actorProjectCodes\.join\(','\)[\s\S]*?AIMS_TRUSTED_DOCUMENT_ACCESS_ROLES_QUERY[\s\S]*?actorRoles\.join\(','\)/
  )
})

test('Codocs accepts Aims scope only for a signed delegated Aims actor', () => {
  assert.match(runtimeAccess, /query\.Get\("hzy_runtime_actor_delegated"\) != "1"/)
  assert.match(runtimeAccess, /query\.Get\("hzy_runtime_source_app"\)/)
  assert.match(runtimeAccess, /sourceApp != "aims"/)
  assert.match(runtimeAccess, /trustedAimsDocumentAccessScopeFacts\(query\)/)
  assert.doesNotMatch(runtimeAccess, /parseStringSlice\(body\["actorProjectCodes"\]\)/)
  assert.doesNotMatch(runtimeAccess, /parseStringSlice\(body\["actorRoles"\]\)/)
})
