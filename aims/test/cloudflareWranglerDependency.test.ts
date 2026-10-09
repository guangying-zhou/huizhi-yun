import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf8'))
const workspace = readFileSync(resolve(rootDir, '../pnpm-workspace.yaml'), 'utf8')

describe('Cloudflare Wrangler execution', () => {
  test('uses the pinned local Wrangler dependency without pnpm dlx', () => {
    assert.equal(manifest.devDependencies.wrangler, '4.110.0')

    for (const scriptName of [
      'deploy:cloudflare',
      'verify:cloudflare-deploy',
      'preview:cloudflare'
    ]) {
      const script = manifest.scripts[scriptName]
      assert.doesNotMatch(script, /pnpm dlx wrangler/)
      assert.match(script, /pnpm exec wrangler/)
    }
  })

  test('allows build scripts required by the local Wrangler toolchain', () => {
    assert.match(workspace, /^\s{2}sharp: true$/m)
    assert.match(workspace, /^\s{2}workerd: true$/m)
  })
})
