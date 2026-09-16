import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'

const config = readFileSync(new URL('../nuxt.config.ts', import.meta.url), 'utf8')

test('Console keeps the final Nuxt Icon provider on its own Nitro server', () => {
  assert.match(config, /icon:\s*\{[\s\S]*?provider:\s*'server'/)
  assert.match(config, /fallbackToApi:\s*false/)
})
