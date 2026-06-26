import type { H3Event } from 'h3'
import { getCookie, getHeader, getRequestURL } from 'h3'
import { execute } from './db'
import { cleanString, jsonOrNull, type SqlParam } from './financeWrite'

type AuditAction = 'create' | 'update' | 'delete' | 'submit' | 'approve' | 'confirm' | 'reconcile' | 'reverse' | 'classify' | 'recalculate' | 'sync' | 'import'

export interface FinanceAuditInput {
  entityType: string
  entityId?: number | null
  entityCode?: string | null
  action: AuditAction | string
  oldValue?: unknown
  newValue?: unknown
  operatorId?: string | null
  sourceApp?: string | null
  requestId?: string | null
  operatorIp?: string | null
}

export async function writeFinanceAudit(input: FinanceAuditInput): Promise<void> {
  await execute(`
    INSERT INTO finance_audit_log (
      entity_type,
      entity_id,
      entity_code,
      action,
      old_value,
      new_value,
      operator_id,
      operator_ip,
      source_app,
      request_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    input.entityType,
    input.entityId || null,
    input.entityCode || null,
    input.action,
    jsonOrNull(input.oldValue),
    jsonOrNull(input.newValue),
    input.operatorId || null,
    input.operatorIp || null,
    input.sourceApp || 'finance',
    input.requestId || null
  ] satisfies SqlParam[])
}

export function buildFinanceAuditFromRequest(event: H3Event) {
  const url = getRequestURL(event)
  const pathname = normalizeApiPath(url.pathname)
  const method = String(event.node.req.method || 'GET').toUpperCase()
  const parts = pathname.split('/').filter(Boolean)
  const financeIndex = parts.findIndex((part, index) => part === 'finance' && parts[index - 1] === 'v1')
  const resourceParts = financeIndex >= 0 ? parts.slice(financeIndex + 1) : []
  const action = inferAction(method, resourceParts)
  const entityType = inferEntityType(resourceParts)
  const entityCode = inferEntityCode(resourceParts)
  const statusCode = event.node.res.statusCode || 200

  return {
    entityType,
    entityCode,
    action,
    operatorId: requestOperatorId(event),
    operatorIp: requestIp(event),
    requestId: requestId(event),
    newValue: {
      method,
      path: pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      statusCode,
      result: statusCode >= 400 ? 'failed' : 'success'
    }
  }
}

function normalizeApiPath(pathname: string) {
  const config = useRuntimeConfig() as unknown as { public?: { appBasePath?: string } }
  const basePath = String(config.public?.appBasePath || '').replace(/\/+$/, '')
  if (basePath && basePath !== '/' && pathname.startsWith(`${basePath}/api/`)) {
    return pathname.slice(basePath.length)
  }
  return pathname
}

function inferEntityType(parts: string[]) {
  if (parts.length === 0) return 'api'
  const first = parts[0] || 'api'
  const second = parts[1]
  if (first === 'settings' && second) return normalizeSegment(`settings_${second}`)
  if (first === 'workflow' && second) return normalizeSegment(`workflow_${second}`)
  if (first === 'integrations' && second) return normalizeSegment(`integration_${second}`)
  if (first === 'migrations' && second) return normalizeSegment(`migration_${second}`)
  if (first === 'performance' && second === 'snapshots') return 'performance_snapshot'
  return normalizeSegment(first)
}

function inferEntityCode(parts: string[]) {
  for (const part of parts.slice(1)) {
    if (['submit', 'classify', 'void', 'recalculate', 'sync', 'snapshots', 'balance-snapshots'].includes(part)) continue
    if (!part || part.includes('.')) continue
    return part.slice(0, 50)
  }
  return null
}

function inferAction(method: string, parts: string[]): AuditAction {
  const last = parts.at(-1)
  if (last === 'submit') return 'submit'
  if (last === 'classify') return 'classify'
  if (last === 'void') return 'reverse'
  if (last === 'recalculate') return 'recalculate'
  if (last === 'sync') return 'sync'
  if (parts.includes('migrations')) return 'import'
  if (method === 'DELETE') return 'delete'
  if (method === 'PATCH' || method === 'PUT') return 'update'
  return 'create'
}

function requestOperatorId(event: H3Event) {
  const consoleAuth = event.context.consoleAuth as { uid?: string, subjectCode?: string, authenticated?: boolean } | undefined
  return cleanString(consoleAuth?.uid)
    || cleanString(consoleAuth?.subjectCode)
    || cleanString(getCookie(event, 'auth_user'))
}

function requestIp(event: H3Event) {
  const forwardedFor = cleanString(getHeader(event, 'x-forwarded-for'))
  if (forwardedFor) return forwardedFor.split(',')[0]?.trim().slice(0, 50) || null
  return cleanString(event.node.req.socket.remoteAddress)?.slice(0, 50) || null
}

function requestId(event: H3Event) {
  return cleanString(getHeader(event, 'x-request-id') || getHeader(event, 'x-correlation-id'))
}

function normalizeSegment(value: string) {
  return value
    .replace(/-/g, '_')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50) || 'api'
}
