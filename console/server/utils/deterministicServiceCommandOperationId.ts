import { createHash } from 'node:crypto'

/**
 * Receipt operation IDs are stable across retries but must retain the UUIDv4
 * shape required by the Data Runtime service-command contract.
 */
export function deterministicServiceCommandOperationId(namespace: string, idempotencyKey: string) {
  const hex = createHash('sha256').update(`${namespace}|${idempotencyKey}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
