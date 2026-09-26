import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';const read=p=>readFileSync(new URL(p,import.meta.url),'utf8')
import { assertMigratedPage } from './helpers/migrated-page.mjs'
test('hosted legacy target creation and breakdown send the enterprise write contract', () => {
  const target = read('../../aims/app/pages/projects/[id]/work-items.vue')
  const breakdown = read('../../aims/app/pages/projects/[id]/work-items/[workItemId]/breakdown.vue')
  assert.match(target, /delete createPayload\.routineScope/)
  assert.match(target, /delete createPayload\.beneficiaryDeptCode/)
  assert.match(target, /delete createPayload\.isUnplanned/)
  assert.match(target, /createRetry\?\.payload !== payload/)
  assert.match(target, /'Idempotency-Key': createRetry\.key/)
  assert.match(target, /response\.data\?\.result\?\.id/)
  assert.match(breakdown, /breakdownVersion\.value = detailRes\?\.data\?\.editVersion/)
  assert.match(breakdown, /projectId: projectId\.value, expectedVersion: breakdownVersion\.value, subtasks/)
  assert.match(breakdown, /'Idempotency-Key': breakdownRetry!\.key/)
})
test('basic edits do not mount status structural or version writes',()=>{const bff=read('../server/utils/enterpriseAimsWorkItemWrite.ts'),page=read('../../aims/layer/pages/enterprise-work-item-form.vue');assert.match(bff,/Idempotency-Key/);assert.match(bff,/expectedVersion/);assert.match(page,/状态流转、类型层级调整、父子结构与里程碑移动/);assert.doesNotMatch(page,/v-model="form\.(?:status|versionId|featureId|parentId)"/)})
test('version associations use an exact capability and project-scoped choices',()=>{const page=read('../../aims/layer/pages/enterprise-work-item-association.vue'),domain=read('../../data-runtime/internal/apps/aims/enterprise_work_item_association.go');assert.match(page,/associationOptions/);assert.match(page,/Idempotency-Key/);assert.match(page,/expectedVersion/);assert.match(domain,/prepareWorkItemVersionFieldsUpdate/);assert.match(domain,/FOR UPDATE/);assert.match(domain,/app\.project_id=wi\.project_id/);assert.doesNotMatch(page,/UInput.*versionId/)})
test('work item deletion keeps its own permission, frozen version evidence and thin route',()=>{const bff=read('../server/utils/enterpriseAimsWorkItemWrite.ts'),route=read('../server/routes/aims/api/v1/work-items/[id].delete.ts'),foundation=read('../../foundation/server/utils/enterpriseRuntimeClient.ts'),domain=read('../../data-runtime/internal/apps/aims/enterprise_work_item_delete.go'),dispatch=read('../../data-runtime/internal/server/enterprise_work_item_write.go')
assert.match(route,/enterpriseAimsWorkItemWrite\(event, 'delete'\)/);assert.ok(route.split('\n').filter(line=>line.trim()).length<=2)
assert.match(bff,/action === 'delete' \? 'delete'/)
assert.match(bff,/\['complete', 'matter-complete', 'delete', 'plan-ready'/)
assert.match(bff,/new Set\(\['expectedVersion'\]\)/)
assert.match(foundation,/'aims\.work-item-delete': \{ path: '\/v1\/enterprise\/aims\/work-items:delete'/)
assert.match(dispatch,/"\/v1\/enterprise\/aims\/work-items:delete": "delete"/);assert.match(dispatch,/DeleteEnterpriseWorkItem\(r\.Context\(\), identity, input\.ProjectID, input\.WorkItemID, input\.Input\)/)
assert.match(dispatch,/action == "delete" \{\n\t\tcapability = aimsapp\.EnterpriseWorkItemDeleteCapability/)
assert.match(domain,/work_item_deletion_evidence/);assert.match(domain,/EnterpriseWorkItemDeleteCapability = "aims:work-item-delete:execute"/)})
test('plan-ready has a distinct exact capability and only appears for eligible V2 targets', () => {
  const route = read('../server/routes/aims/api/v1/work-items/[id]/plan-ready.post.ts')
  const foundation = read('../../foundation/server/utils/enterpriseRuntimeClient.ts')
  const domain = read('../../data-runtime/internal/apps/aims/enterprise_work_item_state.go')
  const page = read('../../aims/layer/pages/enterprise-work-item-detail.vue')
  assert.match(route, /enterpriseAimsWorkItemWrite\(event, 'plan-ready'\)/)
  assert.match(foundation, /'aims\.work-item-plan-ready': \{ path: '\/v1\/enterprise\/aims\/work-items:plan-ready', capability: 'aims:work-item-plan-ready:execute' \}/)
  assert.match(domain, /return "decompose"/)
  assert.match(domain, /requireEnterpriseProjectManagerTx\(ctx, tx, id, projectID, leader\)/)
  assert.match(domain, /targetPlanReadyTx\(ctx, tx, itemID\)/)
  assert.match(page, /stateActions as string\[\] \|\| \[\]/)
})
test('task distribution confirm and revoke use their own capability, confirm permission and thin routes', () => {
  const bff = read('../server/utils/enterpriseAimsWorkItemWrite.ts')
  const foundation = read('../../foundation/server/utils/enterpriseRuntimeClient.ts')
  const domain = read('../../data-runtime/internal/apps/aims/enterprise_work_item_distribution.go')
  const dispatch = read('../../data-runtime/internal/server/enterprise_work_item_write.go')
  for (const action of ['confirm-distribute', 'revoke-distribute', 'confirm-append', 'reject-append']) {
    const route = read(`../server/routes/aims/api/v1/work-items/[id]/${action}.post.ts`)
    assert.match(route, new RegExp(`enterpriseAimsWorkItemWrite\\(event, '${action}'\\)`))
    assert.ok(route.split('\n').filter(line => line.trim()).length <= 2)
  }
  assert.match(bff, /\['confirm-distribute', 'confirm-append', 'reject-append'\]\.includes\(action\) \? 'confirm' : 'edit'/)
  assert.match(foundation, /'aims\.work-item-confirm-distribute': \{ path: '\/v1\/enterprise\/aims\/work-items:confirm-distribute', capability: 'aims:work-item-distribute-confirm:execute' \}/)
  assert.match(foundation, /'aims\.work-item-revoke-distribute': \{ path: '\/v1\/enterprise\/aims\/work-items:revoke-distribute', capability: 'aims:work-item-distribute-revoke:execute' \}/)
  assert.match(dispatch, /action == "confirm-distribute" \|\| action == "confirm-append" \|\| action == "reject-append" \{\n\t\taction = "confirm"/)
  assert.match(foundation, /'aims\.work-item-confirm-append': \{ path: '\/v1\/enterprise\/aims\/work-items:confirm-append', capability: 'aims:work-item-append-confirm:execute' \}/)
  assert.match(foundation, /'aims\.work-item-reject-append': \{ path: '\/v1\/enterprise\/aims\/work-items:reject-append', capability: 'aims:work-item-append-reject:execute' \}/)
  assert.match(domain, /UPDATE deliverables SET matter_id=NULL WHERE matter_id=\? AND target_id IS NOT NULL/)
  assert.match(dispatch, /DistributeEnterpriseWorkItem\(r\.Context\(\), identity, input\.ProjectID, input\.WorkItemID, action, input\.Input\)/)
  assert.match(domain, /FOR UPDATE/)
  // Revoke shares the legacy project-manager rule with append-tasks.
  assert.match(domain, /requireEnterpriseProjectManagerTx\(ctx, tx, id, projectID, leader\)/)
  assert.match(read('../../data-runtime/internal/apps/aims/enterprise_work_item_append_tasks.go'), /work_item_distribution_manager_required/)
  assert.match(domain, /requireEnterpriseWorkItemReviewUnlockedTx/)
})
test('appending tasks uses its own capability, an edit permit, a closed body and the manager rule', () => {
  const bff = read('../server/utils/enterpriseAimsWorkItemWrite.ts')
  const route = read('../server/routes/aims/api/v1/work-items/[id]/append-tasks.post.ts')
  const foundation = read('../../foundation/server/utils/enterpriseRuntimeClient.ts')
  const domain = read('../../data-runtime/internal/apps/aims/enterprise_work_item_append_tasks.go')
  const dispatch = read('../../data-runtime/internal/server/enterprise_work_item_write.go')
  assert.match(route, /enterpriseAimsWorkItemWrite\(event, 'append-tasks'\)/)
  assert.ok(route.split('\n').filter(line => line.trim()).length <= 2)
  assert.match(bff, /\['append-tasks', 'breakdown'\]\.includes\(action\) \? new Set\(\['expectedVersion', 'subtasks'\]\)/)
  assert.match(foundation, /'aims\.work-item-append-tasks': \{ path: '\/v1\/enterprise\/aims\/work-items:append-tasks', capability: 'aims:work-item-append-tasks:execute' \}/)
  assert.match(dispatch, /action == "revoke-distribute" \|\| action == "append-tasks" \|\| action == "breakdown" \{\n\t\taction = "edit"/)
  assert.match(dispatch, /AppendEnterpriseWorkItemTasks\(r\.Context\(\), identity, input\.ProjectID, input\.WorkItemID, input\.Input\)/)
  assert.match(domain, /requireEnterpriseProjectManagerTx/)
  // Assignee membership is shared with breakdown save through one helper.
  assert.match(domain, /requireEnterpriseProjectAssigneesTx\(ctx, tx, projectID, leader, subtasks, "追加任务"\)/)
  assert.match(read('../../data-runtime/internal/apps/aims/enterprise_work_item_breakdown.go'), /work_item_assignee_not_member/)
  assert.match(domain, /FOR UPDATE/)
})
test('saving a breakdown uses its own capability, a PUT route, an edit permit and the legacy coverage rules', () => {
  const route = read('../server/routes/aims/api/v1/work-items/[id]/breakdown.put.ts')
  const foundation = read('../../foundation/server/utils/enterpriseRuntimeClient.ts')
  const domain = read('../../data-runtime/internal/apps/aims/enterprise_work_item_breakdown.go')
  const dispatch = read('../../data-runtime/internal/server/enterprise_work_item_write.go')
  assert.match(route, /enterpriseAimsWorkItemWrite\(event, 'breakdown'\)/)
  assert.ok(route.split('\n').filter(line => line.trim()).length <= 2)
  assert.match(foundation, /'aims\.work-item-breakdown': \{ path: '\/v1\/enterprise\/aims\/work-items:breakdown', capability: 'aims:work-item-breakdown:execute' \}/)
  assert.match(dispatch, /action == "revoke-distribute" \|\| action == "append-tasks" \|\| action == "breakdown" \{\n\t\taction = "edit"/)
  assert.match(dispatch, /SaveEnterpriseWorkItemBreakdown\(r\.Context\(\), identity, input\.ProjectID, input\.WorkItemID, input\.Input\)/)
  for (const code of ['targets_uncovered', 'targets_duplicated', 'distribution_locked', 'work_item_breakdown_child_mismatch', 'hours_exceeded']) {
    assert.match(domain, new RegExp(code))
  }
  assert.match(domain, /requireEnterpriseProjectManagerTx/)
  assert.match(domain, /requireEnterpriseProjectAssigneesTx/)
})
test('task distribution serves the original Aims page at the project-scoped path',()=>{
  // 原断言锁的是薄改写页（/work-items/:id/breakdown）。该路径与原页面不一致，
  // append.vue 与工作项列表都跳 /projects/:id/work-items/:workItemId/breakdown，
  // 回归实测 404 —— 现改为注册原页面到同一路径形状。
  assertMigratedPage({
    route: '/projects/:id/work-items/:workItemId/breakdown',
    name: 'project-work-item-breakdown',
    source: 'projects/[id]/work-items/[workItemId]/breakdown'
  })
  const entry=read('../../aims/layer/entry.mjs')
  assert.doesNotMatch(entry,/layerPage\('\/work-items\/:id\/breakdown'/)

  // 写动作仍走宿主 BFF 的精确 capability，而不是页面层限制
  const helper=read('../server/utils/enterpriseAimsWorkItems.ts')
  const foundation=read('../../foundation/server/utils/enterpriseRuntimeClient.ts')
  assert.match(helper,/'aims\.work-item-breakdown-context'/)
  assert.match(foundation,/'aims\.work-item-breakdown': \{ path: '\/v1\/enterprise\/aims\/work-items:breakdown'/)
})
