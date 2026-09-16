import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(
  new URL('../app/layouts/default.vue', import.meta.url),
  'utf8'
)

test('workspace and Console landing pages use the seamless top header', () => {
  assert.match(
    source,
    /seamlessLandingHeader = computed\(\(\) => route\.path === '\/' \|\| route\.path === '\/admin'\)/
  )
  assert.match(source, /:hide-page-title="seamlessLandingHeader"/)
  assert.match(source, /:seamless-top-header="seamlessLandingHeader"/)
})
