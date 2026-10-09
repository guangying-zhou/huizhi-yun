import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, test } from 'node:test'

async function source(path: string) {
  return readFile(new URL(path, import.meta.url), 'utf8')
}

describe('PIVR V1.1 implementation contract', () => {
  test('incremental migrations and fresh schema expose the same B2/B3/B4 facts', async () => {
    const [serviceMigration, closeMigration, opportunityMigration, routineLifecycleMigration, routineTaskMigration, schema] = await Promise.all([
      source('../docs/migration_v5.14_service_year_and_routine.sql'),
      source('../docs/migration_v5.15_period_close_gate.sql'),
      source('../docs/migration_v5.16_opportunity_project_bridge.sql'),
      source('../docs/migration_v5.17_routine_no_initiation.sql'),
      source('../docs/migration_v5.18_routine_flat_tasks.sql'),
      source('../docs/aims_schema.sql')
    ])

    for (const column of [
      'service_line_code', 'service_period_seq', 'service_period_start', 'service_period_end', 'service_period_label',
      'routine_scope', 'beneficiary_dept_code', 'is_unplanned'
    ]) {
      assert.match(serviceMigration, new RegExp(`COLUMN_NAME = '${column}'`))
      assert.ok(schema.includes(`\`${column}\``), `fresh schema is missing ${column}`)
    }
    assert.match(serviceMigration, /REFERENTIAL_CONSTRAINTS[^]*fk_item_project_milestone/)

    for (const column of [
      'gate_result', 'gate_passed', 'exception_reason', 'exception_owner_uid', 'exception_due_date',
      'confirmed_by', 'confirmed_at', 'sla_snapshot', 'period_cost', 'carryover_origin_item_key',
      'carryover_origin_milestone_id', 'carryover_count', 'carryover_governance_abnormal'
    ]) {
      assert.match(closeMigration, new RegExp(`COLUMN_NAME = '${column}'`))
      assert.ok(schema.includes(`\`${column}\``), `fresh schema is missing ${column}`)
    }

    assert.match(opportunityMigration, /UNIQUE KEY `uk_aims_project_opportunity_category` \(`opp_id`, `category`\)/)
    assert.match(schema, /UNIQUE KEY `uk_aims_project_opportunity_category` \(`opp_id`, `category`\)/)
    assert.match(routineLifecycleMigration, /`category` = 'routine'/)
    assert.match(routineLifecycleMigration, /`lifecycle_status` = 'active'/)
    assert.match(routineLifecycleMigration, /`approval_status` = 'not_required'/)
    assert.match(routineLifecycleMigration, /aims\.migration\.v5\.17/)
    assert.match(routineTaskMigration, /wi\.`type` = 'task'/)
    assert.match(routineTaskMigration, /wi\.`tier` = 'matter'/)
    assert.match(routineTaskMigration, /wi\.`milestone_id` = NULL/)
  })

  test('frontend wires service-year, routine-review, close-gate, health and service-line views', async () => {
    const [newPage, createModal, workItems, board, routineCreateModal, navbar, overview] = await Promise.all([
      source('../app/pages/projects/new.vue'),
      source('../app/components/project/ProjectCreateModal.vue'),
      source('../app/pages/projects/[id]/work-items.vue'),
      source('../app/pages/projects/[id]/board.vue'),
      source('../app/components/routine/RoutineTaskCreateModal.vue'),
      source('../app/components/project/ProjectNavbar.vue'),
      source('../app/pages/projects/[id]/index.vue')
    ])

    for (const createSource of [newPage, createModal]) {
      assert.match(createSource, /validateServiceYear/)
      assert.match(createSource, /serviceLineCode/)
      assert.match(createSource, /servicePeriodLabel/)
    }
    // 跳转统一经 moduleUrl（非宿主模式原样返回路径），断言的仍是"跳到本项目看板"。
    assert.match(workItems, /navigateTo\(moduleUrl\(`\/projects\/\$\{projectId\.value\}\/board`\)/)
    assert.match(board, /RoutineQuarterReview/)
    assert.match(board, /RoutineTaskCreateModal/)
    assert.match(routineCreateModal, /type: 'task'/)
    assert.match(routineCreateModal, /tier: 'matter'/)
    assert.match(routineCreateModal, /routineScope === 'cross_dept'/)
    assert.doesNotMatch(routineCreateModal, /label="类型"/)
    assert.match(navbar, /category === 'routine'[^]*\/board/)
    assert.match(overview, /ProjectServiceLineHistory/)
    assert.match(overview, /ProjectServiceHealthPanel/)
    assert.match(overview, /ProjectPeriodClosePanel/)
  })

  test('BFF exposes user views and guards the opportunity bridge with the exact capability', async () => {
    const middleware = await source('../server/middleware/tenant-runtime.ts')
    for (const route of ['service-lines', 'routine-review', 'service-health', 'close-gate']) {
      assert.match(middleware, new RegExp(route))
    }
    assert.match(middleware, /milestones[^\n]+:close/)
    assert.match(middleware, /aims:project:create-from-opportunity', allowedApps: \['altoc'\]/)
  })
})
