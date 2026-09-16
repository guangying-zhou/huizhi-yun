import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('requirement baseline repair', () => {
  test('adopts a legacy requirement target before inserting a missing baseline', () => {
    const migration = source('docs/migration_v5.12_requirement_baseline_repair.sql')

    assert.match(migration, /p\.category IN \('product_dev', 'custom_dev'\)/)
    assert.match(migration, /p\.lifecycle_status IN \('draft', 'approval_pending', 'active', 'paused'\)/)
    assert.match(migration, /JSON_EXTRACT\(p\.module_config, '\$\.requirements'\)/)
    assert.match(migration, /candidate\.pivr_stage = 'I'/)
    assert.match(migration, /candidate\.completion_lock_request_id IS NULL/)
    assert.match(migration, /legacy\.tier = 'target'[\s\S]*legacy\.type = 'requirement'/)
    assert.match(migration, /legacy_milestone\.pivr_stage = 'I'/)
    assert.match(migration, /legacy_milestone\.completion_lock_request_id IS NULL/)
    assert.match(migration, /ROW_NUMBER\(\) OVER[\s\S]*legacy\.sort_order ASC/)
    assert.match(migration, /UPDATE `work_items` legacy[\s\S]*legacy\.template_key = 'requirement_baseline'/)
    assert.match(migration, /NOT EXISTS \([\s\S]*baseline\.template_key = 'requirement_baseline'/)
    assert.match(migration, /'requirement_baseline'/)
    assert.match(migration, /CONCAT\([\s\S]*p\.project_code[\s\S]*MAX\(existing\.item_number\)/)
    assert.match(migration, /ON DUPLICATE KEY UPDATE[\s\S]*GREATEST/)
    assert.match(migration, /remaining_projects_without_requirement_baseline/)
  })

  test('shows an actionable configuration message when no baseline target exists', () => {
    const page = source('app/pages/projects/[id]/requirements/index.vue')

    assert.match(page, /v-if="requirementTargets\.length === 0"/)
    assert.match(page, /当前项目未配置需求基线，请联系模板管理员检查项目模板/)
    assert.match(page, /v-else[\s\S]*请点击上方"导入规格书"按钮开始/)
  })
})
