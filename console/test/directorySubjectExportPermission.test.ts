import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import appManifest from '../app.manifest.json' with { type: 'json' }

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assertBefore(content: string, left: string, right: string) {
  const leftIndex = content.indexOf(left)
  const rightIndex = content.indexOf(right)

  assert.notEqual(leftIndex, -1, `Missing ${left}`)
  assert.notEqual(rightIndex, -1, `Missing ${right}`)
  assert.ok(leftIndex < rightIndex, `${left} must appear before ${right}`)
}

describe('Directory subject export permission', () => {
  test('subject export API requires directory_sync/export before reading exports', () => {
    const content = source('server/api/v1/console/directory/subjects/export.get.ts')

    assertBefore(
      content,
      'requirePermission(event, \'directory_sync\', \'export\'',
      'getConsoleDirectorySubjectExports(event, getQuery(event))'
    )
    assert.doesNotMatch(content, /directoryRuntime|queryRow|queryRows|server\/utils\/db/)
  })

  test('manifest declares and grants directory_sync/export explicitly', () => {
    const resource = appManifest.resources.find(item => item.code === 'directory_sync')
    assert.ok(resource, 'directory_sync resource must exist')
    assert.ok(resource.actions.includes('export'), 'directory_sync must declare export action')

    const roles = new Map(appManifest.recommendedRoles.map(role => [role.code, role]))
    assert.ok(
      roles.get('console:directory_manager')?.suggestedPermissions.includes('console:directory_sync:export'),
      'directory manager should be able to export subject projection'
    )
    assert.ok(
      roles.get('console:admin')?.suggestedPermissions.includes('console:directory_sync:export'),
      'console admin should be able to export subject projection'
    )
    assert.equal(
      roles.get('console:directory_operator')?.suggestedPermissions.includes('console:directory_sync:export'),
      false,
      'directory operator must not export subject projection'
    )
    assert.equal(
      roles.get('console:directory_operator')?.suggestedPermissions.includes('console:directory_sources:admin'),
      false,
      'directory operator must not administer external directory sources'
    )
    assert.equal(
      roles.get('console:directory_operator')?.suggestedPermissions.includes('console:directory_sync:admin'),
      false,
      'directory operator must not administer directory sync jobs'
    )
  })
})
