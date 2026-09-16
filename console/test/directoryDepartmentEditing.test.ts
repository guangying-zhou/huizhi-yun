import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const page = readFileSync(
  new URL('../app/pages/directory/departments.vue', import.meta.url),
  'utf8'
)

test('department editing uses valid select values and sends only changed fields', () => {
  assert.doesNotMatch(page, /\{ label: '(?:未分类|无父级)', value: '' \}/)
  assert.match(page, /function departmentChanges\(\)/)

  const submit = page.slice(
    page.indexOf('async function submitDepartment()'),
    page.indexOf('async function deleteDepartment(')
  )
  assert.match(submit, /modalMode\.value === 'create'\s*\? departmentPayload\(\)\s*:\s*departmentChanges\(\)/)
  assert.match(submit, /method: 'PATCH'[\s\S]*body: payload/)
})
