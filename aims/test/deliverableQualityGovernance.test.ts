import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const root = resolve(import.meta.dirname, '..')
const read = (file: string) => readFileSync(resolve(root, file), 'utf8')

test('document submission freezes a Codocs version and retries the grant/activation saga safely', () => {
  const route = read('server/api/v1/deliverables/[deliverableId]/submissions.post.ts')
  const codocs = read('server/utils/codocsApi.ts')
  const runtime = read('../data-runtime/internal/apps/aims/deliverable_quality.go')

  assert.ok(route.indexOf('getRequestUid(event)') < route.indexOf('readBody<'))
  assert.match(route, /buildAimsProjectListRuntimeAccessQuery/)
  assert.match(route, /resolveCodocsProjectDocumentVersion/)
  assert.match(route, /documentVersionId === undefined[\s\S]*'latest'/)
  assert.match(route, /contentSha256: resolvedVersion\.contentSha256/)
  assert.match(route, /createCodocsProjectDocumentReviewGrant/)
  assert.match(route, /:activate-review/)
  assert.match(codocs, /codocs:project-document:version:resolve/)
  assert.match(codocs, /codocs:project-document:review-grant:create/)
  assert.match(runtime, /ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID\(id\)/)
  assert.match(runtime, /status = 'awaiting_review'/)
  assert.match(runtime, /current_submission_id = \?/)
})

test('quality review uses immutable checklist snapshots and routes QA self-submission away from QA', () => {
  const runtime = read('../data-runtime/internal/apps/aims/deliverable_quality.go')
  const middleware = read('server/middleware/tenant-runtime.ts')
  const page = read('app/pages/quality-reviews.vue')
  const output = read('app/pages/projects/[id]/output.vue')
  const schema = read('docs/aims_schema.sql')

  assert.match(runtime, /PROJECT_DOCUMENT_STANDARD/)
  assert.match(runtime, /route := "qa"[\s\S]*route = "pm_completeness_then_director_quality"/)
  assert.match(runtime, /stage = "director_quality"/)
  assert.match(runtime, /pm_completeness_required/)
  assert.match(runtime, /quality_review_stage_already_passed/)
  assert.match(runtime, /result_sha256/)
  assert.match(middleware, /current_user_is_qa/)
  assert.match(middleware, /current_user_is_project_director/)
  assert.match(middleware, /if \(completenessPath\) return/)
  assert.match(page, /确定版本质量检查/)
  assert.match(page, /checklistResults/)
  assert.match(output, /confirm-completeness/)
  assert.match(output, /确认齐全并转项目总监/)
  assert.match(output, /currentCompletenessPassed/)
  assert.match(output, /!row\.original\.original\.currentCompletenessPassed/)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS `qa_checklist_versions`/)
  assert.match(schema, /CREATE TABLE IF NOT EXISTS `deliverable_quality_reviews`/)
})

test('quality browser flags are removed and rebuilt by the Aims BFF', () => {
  const middleware = read('server/middleware/tenant-runtime.ts')

  for (const flag of [
    'current_user_document_version_resolved',
    'current_user_document_review_grant_created',
    'current_user_repository_review_snapshot_resolved',
    'current_user_can_review_quality_reviews',
    'current_user_can_configure_quality_reviews',
    'current_user_can_waive_quality_reviews',
    'current_user_is_qa',
    'current_user_qa_revision'
  ]) {
    assert.match(middleware, new RegExp(`delete sanitizedQuery\\.${flag}`))
  }
  assert.match(middleware, /requireCurrentProjectGovernanceRoleHolder\(context\.event, 'qa'/)
  assert.match(middleware, /resolveProjectGovernanceRoleHolder\(context\.event, 'project_director'\)/)
})
