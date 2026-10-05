import { createHash } from 'node:crypto'
import { createError, getHeader, getRequestURL, readBody, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { createRuntimeOSSClient } from '../../../codocs/server/utils/oss'

const operation = 'codocs.personal-document-create' as const
const allowed = new Set(['title', 'doc_type', 'folder_id', 'content', 'owner_uid'])
const missingObject = (error: unknown) => {
  const e = error as { status?: number, statusCode?: number, code?: string }
  return e?.status === 404 || e?.statusCode === 404 || e?.code === 'NoSuchKey'
}

export async function enterpriseCodocsDocumentCreation(event: H3Event) {
  if (getRequestURL(event).search) throw createError({ statusCode: 400, message: '创建文档不接受查询参数' })
  return createEnterpriseCodocsDocument(event, () => readBody<Record<string, unknown>>(event), getHeader(event, 'idempotency-key') || '')
}

// Shared by JSON creation and each validated multipart item. It remains the
// only Host metadata/initial-body writer, with a fresh permit per invocation.
export async function createEnterpriseCodocsDocument(event: H3Event, readInput: () => Promise<Record<string, unknown>>, key: string) {
  setHeader(event, 'Cache-Control', 'no-store')
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{7,199}$/.test(key)) throw createError({ statusCode: 400, message: '创建文档需要有效的 Idempotency-Key' })
  const user = await requireEnterpriseCodocsCreation(event)
  const body = await readInput()
  return persistEnterpriseCodocsDocument(event, user, body, key)
}

export async function requireEnterpriseCodocsCreation(event: H3Event) {
  const user = await requireEnterpriseUser(event)
  await prepareEnterpriseRuntime(event, operation)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  if (!authorizationResourcesAllow(snapshot.resources, 'documents', 'create', snapshot.actionPolicies?.documents)) {
    throw createError({ statusCode: 403, message: '缺少文档创建权限' })
  }
  return user
}

async function persistEnterpriseCodocsDocument(event: H3Event, user: Awaited<ReturnType<typeof requireEnterpriseUser>>, body: Record<string, unknown>, key: string) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.has(key))
    || typeof body.title !== 'string' || !body.title.trim() || [...body.title].length > 255
    || (body.doc_type !== undefined && (typeof body.doc_type !== 'string' || !['private', 'slide', 'worklog', 'weekly-report'].includes(body.doc_type)))
    || (body.content !== undefined && typeof body.content !== 'string')
    || (body.folder_id != null && (!Number.isSafeInteger(body.folder_id) || Number(body.folder_id) < 1))) {
    throw createError({ statusCode: 400, message: '文档创建字段无效' })
  }
  if ('owner_uid' in body && body.owner_uid !== user.uid) throw createError({ statusCode: 403, message: '不能为其他用户创建私人文档' })
  const bytes = Buffer.from(typeof body.content === 'string' ? body.content : '', 'utf8')
  if (bytes.length > 10 * 1024 * 1024) throw createError({ statusCode: 413, message: '文档正文超过 10 MiB' })
  const kind = String(body.doc_type || 'private')
  const result = await callEnterpriseRuntime(event, operation, {
    tenant: user.tenant, deployment: user.deployment,
    payload: { title: body.title.trim(), doc_type: kind, folder_id: body.folder_id ?? null, content_sha256: createHash('sha256').update(bytes).digest('hex'), content_size: bytes.length },
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'personal-documents', action: 'create', expiresAt: enterpriseRuntimePermitExpiresAt() }
  }, { idempotencyKey: key }) as { success?: boolean, data?: { id?: number, uuid?: string, title?: string, doc_type?: string, oss_path?: string } }
  const doc = result?.data
  if (result?.success !== true || !doc || typeof doc.uuid !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(doc.uuid)
    || doc.doc_type !== kind || doc.title !== body.title.trim() || typeof doc.oss_path !== 'string'
    || !new RegExp(`^codocs/document-creations/${doc.uuid}/[0-9a-f]{64}\\.md$`).test(doc.oss_path)) {
    throw createError({ statusCode: 503, message: '文档创建响应无效' })
  }
  try {
    const client = await createRuntimeOSSClient({ event })
    try {
      await client.head(doc.oss_path)
      // A replay must not replace edits made by the standalone editor.
      return result
    } catch (error) {
      if (!missingObject(error)) throw error
    }
    try {
      await client.put(doc.oss_path, bytes, { forbidOverwrite: true, headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
    } catch (error) {
      const e = error as { status?: number, statusCode?: number, code?: string }
      if (![409, 412].includes(e.status || e.statusCode || 0) && e.code !== 'FileAlreadyExists') throw error
      // Concurrent retries may both observe absence; confirm the winner's
      // object exists, never retry with an unconditional overwrite.
      await client.head(doc.oss_path)
    }
  } catch {
    throw createError({ statusCode: 503, message: '文档正文尚未保存，请使用相同请求重试' })
  }
  return result
}
