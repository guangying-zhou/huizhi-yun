import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = fileURLToPath(new URL('..', import.meta.url))
const page = readFileSync(new URL('app/pages/integrations.vue', `file://${root}/`), 'utf8')

test('integration updates omit immutable identity fields from PATCH requests', () => {
  const saveBlock = page.slice(
    page.indexOf('async function saveIntegration()'),
    page.indexOf('async function bindSelectedVersion()')
  )

  assert.match(
    saveBlock,
    /integrationCode:\s*_integrationCode,[\s\S]*integrationType:\s*_integrationType,[\s\S]*\.\.\.updateBody/
  )
  assert.match(saveBlock, /method:\s*'PATCH'[\s\S]*body:\s*updateBody/)
})
