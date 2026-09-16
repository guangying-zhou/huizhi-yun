import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const page = readFileSync(new URL('../app/pages/products/[productCode]/versions/[versionId]/plan.vue', import.meta.url), 'utf8')

test('lightweight plan re-reads the current plan after each mutation', () => {
  assert.match(page, /async function refreshAll\(force = false\)[\s\S]*busy\.value && !force/)
  // A write leaves busy=true until finally; these force reads keep revisions and displayed values current.
  assert.ok((page.match(/await refreshAll\(true\)/g) || []).length >= 5)
})

test('unadopted demand requires an explicit adoption decision before it can enter a version', () => {
  assert.match(page, /function canAddRequest[\s\S]*\['submitted', 'evaluating'\]/)
  assert.match(page, /v-model="addDraft\.adoptRequest"/)
  assert.match(page, /adoptRequest: addDraft\.adoptRequest/)
  assert.match(page, /!addDraft\.adoptRequest/)
})
