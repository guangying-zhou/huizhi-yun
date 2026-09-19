import { createHash } from 'node:crypto'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import type { EnterpriseTransaction } from './enterpriseEntitlementRepository.ts'
import { enterpriseStatusAt, normalizeEnterprisePeriod, parseEntitlementUtc, restoreEnterpriseEntitlement, type EnterpriseEntitlement } from './enterpriseEntitlement.ts'

export interface EnterpriseStateCommand {
  tenantCode: string
  operationId: string
  expectedRevision: number
  action: 'suspend' | 'revoke' | 'restore'
  actorUid: string
  reason: string
}

type Row = RowDataPacket & Record<string, unknown>
function digest(value: unknown) {
  return `sha256_${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
}
export function transitionEnterpriseEntitlement(current: EnterpriseEntitlement, action: EnterpriseStateCommand['action'], now: string): EnterpriseEntitlement {
  parseEntitlementUtc(now)
  if (!Number.isSafeInteger(current.revision) || current.revision < 1 || current.revision >= Number.MAX_SAFE_INTEGER) throw new Error('invalid_entitlement_revision')
  if (!['suspend', 'revoke', 'restore'].includes(action)) throw new Error('invalid_entitlement_action')
  const effectiveStatus = enterpriseStatusAt(current, now)
  if (effectiveStatus === 'revoked') throw new Error('entitlement_revoked')
  const next = { ...current, ...normalizeEnterprisePeriod(current), revision: current.revision + 1 }
  if (action === 'restore') return restoreEnterpriseEntitlement(next, now)
  if (action === 'suspend' && !['active', 'pending'].includes(effectiveStatus)) throw new Error('entitlement_not_suspendable')
  return { ...next, status: action === 'revoke' ? 'revoked' : 'suspended' }
}

export function createEnterpriseEntitlementStateRepository(withTransaction: EnterpriseTransaction) {
  return {
    async change(command: EnterpriseStateCommand, now: string) {
      parseEntitlementUtc(now)
      if (!command.tenantCode.trim() || !command.operationId.trim() || command.operationId.length > 120 || !command.actorUid.trim() || !command.reason.trim() || command.reason.length > 1000 || !Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 1 || !['suspend', 'revoke', 'restore'].includes(command.action)) throw new Error('invalid_entitlement_state_command')
      // Hash exact command fields only, not ambient time; lost response retries replay original revision.
      const requestHash = digest({ tenantCode: command.tenantCode, operationId: command.operationId, expectedRevision: command.expectedRevision, action: command.action, actorUid: command.actorUid, reason: command.reason })
      return withTransaction(async (tx) => {
        const tenant = await tx.queryRow<Row>('SELECT tenant_code, status FROM tenants WHERE tenant_code = ? FOR UPDATE', [command.tenantCode])
        if (!tenant) throw new Error('enterprise_tenant_not_found')
        const receipt = await tx.queryRow<Row>('SELECT request_hash, result_json FROM tenant_enterprise_entitlement_state_commands WHERE tenant_code = ? AND operation_id = ? FOR UPDATE', [command.tenantCode, command.operationId])
        if (receipt) {
          if (receipt.request_hash !== requestHash) throw new Error('entitlement_state_operation_conflict')
          return { replayed: true, entitlement: typeof receipt.result_json === 'string' ? JSON.parse(receipt.result_json) as EnterpriseEntitlement : receipt.result_json as EnterpriseEntitlement }
        }
        const row = await tx.queryRow<Row>('SELECT e.entitlement_json, c.revision FROM tenant_enterprise_entitlement_current c INNER JOIN tenant_enterprise_entitlements e ON e.tenant_code = c.tenant_code AND e.revision = c.revision WHERE c.tenant_code = ? FOR UPDATE', [command.tenantCode])
        if (!row) throw new Error('enterprise_entitlement_not_found')
        if (Number(row.revision) !== command.expectedRevision) throw new Error('entitlement_state_revision_conflict')
        if (command.action === 'restore' && tenant.status !== 'active') throw new Error('enterprise_tenant_not_active')
        const current = typeof row.entitlement_json === 'string' ? JSON.parse(row.entitlement_json) as EnterpriseEntitlement : row.entitlement_json as EnterpriseEntitlement
        if (current.tenantCode !== command.tenantCode || current.revision !== command.expectedRevision) throw new Error('entitlement_stored_context_invalid')
        const next = transitionEnterpriseEntitlement(current, command.action, now)
        await tx.execute<ResultSetHeader>('INSERT INTO tenant_enterprise_entitlements (tenant_code, revision, schema_version, product_code, status, effective_from, effective_until, period_kind, entitlement_json, migration_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [command.tenantCode, next.revision, next.schemaVersion, next.productCode, next.status, next.effectiveFrom.replace('T', ' ').replace('Z', ''), next.end.kind === 'finite' ? next.end.effectiveUntil.replace('T', ' ').replace('Z', '') : null, next.end.kind, JSON.stringify(next), `state:${command.operationId}`])
        await tx.execute<ResultSetHeader>('UPDATE tenant_enterprise_entitlement_current SET revision = ? WHERE tenant_code = ? AND revision = ?', [next.revision, command.tenantCode, command.expectedRevision])
        await tx.execute<ResultSetHeader>('INSERT INTO tenant_enterprise_entitlement_state_commands (tenant_code, operation_id, request_hash, action, actor_uid, reason, previous_revision, result_revision, result_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [command.tenantCode, command.operationId, requestHash, command.action, command.actorUid, command.reason, command.expectedRevision, next.revision, JSON.stringify(next)])
        return { replayed: false, entitlement: next }
      })
    }
  }
}

export async function changeEnterpriseEntitlementState(command: EnterpriseStateCommand, now = new Date().toISOString()) {
  const { withTransaction } = await import('./db')
  return createEnterpriseEntitlementStateRepository(withTransaction).change(command, now)
}
