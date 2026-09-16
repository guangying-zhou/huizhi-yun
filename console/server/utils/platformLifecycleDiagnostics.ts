import type { H3Event } from 'h3'
import {
  getConsolePlatformLifecycleAttempts,
  getConsolePlatformLifecycleOperations,
  type ConsolePlatformLifecycleAttempt,
  type ConsolePlatformLifecycleOperation
} from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'

const operationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type BrowserPlatformLifecycleOperation = ConsolePlatformLifecycleOperation
export type BrowserPlatformLifecycleAttempt = ConsolePlatformLifecycleAttempt

function text(value: unknown) {
  return String(value || '').trim()
}

export function parsePlatformLifecycleDiagnosticLimit(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), 1), 100) : 20
}

export function parsePlatformLifecycleDiagnosticOperationId(value: unknown) {
  const operationId = text(value)
  if (!operationIdPattern.test(operationId)) return null
  return operationId
}

export async function listPlatformLifecycleOperations(input: {
  event: H3Event
  uid?: unknown
  limit?: unknown
}): Promise<BrowserPlatformLifecycleOperation[]> {
  const response = await getConsolePlatformLifecycleOperations(input.event, {
    uid: text(input.uid) || undefined,
    limit: parsePlatformLifecycleDiagnosticLimit(input.limit)
  })
  return response.data.items
}

export async function listPlatformLifecycleAttempts(input: {
  event: H3Event
  operationId: string
}): Promise<BrowserPlatformLifecycleAttempt[]> {
  const response = await getConsolePlatformLifecycleAttempts(input.event, input.operationId)
  return response.data.items
}
