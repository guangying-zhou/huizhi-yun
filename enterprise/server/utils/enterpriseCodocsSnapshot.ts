import { createHash, randomBytes } from 'node:crypto'
import { createError, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import type { requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { objectStorageVersionId } from '@hzy/foundation/server/utils/objectStorageVersion'
import { createRuntimeOSSClient } from '../../../codocs/server/utils/oss'

// v2 personal-document snapshots (docs/Codocs-Document-Write-Coordination.md).
// Off unless HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2=true; the Runtime routes are
// separately gated by apps.codocs.snapshotV2Enabled.

type EnterpriseUser = Awaited<ReturnType<typeof requireEnterpriseUser>>
type SnapshotObject = { key: string, version: string }
export type SnapshotHead = {
  generation: number
  epoch: number
  markdown?: SnapshotObject
  markdownSize?: number
  markdownSha256?: string
}

const readOperation = 'codocs.personal-document-snapshot-read' as const
const prepareOperation = 'codocs.personal-document-snapshot-prepare' as const
const publishOperation = 'codocs.personal-document-snapshot-publish' as const
const MIRROR_GENERATION_META = 'hzy-snapshot-generation'

// Read per call from the process environment (default off), so the switch has
// one source and this module stays importable outside Nitro.
export function codocsSnapshotV2Enabled(_event?: H3Event) {
  return process.env.HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2 === 'true'
}

async function permit(event: H3Event, user: EnterpriseUser, operation: typeof readOperation | typeof prepareOperation | typeof publishOperation, action: 'read' | 'edit') {
  await prepareEnterpriseRuntime(event, operation)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'documents', action === 'read' ? 'view' : 'edit', snapshot.actionPolicies?.documents)) {
    throw createError({ statusCode: 403, message: action === 'read' ? '缺少文档查看权限' : '缺少文档编辑权限' })
  }
  return { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'personal-documents', action, expiresAt: enterpriseRuntimePermitExpiresAt() }
}

function safeInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function snapshotObject(value: unknown): SnapshotObject | null {
  const object = value as { key?: unknown, version?: unknown } | null
  return object && typeof object.key === 'string' && object.key && typeof object.version === 'string' && object.version
    ? { key: object.key, version: object.version }
    : null
}

export async function readSnapshotHead(event: H3Event, user: EnterpriseUser, uuid: string): Promise<SnapshotHead> {
  const response = await callEnterpriseRuntime<{ success?: boolean, data?: Record<string, unknown> }>(event, readOperation, {
    tenant: user.tenant, deployment: user.deployment, code: uuid, authorization: await permit(event, user, readOperation, 'read')
  })
  const data = response?.data
  const generation = safeInteger(data?.generation)
  const epoch = safeInteger(data?.epoch)
  if (response?.success !== true || !data || generation === null || epoch === null) throw createError({ statusCode: 503, message: '文档快照引用无效' })
  if (generation === 0) return { generation, epoch }
  const markdown = snapshotObject((data.objects as { markdown?: unknown } | undefined)?.markdown)
  const markdownSize = safeInteger(data.markdownSize)
  if (!markdown || markdownSize === null || typeof data.markdownSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(data.markdownSha256)) {
    throw createError({ statusCode: 503, message: '文档快照引用无效' })
  }
  return { generation, epoch, markdown, markdownSize, markdownSha256: data.markdownSha256 }
}

// Reads the exact published Markdown and refuses bytes that do not match the
// published length and digest; never falls back to the derived copy.
export async function readSnapshotMarkdown(event: H3Event, head: SnapshotHead) {
  if (!head.markdown) throw createError({ statusCode: 503, message: '文档快照引用无效' })
  let content: Buffer
  try {
    const client = await createRuntimeOSSClient({ event })
    content = (await client.get(head.markdown.key, { versionId: head.markdown.version })).content
  } catch {
    throw createError({ statusCode: 503, message: '文档存储暂不可用', data: { code: 'enterprise_document_storage_unavailable' } })
  }
  if (content.length !== head.markdownSize || createHash('sha256').update(content).digest('hex') !== head.markdownSha256) {
    throw createError({ statusCode: 503, message: '文档快照正文校验失败' })
  }
  return content.toString('utf-8')
}

function errorCode(error: unknown) {
  const failure = error as { data?: { code?: string, data?: { code?: string } } }
  return failure?.data?.data?.code ?? failure?.data?.code
}

function conflictOrRethrow(error: unknown): never {
  const failure = error as { statusCode?: number }
  const code = errorCode(error)
  if (failure?.statusCode === 409 && code === 'snapshot_generation_conflict') {
    throw createError({ statusCode: 409, message: '文档已在别处更新，请刷新后再保存', data: { code: 'snapshot_generation_conflict' } })
  }
  throw error
}

type PublishResult = { generation: number, replayed: boolean }
export type SnapshotSaveBase = { expectedGeneration: number, expectedEpoch: number }

