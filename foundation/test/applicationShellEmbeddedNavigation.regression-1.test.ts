import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('ISSUE-007 keeps business apps embedded after route query changes', () => {
  const source = readFileSync(
    new URL('../app/composables/useApplicationShell.ts', import.meta.url),
    'utf8'
  )

  assert.match(source, /import\.meta\.client\s*&&\s*window\.parent\s*!==\s*window/)
  assert.match(
    source,
    /framedByApplicationShell\s*\|\|\s*embedQueryEnabled\(route\.query\[APPLICATION_SHELL_EMBED_QUERY\]\)/
  )
  assert.doesNotMatch(source, /embedded\.value\s*=\s*false/)
})
