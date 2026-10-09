import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { usePeopleFormat } from '../app/composables/usePeopleFormat.ts'

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

describe('People production-facing presentation', () => {
  test('localizes persisted enum values shown in operational tables', () => {
    const { label } = usePeopleFormat()

    assert.equal(label('none'), '无需审批')
    assert.equal(label('full_time'), '全职')
    assert.equal(label('quarter'), '季度')
    assert.equal(label('org'), '组织')
    assert.equal(label('standard_rate'), '职级标准')
  })

  test('hides empty date sentinels instead of presenting epoch dates as employee facts', () => {
    const { date } = usePeopleFormat()

    assert.equal(date(null), '-')
    assert.equal(date('0000-00-00'), '-')
    assert.equal(date('1970-01-01 00:00:00'), '-')
    assert.equal(date('2026-08-27 12:30:00'), '2026-08-27')
  })

  test('list routes render their loading state without blocking navigation', () => {
    for (const path of [
      '../app/pages/index.vue',
      '../app/pages/employees/index.vue',
      '../app/pages/assignments.vue',
      '../app/pages/offboarding-cases/index.vue',
      '../app/pages/cost-snapshots.vue',
      '../app/pages/performance-cycles/index.vue',
      '../app/pages/settings/positions.vue',
      '../app/pages/settings/ranks.vue',
      '../app/pages/settings/standard-costs.vue'
    ]) {
      assert.match(source(path), /await useLazyFetch/)
    }
  })

  test('employee details defer rank settings until an adjustment needs them', () => {
    const detail = source('../app/pages/employees/[uid].vue')

    assert.match(detail, /standardCostResponse[\s\S]{0,260}immediate:\s*false/)
    assert.match(detail, /await refreshStandardCosts\(\)/)
    assert.match(detail, /title="暂无项目贡献"/)
    assert.match(detail, /title="暂无参与的绩效周期"/)
    assert.match(detail, /title="暂无关联文档"/)
  })

  test('mobile employee empty states stay inside the visible table width', () => {
    const employees = source('../app/pages/employees/index.vue')

    assert.match(employees, /v-else-if="rows\.length === 0"/)
    assert.match(employees, /v-else[\s\S]{0,120}:data="rows"/)
    assert.match(employees, /class="min-w-\[1120px\]"/)
  })

  test('assignment risk action does not claim a conflict before evaluation', () => {
    const assignments = source('../app/pages/assignments.vue')

    assert.match(assignments, />\s*检查\s*<\/UButton>/)
    assert.doesNotMatch(assignments, />\s*冲突\s*<\/UButton>/)
  })
})
