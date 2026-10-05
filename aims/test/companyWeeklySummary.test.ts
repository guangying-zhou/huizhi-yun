import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = join(import.meta.dirname, '..')
const workspace = join(root, '..')
const source = (path: string) => readFileSync(join(root, path), 'utf8')
const workspaceSource = (path: string) => readFileSync(join(workspace, path), 'utf8')

test('company weekly summary uses immutable versions and a mutable draft only on the aggregate', () => {
  const schema = source('docs/aims_schema.sql')
  const migration = source('docs/migration_v5.11_company_weekly_summary_draft.sql')
  const runtime = workspaceSource('data-runtime/internal/apps/aims/company_weekly_summary_governance.go')

  assert.match(schema, /company_weekly_summary_versions/)
  assert.match(schema, /draft_content_json/)
  assert.match(migration, /information_schema\.columns/)
  assert.match(runtime, /structured_snapshot_json/)
  assert.match(runtime, /markdown_content/)
  assert.match(runtime, /current_frozen_version_id/)
  assert.match(runtime, /approved_summary_version_id/)
  assert.match(runtime, /project_management_fact_snapshots/)
})

test('company weekly summary publish is source-owned, reliable, and Codocs-bound', () => {
  const executor = source('server/utils/companyWeeklySummaryOperationExecutor.ts')
  const dispatcher = source('server/utils/serviceTicketDeliveryOperation.ts')
  const route = source('server/api/v1/company-weekly-summaries/[summaryCommand].post.ts')
  const recipients = source('server/utils/companyWeeklySummaryRecipients.ts')

  assert.match(executor, /aims\.company-weekly-summary\.codocs-publish\.v1/)
  assert.match(executor, /company-weekly-summary-versions/)
  assert.match(executor, /validateServiceCommandReceipt/)
  assert.match(dispatcher, /codocs:company-weekly-summary:publish/)
  assert.match(route, /company_summary_recipient_resolution_verified/)
  assert.match(recipients, /projection|departments/)
  assert.match(recipients, /coveredSelectionKeys/)
})

test('project director UI exposes draft, selection, publish, correction and version history', () => {
  const panel = source('app/components/CompanyWeeklySummaryPanel.vue')
  const page = source('app/pages/weekly-reports.vue')

  assert.match(panel, /纳入项目周报/)
  assert.match(panel, /抄送范围/)
  assert.match(panel, /发布并存档/)
  assert.match(panel, /创建更正草稿/)
  assert.match(panel, /发布版本/)
  assert.match(page, /CompanyWeeklySummaryPanel/)
})
