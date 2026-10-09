import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('project leader department membership', () => {
  test('project creation loads candidates from authoritative department memberships', () => {
    const page = source('app/pages/projects/new.vue')

    assert.match(page, /\/api\/directory\/users/)
    assert.match(page, /dept_code:\s*deptCode/)
    assert.match(page, /departmentUsers\.value/)
    assert.doesNotMatch(page, /u\.deptCode === deptCode/)
  })
})
