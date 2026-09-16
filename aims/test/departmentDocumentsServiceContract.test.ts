import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'

const root = resolve(import.meta.dirname, '..')
const read = (file: string) => readFileSync(resolve(root, file), 'utf8')

test('department document picker uses an exact signed Codocs service contract', () => {
  const helper = read('server/utils/codocsApi.ts')
  const route = read('server/api/v1/codocs/department-documents.get.ts')

  assert.match(route, /hasDepartmentAccess\(event, uid, deptCode\)/)
  assert.match(route, /searchDepartmentDocuments\(\{ event, deptCode, actorUid: uid \}\)/)
  assert.match(helper, /codocs:department-documents:list/)
  assert.match(helper, /aims\.codocs\.department-documents\.list\.v1/)
  assert.match(helper, /commandSchemaVersion:\s*'aims\.codocs\.department-documents\.list\.v1'/)
  assert.match(helper, /buildServiceCommandRuntimeHeaders/)
  assert.match(helper, /resolveTrustedServiceAppRoute\(params\.event, 'codocs'\)/)
  assert.match(helper, /trustedServiceRequestHeaders\(params\.event, 'codocs'\)/)
  assert.match(helper, /sourceClientId:\s*'aims\.runtime'/)
  assert.match(helper, /sourceDeploymentCode,/)
  assert.match(helper, /targetDeploymentCode,/)
  assert.match(helper, /'x-hzy-deployment': targetDeploymentCode/)
  assert.match(helper, /\/service\/department-documents\/search/)

  const implementation = helper.slice(
    helper.indexOf('export async function searchDepartmentDocuments'),
    helper.indexOf('export async function searchProjectDocuments')
  )
  assert.doesNotMatch(implementation, /maybeCallCodocsRuntime/)
  assert.doesNotMatch(implementation, /getUserCookieHeader/)
  assert.doesNotMatch(implementation, /\/v1\/codocs\/(?:folders|documents)/)
})

test('Console grant is limited to the credential-backed Aims runtime picker capability', () => {
  const seed = read('../console/docs/sql/Console-SQL-Seed-v1.94-aims-codocs-department-documents-list-grant.sql')
  const verify = read('../console/docs/sql/Console-SQL-Verify-v1.94-aims-codocs-department-documents-list-grant.sql')

  assert.match(seed, /sc\.`app_code` = 'aims'/)
  assert.match(seed, /sc\.`client_code` = 'aims\.runtime'/)
  assert.match(seed, /sc\.`current_credential_id` IS NOT NULL/)
  assert.match(seed, /'codocs:department-documents'/)
  assert.match(seed, /'list'/)
  assert.match(seed, /'codocs:department-documents:list'/)
  assert.doesNotMatch(seed, /data-runtime:codocs/)
  assert.doesNotMatch(seed, /codocs:documents:read/)
  assert.match(verify, /has_department_documents_list/)
})
