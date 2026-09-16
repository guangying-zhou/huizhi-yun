import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

const middleware = readFileSync(
  new URL('../server/middleware/tenant-runtime.ts', import.meta.url),
  'utf8'
)
const manifest = JSON.parse(
  readFileSync(new URL('../app.manifest.json', import.meta.url), 'utf8')
) as {
  recommendedRoles: Array<{ code: string, suggestedPermissions?: string[] }>
}
const migration = readFileSync(
  new URL('../docs/migration_v5.6_project_governance.sql', import.meta.url),
  'utf8'
)
const migrationVerification = readFileSync(
  new URL('../docs/migration_v5.6_project_governance_verify.sql', import.meta.url),
  'utf8'
)
const schema = readFileSync(
  new URL('../docs/aims_schema.sql', import.meta.url),
  'utf8'
)
const managerContractMigration = readFileSync(
  new URL('../docs/migration_v5.7_project_manager_contract.sql', import.meta.url),
  'utf8'
)
const runtimeResponsibility = readFileSync(
  new URL('../../data-runtime/internal/apps/aims/project_governance_responsibility.go', import.meta.url),
  'utf8'
)
const runtimeWeeklyReports = readFileSync(
  new URL('../../data-runtime/internal/apps/aims/project_weekly_reports.go', import.meta.url),
  'utf8'
)
const runtimeTimeEntryGovernance = readFileSync(
  new URL('../../data-runtime/internal/apps/aims/time_entry_governance.go', import.meta.url),
  'utf8'
)
const roleHolderGuard = readFileSync(
  new URL('../server/utils/projectGovernanceRoleHolder.ts', import.meta.url),
  'utf8'
)

function role(code: string) {
  const result = manifest.recommendedRoles.find(item => item.code === code)
  assert.ok(result, `missing role ${code}`)
  return result
}

