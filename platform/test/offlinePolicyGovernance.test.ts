import test from 'node:test'
import assert from 'node:assert/strict'
import { overlayExportedGovernance } from '../scripts/offlinePolicyGovernance.ts'

const body = { roles: [], subjects: [], baselineGrants: [] }
const current = { tables: {
  tenant_roles: [{ id: 1, role_code: 'employee', status: 'active' }],
  tenant_subject_status: [], tenant_role_app_role_maps: [], tenant_role_permissions: [], tenant_role_scopes: [],
  effective_tenant_subject_roles: [{ id: 2, role_id: 1, role_code: 'employee', starts_at: '2026-10-08 16:42:00', expired_at: null }],
  effective_tenant_subject_role_scopes: []
} }
const database = { platform_app_roles: [], platform_app_role_scopes: [] }
test('offline governance preserves SQL DATETIME verbatim and rejects timezone-converted exports', () => {
  assert.equal(overlayExportedGovernance(body, current, database).subjectRoles[0].startsAt, '2026-10-08 16:42:00')
  const bad = structuredClone(current)
  bad.tables.effective_tenant_subject_roles[0]!.starts_at = '2026-10-08T08:42:00.000Z'
  assert.throws(() => overlayExportedGovernance(body, bad, database), /unchanged DB string/)
})
