import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { test } from 'node:test'

const root = resolve(import.meta.dirname, '..')
const read = (file: string) => readFileSync(resolve(root, file), 'utf8')

test('Aims document-quality service routes use exact identities, capabilities, and source-bound commands', () => {
  const policy = read('server/lib/serviceAuthPolicy.ts')
  const helper = read('server/utils/projectDocumentQualityService.ts')
  const resolveRoute = read('server/api/v1/service/project-documents/[uuid]/versions/[versionId]:resolve.post.ts')
  const contentRoute = read('server/api/v1/service/project-documents/[uuid]/versions/[versionId]/review-content.post.ts')
  const grantRoute = read('server/api/v1/service/project-document-review-grants.post.ts')

  for (const scope of [
    'codocs:project-document:version:resolve',
    'codocs:project-document:review-content:read',
    'codocs:project-document:review-grant:create'
  ]) {
    assert.ok(policy.includes(scope))
  }
  assert.match(policy, /allowedApps: \['aims'\]/)
  assert.match(policy, /allowedClientCodes: \['aims\.runtime'\]/)
  assert.match(policy, /exactScope: true/)
  assert.ok(helper.indexOf('requireConsoleAuthContext') < helper.indexOf('readBody<'))
  assert.match(helper, /requireCodocsServiceTenantDeploymentBinding/)
  assert.match(helper, /verifyServiceCommandRuntimeHeaders/)
  assert.match(helper, /sourceApp: 'aims'/)
  assert.match(helper, /sourceClientId: 'aims\.runtime'/)
  assert.match(helper, /envelope\.commandSha256 !== commandSha256/)
  assert.match(resolveRoute, /version:resolve/)
  assert.match(contentRoute, /review-content:read/)
  assert.match(contentRoute, /readReviewVersionContent/)
  assert.match(grantRoute, /review-grant:create/)
})

test('deterministic review content is bound to an immutable version, grant, and SHA-256', () => {
  const helper = read('server/utils/projectDocumentQualityService.ts')
  const runtime = read('../data-runtime/internal/apps/codocs/project_document_quality_service.go')
  const schema = read('docs/codocs_schema.sql')
  const migration = read('docs/migration_v1.5_document_quality_review.sql')

  assert.match(runtime, /a\.documentAccess\(ctx, uuid, query\)/)
  assert.match(runtime, /document_review_grants/)
  assert.match(runtime, /grantee_role_code/)
  assert.match(runtime, /oss_version_id/)
  assert.match(runtime, /content_sha256/)
  assert.match(runtime, /validProjectDocumentSHA256/)
  assert.match(helper, /versionId: grant\.ossVersionId/)
  assert.match(helper, /createHash\('sha256'\)/)
  assert.match(helper, /actualHash !== grant\.contentSha256/)
  assert.match(schema, /`content_sha256` CHAR\(64\)/)
  assert.match(schema, /CREATE TABLE `document_review_grants`/)
  assert.match(migration, /document_review_grants/)
})
