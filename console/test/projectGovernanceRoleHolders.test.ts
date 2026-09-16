import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { buildRoleHolderProjection } from '../server/utils/roleHolders.ts'

function consoleSource(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function workspaceSource(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
}

describe('project governance role holder service', () => {
  test('projects exact user holders and reports missing or ambiguous roles', () => {
    const roles = buildRoleHolderProjection({
      policyRevision: 17,
      subjects: [
        {
          subjectType: 'user',
          subjectCode: 'director-uid',
          externalRef: 'directory-sync-hash-must-not-be-used-as-uid',
          displayName: '项目总监',
          status: 'active'
        },
        { subjectType: 'user', subjectCode: 'qa-1', displayName: 'QA 一', status: 'active' },
        { subjectType: 'user', subjectCode: 'qa-2', displayName: 'QA 二', status: 'active' }
      ],
      roleAssignments: [
        { subjectType: 'user', subjectCode: 'director-uid', roleCode: 'project_director', status: 'active' },
        { subjectType: 'user', subjectCode: 'qa-1', roleCode: 'qa', status: 'active' },
        { subjectType: 'user', subjectCode: 'qa-2', roleCode: 'qa', status: 'active' }
      ],
      roleHolderRevisions: [
        { roleCode: 'project_director', revision: 3 },
        { roleCode: 'qa', revision: 4 }
      ]
    }, ['project_director', 'qa'])

    assert.deepEqual(roles[0], {
      roleCode: 'project_director',
      revision: 3,
      policyRevision: 17,
      status: 'resolved',
      errorCode: null,
      holders: [{ uid: 'director-uid', displayName: '项目总监' }]
    })
    assert.equal(roles[1]?.status, 'ambiguous')
    assert.equal(roles[1]?.errorCode, 'role_holder_ambiguous')
    assert.equal(roles[1]?.holders.length, 2)
  })

  test('service authenticates before reading query or policy bundle and never caches result', () => {
    const route = consoleSource('server/api/v1/console/service/authorization/role-holders.get.ts')
    const authIndex = route.indexOf('requireConsoleServiceActor(')

    assert.notEqual(authIndex, -1)
    assert.ok(authIndex < route.indexOf('getQuery(event)'))
    assert.ok(authIndex < route.indexOf('readCachedBundle('))
    assert.match(route, /'console'[\s\S]*'console:authorization-role-holders:read'/)
    assert.match(route, /requireBoundTargetApp: true/)
    assert.match(route, /Cache-Control', 'no-store'/)
    assert.match(route, /bundle\.tenantCode !== binding\.tenantId/)
    assert.match(
      route,
      /config\.activationMode !== 'managed-cloud-multitenant'[\s\S]*bundle\.deploymentCode !== binding\.deploymentId/
    )
  })

  test('service grants are limited to Aims and Workflow runtime identities', () => {
    const seed = workspaceSource('console/docs/sql/Console-SQL-Seed-v1.87-project-governance-role-holder-grants.sql')
    const verify = workspaceSource('console/docs/sql/Console-SQL-Verify-v1.87-project-governance-role-holder-grants.sql')

    for (const content of [seed, verify]) {
      assert.match(content, /console:authorization-role-holders/)
      assert.match(content, /'aims', 'workflow'/)
      assert.match(content, /'aims\.runtime'.*'workflow'.*'workflow\.runtime'/s)
    }
    assert.doesNotMatch(seed, /system_admin/)
  })
})
