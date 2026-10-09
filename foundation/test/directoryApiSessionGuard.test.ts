import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../server/api/directory', import.meta.url))

function handlers(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? handlers(path) : [path]
  })
}

test('every browser directory handler requires a verified user session', () => {
  const files = handlers(root).filter(path => path.endsWith('.ts'))
  assert.ok(files.length >= 13)
  for (const path of files) {
    const name = relative(root, path)
    const source = readFileSync(path, 'utf8')
    // me.get.ts forwards the caller's own credentials to Console /auth/me,
    // which answers 401 without a session; every other handler uses a
    // service credential and must refuse anonymous callers first.
    if (name === 'me.get.ts') {
      assert.match(source, /fetchConsoleApi<[^>]+>\('\/auth\/me'/)
      continue
    }
    assert.match(source, /await requireFoundationSessionUid\(event\)/, name)
  }
})
