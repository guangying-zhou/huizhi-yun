import { createHash } from 'node:crypto'
import { createError } from 'h3'

/**
 * v2 (snapshot-backed) documents: the exact published Markdown object version
 * is authoritative and `documents.oss_path` is only a best-effort compatibility
 * mirror (docs/Codocs-Collaboration-Body-Consumers-Inventory.md).
 *
 * - Consumers that can be converted read the exact version through
 *   `readBodyByRef` (length and SHA-256 verified, never the mirror).
 * - Consumers that cannot or should not be converted call
 *   `assertLegacyBodyDocument` first and answer 409 before any storage access.
 */
export interface DocumentBodyRef {
  generation: number
  epoch: number
  markdown: { key: string, version: string }
  size: number
  sha256: string
}

export interface BodyStorageClient {
  get: (path: string, options?: { versionId?: string }) => Promise<{ content: Buffer }>
}

export const DOCUMENT_ON_SNAPSHOT_V2 = 'document_on_snapshot_v2'

function safeInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

/** Runtime metadata carries `snapshot_generation` (0 or absent = v1). */
export function isSnapshotV2Document(doc: { snapshot_generation?: unknown } | null | undefined) {
  const generation = Number(doc?.snapshot_generation ?? 0)
  return Number.isFinite(generation) && generation > 0
}

export function snapshotV2Error(message = '该文档已启用协作快照，请在企业端打开') {
  return createError({ statusCode: 409, message, data: { code: DOCUMENT_ON_SNAPSHOT_V2 } })
}

/**
 * Fail closed for v2 documents. Call it before reading or writing any body
 * object, so a rejected request never touches storage.
 */
export function assertLegacyBodyDocument<T extends { snapshot_generation?: unknown }>(doc: T, message?: string): T {
  if (isSnapshotV2Document(doc)) throw snapshotV2Error(message)
  return doc
}

/** Strictly parses the Runtime `snapshot_ref` / `bodyRef` / `sourceBodyRef` wire shape. */
export function parseBodyRef(value: unknown): DocumentBodyRef {
  const ref = value as { generation?: unknown, epoch?: unknown, markdown?: { key?: unknown, version?: unknown }, size?: unknown, sha256?: unknown } | null
  const generation = safeInteger(ref?.generation)
  const epoch = safeInteger(ref?.epoch)
  const size = safeInteger(ref?.size)
  const key = ref?.markdown?.key
  const version = ref?.markdown?.version
  if (!ref || generation === null || generation < 1 || epoch === null || size === null
    || typeof key !== 'string' || !key.startsWith('codocs/snapshots/') || typeof version !== 'string' || !version
    || typeof ref.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(ref.sha256)) {
    throw createError({ statusCode: 503, message: '文档快照引用无效', data: { code: 'snapshot_reference_invalid' } })
  }
  return { generation, epoch, markdown: { key, version }, size, sha256: ref.sha256 }
}

/**
 * Reads the exact published version and refuses bytes that differ from the
 * published length or digest. Never falls back to the derived mirror.
 */
export async function readBodyByRef(client: BodyStorageClient, ref: DocumentBodyRef): Promise<Buffer> {
  let content: Buffer
  try {
    content = (await client.get(ref.markdown.key, { versionId: ref.markdown.version })).content
  } catch {
    throw createError({ statusCode: 503, message: '文档存储暂不可用', data: { code: 'document_storage_unavailable' } })
  }
  if (content.length !== ref.size || createHash('sha256').update(content).digest('hex') !== ref.sha256) {
    throw createError({ statusCode: 503, message: '文档快照正文校验失败', data: { code: 'snapshot_body_mismatch' } })
  }
  return content
}
