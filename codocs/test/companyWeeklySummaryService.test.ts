import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = join(import.meta.dirname, '..')
const workspace = join(root, '..')
const source = (path: string) => readFileSync(join(root, path), 'utf8')
const workspaceSource = (path: string) => readFileSync(join(workspace, path), 'utf8')

test('Codocs verifies the exact Aims summary command before object storage and runtime mutation', () => {
  const service = source('server/utils/companyWeeklySummaryService.ts')
  const route = source('server/api/v1/service/company-weekly-summaries/[summaryCommand].post.ts')
  const policy = source('server/lib/serviceAuthPolicy.ts')

  assert.match(policy, /codocs:company-weekly-summary:publish/)
  assert.match(policy, /allowedClientCodes: \['aims\.runtime'\]/)
  assert.match(service, /verifyServiceCommandRuntimeHeaders/)
  assert.match(service, /requireCodocsCrossAppServiceTenantDeploymentBinding/)
  assert.match(service, /sourceDeploymentCode: binding\.sourceDeployment/)
  assert.match(service, /targetDeploymentCode: binding\.targetDeployment/)
  assert.match(service, /actualMarkdownHash !== command\.markdownSha256/)
  assert.ok(service.indexOf('verifyServiceCommandRuntimeHeaders') < service.indexOf('uploadDocument'))
  assert.match(route, /publishAimsCompanyWeeklySummary/)
})

test('Codocs runtime stores one read-only company document with version and receipt evidence', () => {
  const runtime = workspaceSource('data-runtime/internal/apps/codocs/company_weekly_summary_service.go')
  const adapter = workspaceSource('data-runtime/internal/apps/codocs/adapter.go')

  assert.match(runtime, /NewReceiptRepository/)
  assert.match(runtime, /readonly_flag/)
  assert.match(runtime, /document_versions/)
  assert.match(runtime, /document_shares/)
  assert.match(runtime, /aims_company_weekly_summary/)
  assert.match(adapter, /service_command_receipt/)
})
