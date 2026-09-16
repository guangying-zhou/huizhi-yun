import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'

const root = resolve(import.meta.dirname, '..')
const read = (file: string) => readFileSync(resolve(root, file), 'utf8')

test('Aims department document service route binds identity, command, and directory department access', () => {
  const route = read('server/api/v1/service/department-documents/search.post.ts')
  const policy = read('server/lib/serviceAuthPolicy.ts')
  const middleware = read('server/middleware/tenant-runtime.ts')

  assert.match(policy, /scope: 'codocs:department-documents:list', allowedApps: \['aims'\], allowedClientCodes: \['aims\.runtime'\], exactScope: true/)
  assert.match(route, /AIMS_DEPARTMENT_DOCUMENTS_LIST_SERVICE_AUTH/)
  assert.match(route, /sourceDeploymentCode !== signedSourceDeploymentCode/)
  assert.match(route, /targetAppCode !== 'codocs'/)
  assert.match(route, /targetDeploymentCode !== `\$\{tenantCode\}-codocs`/)
  assert.match(route, /targetDeploymentCode !== signedTargetDeploymentCode/)
  assert.match(route, /verifyServiceCommandRuntimeHeaders/)
  assert.match(route, /requireDepartmentReadAccess\(event, actorUid, deptCode\)/)
  assert.match(route, /callCodocsTenantRuntime/)
  assert.match(route, /serviceTokenSourceBinding:\s*'service-client-policy'/)
  assert.match(route, /serviceCommandActor:\s*\{ uid: actorUid \}/)
  assert.match(route, /\/v1\/codocs\/service\/department-documents\/search/)
  assert.match(middleware, /department-documents\\\/search/)

  const authIndex = route.indexOf('requireCodocsServiceAuth(')
  const bindingIndex = route.indexOf('targetDeploymentCode !== `${tenantCode}-codocs`')
  const bodyIndex = route.indexOf('readBody<')
  const verifyIndex = route.indexOf('await verifyServiceCommandRuntimeHeaders')
  const departmentIndex = route.indexOf('await requireDepartmentReadAccess(event, actorUid, deptCode)')
  const runtimeIndex = route.indexOf('await callCodocsTenantRuntime')
  assert.ok(authIndex >= 0 && authIndex < bodyIndex)
  assert.ok(bindingIndex >= 0 && bindingIndex < bodyIndex)
  assert.ok(verifyIndex >= 0 && verifyIndex < departmentIndex)
  assert.ok(departmentIndex >= 0 && departmentIndex < runtimeIndex)
})

test('runtime department document search is source-bound and applies department list predicates', () => {
  const runtime = read('../data-runtime/internal/apps/codocs/department_document_service.go')
  const adapter = read('../data-runtime/internal/apps/codocs/adapter.go')

  assert.match(runtime, /TrustedServiceCommandSourceAppKey\)\) != "aims"/)
  assert.match(runtime, /TrustedServiceCommandSourceClientKey\)\) != "aims\.runtime"/)
  assert.match(runtime, /codocsTrustedDepartmentReadQueryKey/)
  assert.match(runtime, /scopedQuery\.Set\("type", "department"\)/)
  assert.match(runtime, /scopedQuery\.Set\("folder_type", "department"\)/)
  assert.match(runtime, /a\.documentsList\(ctx, scopedQuery\)/)
  assert.match(runtime, /a\.foldersList\(ctx, scopedQuery\)/)
  assert.match(adapter, /service\/department-documents\/search/)
})
