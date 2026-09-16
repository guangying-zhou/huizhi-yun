import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const root = resolve(import.meta.dirname, '..')
const read = (file: string) => readFileSync(resolve(root, file), 'utf8')

test('repo document deliverables freeze and review the bound commit instead of silently ignoring submit QA', () => {
  const output = read('app/pages/projects/[id]/output.vue')
  const submitRoute = read('server/api/v1/deliverables/[deliverableId]/submissions.post.ts')
  const contentRoute = read('server/api/v1/quality-reviews/[submissionId]/content.get.ts')
  const reviewPage = read('app/pages/quality-reviews.vue')
  const middleware = read('server/middleware/tenant-runtime.ts')
  const runtime = read('../data-runtime/internal/apps/aims/deliverable_quality.go')

  assert.doesNotMatch(output, /if \(!deliverable\.documentUuid\) return/)
  assert.match(output, /canPreviewDeliverableDocument\(deliverable\)/)
  assert.match(submitRoute, /getGitRepositoryFile/)
  assert.match(submitRoute, /Promise\.all\([\s\S]*resolveDocumentSnapshot\(\)[\s\S]*resolveProjectGovernanceRoleHolder/)
  assert.match(submitRoute, /commitId: repoCommitId/)
  assert.match(submitRoute, /createHash\('sha256'\)/)
  assert.match(submitRoute, /current_user_repository_review_snapshot_resolved/)
  assert.match(contentRoute, /item\.documentSource === 'repo'/)
  assert.match(contentRoute, /contentSha256 !== item\.contentSha256/)
  assert.match(reviewPage, /仓库 @/)
  assert.match(runtime, /aims\.deliverable-submission\.evidence\.v2/)
  assert.match(runtime, /deliverable_repo_binding_mismatch/)
  assert.match(runtime, /trusted_repository_review_snapshot_required/)
  assert.match(runtime, /JSON_EXTRACT\(submission\.evidence_snapshot_json, '\$\.repoCommitId'\)/)
  assert.match(middleware, /delete sanitizedQuery\.current_user_repository_review_snapshot_resolved/)
})
