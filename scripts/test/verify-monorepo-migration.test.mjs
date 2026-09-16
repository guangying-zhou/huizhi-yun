import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testDir = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(testDir, '../..')
const inventory = JSON.parse(
  readFileSync(resolve(workspaceRoot, 'docs/monorepo-migration/inventory.json'), 'utf8')
)

function listTags(args) {
  const output = execFileSync('git', ['tag', ...args], {
    cwd: workspaceRoot,
    encoding: 'utf8'
  }).trim()
  return output ? output.split(/\r?\n/) : []
}

test('post-migration release tags do not invalidate the migration baseline', () => {
  const aims = inventory.repositories.find(repository => repository.name === 'aims')
  assert.ok(aims)

  const allAimsTags = listTags(['--list', 'aims/*'])
  const migratedAimsTags = listTags(['--merged', aims.newHead, '--list', 'aims/*'])

  assert.ok(allAimsTags.length > aims.tagCount)
  assert.equal(migratedAimsTags.length, aims.tagCount)

  const result = spawnSync(process.execPath, ['scripts/verify-monorepo-migration.mjs'], {
    cwd: workspaceRoot,
    encoding: 'utf8'
  })

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})
