import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('project director role holder lookup uses the Console Service Binding transport', () => {
  const source = readFileSync(
    new URL('../server/utils/projectDirectorRoleHolder.ts', import.meta.url),
    'utf8'
  )

  assert.match(source, /fetchConsoleServiceJson/)
  assert.match(source, /trustedServiceRequestHeaders\(event\)/)
  assert.doesNotMatch(source, /\$fetch<RoleHolderResponse>/)
})