describe('Aims project governance responsibility boundary', () => {
  test('admin config permission does not imply director business permissions', () => {
    const adminPermissions = role('aims:admin').suggestedPermissions || []
    assert.equal(adminPermissions.includes('aims:weekly_reports:configure'), true)
    assert.equal(adminPermissions.includes('aims:weekly_reports:review'), false)
    assert.equal(adminPermissions.includes('aims:weekly_reports:publish'), false)
    assert.equal(adminPermissions.includes('aims:quality_reviews:review'), false)
    assert.equal(adminPermissions.includes('aims:quality_reviews:waive'), false)
  })

  test('BFF removes caller role flags and rebuilds exact weekly-report permissions', () => {
    for (const flag of [
      'current_user_is_project_director',
      'current_user_project_director_revision',
      'current_user_can_configure_weekly_reports',
      'current_user_can_submit_weekly_report',
      'current_user_can_submit_assigned_weekly_report',
      'current_user_can_submit_timesheet',
      'current_user_can_approve_timesheet',
      'current_user_can_review_assigned_timesheet'
    ]) {
      assert.match(middleware, new RegExp(`delete sanitizedQuery\\.${flag}`))
    }
    assert.match(middleware, /checkPermission\(context\.event, 'weekly_reports', 'review'\)/)
    assert.match(middleware, /checkPermission\(context\.event, 'weekly_reports', 'configure'\)/)
    assert.match(middleware, /checkPermission\(context\.event, 'weekly_reports', 'submit'\)/)
    assert.match(middleware, /checkPermission\(context\.event, 'weekly_reports', 'view'\)/)
    assert.match(middleware, /checkPermission\(context\.event, 'timesheet', 'approve'\)/)
    assert.match(middleware, /checkPermission\(context\.event, 'timesheet', 'submit'\)/)
    assert.doesNotMatch(middleware, /checkPermission\(event, 'reports', 'edit'\)/)
    assert.doesNotMatch(middleware, /checkPermission\(event, 'reports', 'admin'\)/)
  })

  test('director writes require a fresh singleton holder revision from Console', () => {
    assert.match(roleHolderGuard, /console\/service\/authorization\/role-holders/)
    assert.match(roleHolderGuard, /scope: 'console:authorization-role-holders:read'/)
    assert.match(roleHolderGuard, /fetchConsoleServiceJson<RoleHolderResponse>/)
    assert.match(roleHolderGuard, /endpoint\.searchParams\.set\('roleCodes', roleCode\)/)
    assert.match(roleHolderGuard, /trustedServiceRequestHeaders\(event\)/)
    assert.doesNotMatch(roleHolderGuard, /function forwardedContextHeaders/)
    assert.match(roleHolderGuard, /timeout: 5000/)
    assert.doesNotMatch(roleHolderGuard, /cached|useStorage|defineCached/)
    assert.match(middleware, /requireCurrentProjectGovernanceRoleHolder\([\s\S]*'project_director'/)
    assert.match(middleware, /current_user_project_director_revision = String\(holder\.revision\)/)
    assert.match(middleware, /weeklyReportDirectorCommandPath/)
    assert.match(middleware, /directorWorkbenchPath/)
    assert.match(runtimeResponsibility, /project_director_role_holder_revision_required/)
    assert.match(runtimeResponsibility, /role_holder_revision/)
  })

  test('runtime uses active delegation before formal project manager', () => {
    assert.match(runtimeWeeklyReports, /FROM project_manager_delegations delegation/)
    assert.match(runtimeWeeklyReports, /COALESCE\(\([\s\S]*delegation\.delegate_uid[\s\S]*\), p\.leader_uid\)/)
    assert.match(runtimeWeeklyReports, /weekly_report_submit_permission_required/)
    assert.doesNotMatch(
      runtimeWeeklyReports.slice(runtimeWeeklyReports.indexOf('func (a *Adapter) requireProjectWeeklyReportManager')),
      /currentUserIsProjectAdmin\(query\)/
    )
    assert.match(runtimeWeeklyReports, /current_user_can_submit_assigned_weekly_report/)
    assert.match(runtimeTimeEntryGovernance, /current_user_can_review_assigned_timesheet/)
    assert.match(runtimeTimeEntryGovernance, /reviewerUID != actor/)
  })

  test('migration and canonical schema carry the same governance facts', () => {
    for (const table of [
      'weekly_reporting_settings',
      'weekly_reporting_pilot_projects',
      'project_lifecycle_events',
      'project_manager_delegations',
      'weekly_reporting_periods',
      'weekly_report_obligations',
      'project_weekly_report_versions',
      'project_weekly_report_correction_requests',
      'project_weekly_report_reviews',
      'weekly_report_corrective_action_links',
      'time_entry_review_events',
      'qa_checklist_versions',
      'deliverable_submissions',
      'deliverable_quality_reviews',
      'deliverable_waivers',
      'company_weekly_summaries',
      'company_weekly_summary_versions',
      'company_weekly_summary_items',
      'company_weekly_summary_recipient_selections',
      'company_weekly_summary_recipient_snapshots',
      'project_management_fact_snapshots'
    ]) {
      assert.equal(migration.includes(`CREATE TABLE IF NOT EXISTS \`${table}\``), true)
      assert.equal(schema.includes(`CREATE TABLE IF NOT EXISTS \`${table}\``), true)
    }
    assert.match(migration, /migration\.v5\.6\.baseline/)
    assert.match(migration, /WHERE `leader_uid` IS NULL OR TRIM\(`leader_uid`\) = ''/)
    assert.match(schema, /`leader_uid` VARCHAR\(64\) NOT NULL/)
    assert.match(managerContractMigration, /project_manager_contract_blocked/)
    assert.match(managerContractMigration, /MODIFY COLUMN `leader_uid` VARCHAR\(64\) NOT NULL/)
    assert.doesNotMatch(managerContractMigration, /UPDATE `aims_projects`/)
    assert.doesNotMatch(runtimeResponsibility, /current_user_is_project_admin/)
  })

  test('v5.6 upgrade helpers cannot confuse parameters with information_schema columns', () => {
    assert.match(migration, /IN p_table_name VARCHAR\(64\)/)
    assert.match(migration, /IN p_column_name VARCHAR\(64\)/)
    assert.match(migration, /IN p_index_name VARCHAR\(64\)/)
    assert.match(migration, /IN p_constraint_name VARCHAR\(64\)/)
    assert.match(migration, /column_info\.TABLE_NAME = p_table_name/)
    assert.match(migration, /column_info\.COLUMN_NAME = p_column_name/)
    assert.match(migration, /index_info\.TABLE_NAME = p_table_name/)
    assert.match(migration, /index_info\.INDEX_NAME = p_index_name/)
    assert.match(migration, /constraint_info\.TABLE_NAME = p_table_name/)
    assert.match(migration, /constraint_info\.CONSTRAINT_NAME = p_constraint_name/)
    assert.doesNotMatch(migration, /TABLE_NAME = table_name/)
    assert.doesNotMatch(migration, /COLUMN_NAME = column_name/)

    assert.equal((migration.match(/CALL `aims_add_governance_column`/g) || []).length, 30)
    assert.equal((migration.match(/CALL `aims_add_governance_index`/g) || []).length, 7)
    assert.equal((migration.match(/CALL `aims_add_governance_fk`/g) || []).length, 11)
    assert.match(migrationVerification, /existing_table_count <> 21/)
    assert.match(migrationVerification, /existing_column_count <> 30/)
    assert.match(migrationVerification, /existing_index_count <> 7/)
    assert.match(migrationVerification, /existing_fk_count <> 11/)
    assert.match(migrationVerification, /'milestones', 'completion_lock_request_id'/)
  })
})
