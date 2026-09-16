import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function workflowSource(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function workspaceSource(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
}

describe('Workflow Directory service contract', () => {
  test('uses the restricted Console service projection with the request event', () => {
    const client = workflowSource('server/utils/directoryRuntimeClient.ts')

    assert.match(client, /fetchConsoleDirectoryApi/)
    assert.match(client, /[\x60'"]\/users\//)
    assert.match(client, /['"]\/departments['"]/)
    assert.match(client, /\{ event \}/)
    assert.match(client, /params: \{ dept_code: normalizedDeptCode \}/)
    assert.doesNotMatch(client, /fetchDirectoryApi/)
    assert.doesNotMatch(client, /Failed to fetch (?:user|department)/)
    assert.doesNotMatch(client, /catch\s*\(/)
  })

  test('propagates the event through browser and service approval entry points', () => {
    const initiator = workflowSource('server/utils/initiatorContext.ts')
    const middleware = workflowSource('server/middleware/data-runtime.ts')
    const codocs = workflowSource('server/api/v1/service/codocs-publish-approval.post.ts')
    const finance = workflowSource('server/api/v1/service/finance-invoice-approval.post.ts')

    assert.match(initiator, /collectWorkflowInitiatorContext\(event: H3Event, uid: string\)/)
    assert.match(initiator, /getDirectoryUserByUid\(event, uid\)/)
    assert.match(initiator, /listDirectoryDepartments\(event\)/)
    assert.match(initiator, /getDeptByCode\(departments, dept\.parent_code\)/)
    assert.match(middleware, /collectWorkflowInitiatorContext\(event, currentUser\)/)
    assert.match(middleware, /getDirectoryUserByUid\(event, delegateTo\)/)
    assert.match(codocs, /collectWorkflowInitiatorContext\(event, actorUid\)/)
    assert.match(finance, /collectWorkflowInitiatorContext\(event, actorUid\)/)
  })

  test('seeds only the credential-backed Workflow runtime with the exact capability', () => {
    const seed = workspaceSource('console/docs/sql/Console-SQL-Seed-v1.96-workflow-directory-sharing-read-grant.sql')
    const verify = workspaceSource('console/docs/sql/Console-SQL-Verify-v1.96-workflow-directory-sharing-read-grant.sql')

    assert.match(seed, /sc\.`app_code` = 'workflow'/)
    assert.match(seed, /sc\.`client_code` = 'workflow\.runtime'/)
    assert.match(seed, /sc\.`current_credential_id` IS NOT NULL/)
    assert.match(seed, /'console:directory-users'\s*,\s*'read'/)
    assert.match(seed, /'semanticScope', 'console:directory-users:read'/)
    assert.match(seed, /'audience', 'console'/)
    assert.match(seed, /ON DUPLICATE KEY UPDATE[\s\S]*`scope_json` = VALUES\(`scope_json`\)/)
    assert.doesNotMatch(seed, /role_permissions|directory_users:view|console:directory_operator/)

    assert.match(verify, /has_directory_users_read/)
    assert.match(verify, /'console:directory-users:read'/)
    assert.match(verify, /'console'/)
    assert.match(verify, /service_client_credentials/)
  })
})