// Saves Markdown as a new v2 generation. The Idempotency-Key names the command:
// a retry replays prepare, uploads into a fresh attempt directory (never the
// same object key twice) and publishes, or returns the earlier publication.
export async function saveSnapshotV2(event: H3Event, user: EnterpriseUser, uuid: string, key: string, bytes: Buffer, base: SnapshotSaveBase): Promise<PublishResult> {
  // The browser's content read established this base. Never replace it with a
  // fresh head here: doing so silently turns a stale draft into an overwrite.
  const command = { generation: base.expectedGeneration, epoch: base.expectedEpoch,
    markdownSha256: createHash('sha256').update(bytes).digest('hex'), markdownSize: bytes.length }
  let planned
  try {
    planned = await callEnterpriseRuntime<{ success?: boolean, data?: { prefix?: unknown, generation?: unknown, replayed?: unknown } }>(event, prepareOperation, {
      tenant: user.tenant, deployment: user.deployment, code: uuid, payload: command, authorization: await permit(event, user, prepareOperation, 'edit')
    }, { idempotencyKey: key })
  } catch (error) { conflictOrRethrow(error) }
  const plan = planned?.data
  const plannedGeneration = safeInteger(plan?.generation)
  if (planned?.success !== true || typeof plan?.prefix !== 'string' || !plan.prefix.startsWith('codocs/snapshots/') || !plan.prefix.endsWith('/')
    || plannedGeneration === null || typeof plan.replayed !== 'boolean') {
    throw createError({ statusCode: 503, message: '文档保存计划无效' })
  }
  // Runtime's published candidate is the receipt. It is tied to this exact
  // key, base generation/epoch and digest, even if another save has followed.
  if (plan.replayed) return { generation: plannedGeneration, replayed: true }
  const attempt = `${plan.prefix}${randomBytes(16).toString('hex')}/body.md`
  let version: string | undefined
  try {
    const client = await createRuntimeOSSClient({ event })
    const stored = await client.put(attempt, bytes, { forbidOverwrite: true, headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
    version = objectStorageVersionId(stored.res.headers as Record<string, string>)
  } catch {
    throw createError({ statusCode: 503, message: '文档正文尚未保存，请使用相同请求重试' })
  }
  if (!version) throw createError({ statusCode: 503, message: '文档正文尚未保存，请使用相同请求重试' })
  const published = await callEnterpriseRuntime<{ success?: boolean, data?: { generation?: unknown, replayed?: unknown } }>(event, publishOperation, {
    tenant: user.tenant, deployment: user.deployment, code: uuid,
    payload: { ...command, objects: { markdown: { key: attempt, version } } },
    authorization: await permit(event, user, publishOperation, 'edit')
  }, { idempotencyKey: key }).catch(conflictOrRethrow)
  const generation = safeInteger(published?.data?.generation)
  if (published?.success !== true || generation === null || generation < 1) throw createError({ statusCode: 503, message: '文档保存结果无效' })
  return { generation, replayed: published.data?.replayed === true }
}

// Derived copy for legacy readers of documents.oss_path. It is never read by
// v2 readers; after writing it re-reads the head so a slower mirror of an older
// generation cannot be left on top of a newer one. Failure leaves the committed
// save intact and is reported for repair.
export async function mirrorSnapshotToLegacyPath(event: H3Event, user: EnterpriseUser, uuid: string, legacyPath: string, generation: number, bytes: Buffer) {
  if (!legacyPath) return false
  try {
    const client = await createRuntimeOSSClient({ event })
    let current = { generation, bytes }
    for (let round = 0; round < 3; round += 1) {
      await client.put(legacyPath, current.bytes, {
        headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
        meta: { [MIRROR_GENERATION_META]: String(current.generation) }
      })
      const head = await readSnapshotHead(event, user, uuid)
      if (head.generation <= current.generation) return true
      current = { generation: head.generation, bytes: Buffer.from(await readSnapshotMarkdown(event, head), 'utf-8') }
    }
    return false
  } catch {
    return false
  }
}

// Read repair: a v2 read already holds the exact published bytes, so a derived
// copy that is missing or stamped with an older generation (e.g. a failed or
// raced mirror, or a refused legacy write) is refreshed. Never throws.
export async function repairLegacyMirror(event: H3Event, user: EnterpriseUser, uuid: string, legacyPath: string, head: SnapshotHead, markdown: string) {
  if (!legacyPath || head.generation < 1) return false
  try {
    const client = await createRuntimeOSSClient({ event })
    let stamped = -1
    try {
      const current = await client.head(legacyPath)
      stamped = Number((current.meta || {})[MIRROR_GENERATION_META] ?? -1)
    } catch { /* missing copy: repair below */ }
    if (stamped === head.generation) return false
    return await mirrorSnapshotToLegacyPath(event, user, uuid, legacyPath, head.generation, Buffer.from(markdown, 'utf-8'))
  } catch {
    return false
  }
}
