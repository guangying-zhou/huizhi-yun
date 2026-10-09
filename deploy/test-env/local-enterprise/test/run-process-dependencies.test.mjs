import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../run-process.mjs', import.meta.url), 'utf8')
test('every hzy0 pnpm exec uses prepared immutable dependencies without runtime install', () => {
  const calls = [...source.matchAll(/spawn\('pnpm', \[([^\]]+)\]/g)]
  assert.equal(calls.length, 5)
  for (const app of ['collab', 'workflow', 'aims', 'enterprise', 'console']) {
    const call = calls.find(([, args]) => args.includes(`'${app}'`))
    assert.ok(call, app)
    assert.ok(call[1].startsWith("'--config.verify-deps-before-run=false', '--dir'"), app)
    assert.ok(call[1].includes("'exec'"), app)
    assert.equal(call[1].includes("'install'"), false, app)
  }
  assert.equal(source.includes('CI:'), false, 'never force module removal by pretending non-interactive CI')
})
