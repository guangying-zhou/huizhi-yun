import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const root = new URL('../../', import.meta.url)

function read(path) {
  return readFileSync(new URL(path, root), 'utf8')
}

test('Assets production release includes runtime schema and transport grants', () => {
  const migration = [
    'assets/docs/assets_notification_checkpoint_20260710.sql',
    'assets/docs/assets_offboarding_recovery_20260710.sql',
    'assets/docs/assets_customer_delivery_responsibility_20260710.sql',
    'assets/docs/assets_service_command_receipt_20260710.sql',
    'assets/docs/migrations/20260710_assets_integration_operations.sql',
    'assets/docs/migrations/20260711_assets_dead_letter_actionable_lifecycle.sql'
  ].map(read).join('\n')
  const grants = read('console/docs/sql/Console-SQL-Seed-v1.60-assets-runtime-grants.sql')

  for (const table of [
    'asset_offboarding_recovery_cases',
    'assets_notification_checkpoint',
    'service_command_receipt',
    'integration_operation',
    'integration_operation_attempt',
    'integration_operation_dead_letter_actionable'
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS [\\x60 ]*${table}`))
  }

  for (const column of [
    'responsible_uid',
    'responsible_dept_code',
    'altoc_status_sync_revision',
    'altoc_status_sync_fingerprint',
    'altoc_status_sync_occurred_at'
  ]) {
    assert.match(migration, new RegExp(column))
  }

  for (const [resource, action] of [
    ['data-runtime:assets', 'read'],
    ['data-runtime:assets', 'write'],
    ['tenant-runtime:assets', 'read'],
    ['tenant-runtime:assets', 'write']
  ]) {
    assert.match(grants, new RegExp(`'${resource}'[^\\n]{0,80}'${action}'`))
  }
})
