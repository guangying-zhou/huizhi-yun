import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('committee management contract', () => {
  test('all committee routes enforce the existing directory organization permission', () => {
    const readRoutes = [
      'server/api/v1/console/directory/committees/index.get.ts',
      'server/api/v1/console/directory/committees/[committeeCode]/members/index.get.ts'
    ]
    const writeRoutes = [
      'server/api/v1/console/directory/committees/index.post.ts',
      'server/api/v1/console/directory/committees/[committeeCode].patch.ts',
      'server/api/v1/console/directory/committees/[committeeCode].delete.ts',
      'server/api/v1/console/directory/committees/[committeeCode]/members/index.post.ts',
      'server/api/v1/console/directory/committees/[committeeCode]/members/[uid].patch.ts',
      'server/api/v1/console/directory/committees/[committeeCode]/members/[uid].delete.ts'
    ]

    for (const path of readRoutes) {
      assert.match(source(path), /requirePermission\(event, 'directory_departments', 'view'/)
    }
    for (const path of writeRoutes) {
      const route = source(path)
      assert.match(route, /requirePermission\(event, 'directory_departments', 'edit'/)
      assert.match(route, /requireIdempotencyKey\(event\)/)
      assert.match(route, /ConsoleDirectoryCommittee/)
      assert.doesNotMatch(route, /directoryAdmin.*(?:create|update|delete|save|remove)/)
    }
  })

  test('committee and member reads are filtered and truly paginated', () => {
    const repository = source('server/utils/directoryRuntime.ts')
    const client = readFileSync(
      new URL('../../foundation/server/utils/consoleTenantRuntimeClient.ts', import.meta.url),
      'utf8'
    )
    const runtime = readFileSync(
      new URL('../../data-runtime/internal/apps/directory/console_management.go', import.meta.url),
      'utf8'
    )

    assert.match(repository, /getConsoleDirectoryCommittees/)
    assert.match(repository, /getConsoleDirectoryCommitteeMembers/)
    assert.doesNotMatch(repository, /queryRows|queryRow|server\/utils\/db/)
    assert.match(client, /\/v1\/console\/directory\/committees/)
    assert.match(runtime, /conditions := \[\]string\{"d\.org_type='committee'"\}/)
    assert.match(runtime, /consoleCommitteeMemberCandidates/)
    assert.match(runtime, /consoleCommitteeMemberCount/)
    assert.match(runtime, /LIMIT \? OFFSET \?/)
  })

  test('member writes keep subject membership and leadership semantics in one transaction', () => {
    const admin = source('server/utils/directoryAdmin.ts')
    const runtime = readFileSync(
      new URL('../../data-runtime/internal/apps/directory/console_department_mutation.go', import.meta.url),
      'utf8'
    )
    const receipt = readFileSync(
      new URL('../../data-runtime/internal/apps/directory/console_mutation_receipt.go', import.meta.url),
      'utf8'
    )

    assert.doesNotMatch(admin, /queryRows|queryRow|withTransaction|server\/utils\/db/)
    assert.match(runtime, /ConsoleSaveCommitteeMembers/)
    assert.match(runtime, /member\.Role == "observer"/)
    assert.match(runtime, /FOR UPDATE/)
    assert.match(runtime, /leader_uid=CASE/)
    assert.match(runtime, /manager_uid=CASE/)
    assert.match(runtime, /directory\.committee\.members\.update/)
    assert.match(runtime, /directory\.committee\.member\.remove/)
    assert.match(receipt, /console_mutation_receipts/)
    assert.match(receipt, /INSERT INTO operation_logs/)
  })

  test('management page follows list, permission, confirmation, and responsive contracts', () => {
    const page = source('app/pages/directory/committees.vue')
    const permissions = source('app/config/permissions.ts')

    assert.match(page, /useDebouncedSearch\(\)/)
    assert.match(page, /useListPage\(/)
    assert.match(page, /page: page\.value/)
    assert.match(page, /v-model:page="page"/)
    assert.match(page, /<CommonEmptyState/)
    assert.match(page, /useConfirm\(\)/)
    assert.match(page, /hasPermission\('directory_departments', 'edit'\)/)
    assert.match(page, /<UserTreeSelector/)
    assert.match(page, /hide-committees/)
    assert.match(page, /sm:grid-cols-/)
    assert.match(permissions, /to: '\/directory\/committees'/)
    assert.match(permissions, /pattern: '\/directory\/committees'/)
  })
})
