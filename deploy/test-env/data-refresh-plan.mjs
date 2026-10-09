// Explicit allowlist: unknown tables fail closed; never import live credentials/jobs.
export const refreshId = 'production-business-20260905'
export const businessTables = {
  console: `dictionaries dictionary_items directory_department_aliases directory_department_identities
    directory_departments directory_identities directory_lifecycle_scope_versions directory_project_members
    directory_projects directory_subject_exports directory_user_departments directory_users operation_logs
    org_business_domains org_profiles product_versions region_divisions regions setting_catalogs setting_values
    work_calendar_days work_calendar_import_jobs work_calendar_months work_calendars`.split(/\s+/),
  people: `people_assignments people_contribution_scope_versions people_contribution_snapshots people_cost_snapshots
    people_directory_lifecycle_versions people_documents people_employee_number_reassignment_history
    people_employee_number_sequences people_employee_private_facts people_employees people_offboarding_cases
    people_offboarding_tasks people_onboarding_cases people_performance_cycles people_positions people_ranks
    people_standard_cost_rates`.split(/\s+/)
}
export const preservedTables = {
  console: `auth_authorization_codes auth_client_redirect_uris auth_clients auth_external_login_transactions
    auth_identity_providers auth_login_events auth_refresh_tokens auth_signing_keys auth_token_events
    connector_runtime_enrollments connector_runtime_instances console_cutover_dispositions console_mutation_receipts
    console_platform_lifecycle_actionables console_runtime_cache directory_activation_credentials
    directory_connector_enrollments directory_connectors directory_department_snapshot_differences
    directory_department_snapshot_runs directory_hr_source_policies directory_identity_reservations
    directory_sync_events directory_sync_jobs integration_check_logs integration_credentials integration_operation
    integration_operation_attempt integrations local_presence_heartbeats local_sessions portal_actionable_projections
    portal_notification_deliveries portal_notification_recipients portal_notifications runtime_clipboards
    service_client_credentials service_client_grants service_clients service_command_receipt
    vault_access_logs vault_secret_versions vault_secrets`.split(/\s+/),
  people: `integration_operation integration_operation_attempt integration_operation_dead_letter_actionable
    people_connector_sync_receipts people_offboarding_notification_checkpoint`.split(/\s+/)
}
export const stageDatabase = app => {
  if (!Object.hasOwn(businessTables, app)) throw new Error('Unknown application')
  return `hzy_${app}_test_20260905`
}
export function validateInventory(app, tables) {
  const expected = new Set([...businessTables[app], ...preservedTables[app]])
  if (tables.some(t => !expected.has(t)) || businessTables[app].some(t => !tables.includes(t))) throw new Error('Unreviewed schema inventory')
}
