import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const config = readFileSync(join(root, 'nuxt.config.ts'), 'utf8')

test('Finance exposes its packaged logo to the Console application shell', () => {
  assert.match(
    config,
    /appLogo:\s*process\.env\.NUXT_PUBLIC_APP_LOGO\s*\|\|\s*withAppBase\('\/logo\.png'\)/
  )
  assert.equal(existsSync(join(root, 'public', 'logo.png')), true)
})
