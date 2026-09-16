import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('Aims directory reads preserve the verified browser request context', () => {
  const source = readFileSync(new URL('../server/utils/userDepartments.ts', import.meta.url), 'utf8')

  assert.match(source, /fetchUserDepartments\(event: H3Event, uid: string\)/)
  assert.match(source, /'\/api\/v1\/directory\/departments',[\s\S]*?\{ event, timeout: 10000 \}/)
  assert.match(source, /'\/api\/v1\/directory\/user-departments',[\s\S]*?\{ event, params: \{ uid \} \}/)
  assert.doesNotMatch(source, /getDirectoryAuthHeaders\(\)/)
})
