import { createHash } from 'node:crypto'
import { createError, getHeader, getRequestURL, getRouterParam, setHeader, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { loadAuthorizationSnapshotFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { authorizationResourcesAllow } from '@hzy/foundation/shared/utils/authorizationActions'
import { createRuntimeOSSClient } from '../../../codocs/server/utils/oss'

const operations = {
  list: 'codocs.personal-document-versions-list',
  view: 'codocs.personal-document-version-view',
  documentView: 'codocs.personal-document-view',
  delete: 'codocs.personal-document-version-delete'
} as const
type Operation = Parameters<typeof callEnterpriseRuntime>[1]
type VersionRow = {
  id: number
  version_num?: number
  versionNum?: number
  oss_version_id?: string | null
  ossVersionId?: string | null
  object_key?: string | null
  objectKey?: string | null
  editor_uid?: string | null
  editorUid?: string | null
  content_size?: number
  contentSize?: number
  content_sha256?: string | null
  contentSha256?: string | null
  created_at?: string
  createdAt?: string
}

export const VERSION_EXPIRED_MESSAGE = '该历史版本已超过 30 天保留期，正文已不可用'

const uuidPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/
const versionPattern = /^[1-9][0-9]*$/
const keyPattern = /^[A-Za-z0-9][A-Za-z0-9:_-]{7,199}$/

function operation(action: keyof typeof operations) {
  // The operation registry is intentionally owned by Foundation. This cast
  // keeps this module independently reviewable while the host registration is
  // added alongside the delegated Data Runtime route by the integrator.
  return operations[action] as Operation
}

function requireUUID(event: H3Event) {
  const uuid = String(getRouterParam(event, 'uuid') || '').trim()
  if (!uuidPattern.test(uuid) || getRequestURL(event).search) throw createError({ statusCode: 400, message: '文档版本标识无效' })
  return uuid
}

function requireVersionID(event: H3Event) {
  const versionId = String(getRouterParam(event, 'versionId') || '').trim()
  if (!versionPattern.test(versionId) || !Number.isSafeInteger(Number(versionId))) throw createError({ statusCode: 400, message: '版本标识无效' })
  return versionId
}

async function authorize(event: H3Event, action: 'read' | 'edit') {
  const user = await requireEnterpriseUser(event)
  const selected = operation(action === 'read' ? 'list' : 'delete')
  await prepareEnterpriseRuntime(event, selected)
  const snapshot = await loadAuthorizationSnapshotFromConsoleRuntime(user.uid, 'codocs', event)
  const businessAction = action === 'read' ? 'view' : action
  if (!authorizationResourcesAllow(snapshot.resources, 'documents', businessAction, snapshot.actionPolicies?.documents)) {
    throw createError({ statusCode: 403, message: action === 'read' ? '缺少文档版本查看权限' : '缺少文档版本管理权限' })
  }
  return user
}

function permit(user: Awaited<ReturnType<typeof requireEnterpriseUser>>, action: 'read' | 'edit') {
  return {
    actorUid: user.uid,
    tenant: user.tenant,
    deployment: user.deployment,
    resource: 'personal-documents',
    action,
    expiresAt: enterpriseRuntimePermitExpiresAt()
  }
}

function rowsFromResponse(response: unknown): VersionRow[] {
  const envelope = response as { success?: boolean, data?: unknown }
  if (envelope?.success !== true || !envelope.data || typeof envelope.data !== 'object') throw createError({ statusCode: 503, message: '文档版本响应无效' })
  const data = envelope.data as { items?: unknown[] } | unknown[]
  const rows = Array.isArray(data) ? data : data && Array.isArray(data.items) ? data.items : null
  if (!rows) throw createError({ statusCode: 503, message: '文档版本列表响应无效' })
  return rows.map((value) => {
    const row = value as VersionRow
    const id = Number(row?.id)
    if (!Number.isSafeInteger(id) || id < 1) throw createError({ statusCode: 503, message: '文档版本记录无效' })
    return row
  })
}

function versionResponse(row: VersionRow) {
  const versionNum = Number(row.version_num ?? row.versionNum)
  const contentSize = Number(row.content_size ?? row.contentSize ?? 0)
  const editorUid = row.editor_uid ?? row.editorUid ?? null
  const createdAt = row.created_at ?? row.createdAt
  if (!Number.isSafeInteger(versionNum) || versionNum < 1 || !Number.isSafeInteger(contentSize) || contentSize < 0
    || (editorUid !== null && typeof editorUid !== 'string') || typeof createdAt !== 'string' || !createdAt) {
    throw createError({ statusCode: 503, message: '文档版本记录无效' })
  }
  const ossVersionId = row.oss_version_id ?? row.ossVersionId ?? null
  const contentSha256 = row.content_sha256 ?? row.contentSha256 ?? null
  // v2 history rows name their exact snapshot object; others live at oss_path.
  const objectKey = row.object_key ?? row.objectKey ?? null
  if ((objectKey !== null && (typeof objectKey !== 'string' || !objectKey.startsWith('codocs/snapshots/')))
    || (ossVersionId !== null && typeof ossVersionId !== 'string') || (contentSha256 !== null && typeof contentSha256 !== 'string')) {
    throw createError({ statusCode: 503, message: '文档版本存储信息无效' })
  }
  return {
    id: Number(row.id), versionNum, ossVersionId, editorUid,
    editorName: editorUid || '未知用户', editorAvatar: null,
    contentSize, contentSha256, createdAt, objectKey
  }
}

async function readRows(event: H3Event, uuid: string, user: Awaited<ReturnType<typeof requireEnterpriseUser>>) {
  const response = await callEnterpriseRuntime(event, operation('list'), {
    tenant: user.tenant, deployment: user.deployment, code: uuid, query: {}, authorization: permit(user, 'read')
  })
  return rowsFromResponse(response)
}

async function readVersion(event: H3Event, uuid: string, versionId: string, user: Awaited<ReturnType<typeof requireEnterpriseUser>>): Promise<VersionRow> {
  const response = await callEnterpriseRuntime(event, operation('view'), {
    tenant: user.tenant, deployment: user.deployment, code: uuid, objectId: versionId, query: {}, authorization: permit(user, 'read')
  }) as { success?: boolean, data?: VersionRow }
  const row = response?.data
  if (response?.success !== true || !row || !Number.isSafeInteger(Number(row.id)) || String(row.id) !== versionId) {
    throw createError({ statusCode: 503, message: '文档版本详情响应无效' })
  }
  return row
}

export async function enterpriseCodocsVersionsList(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const uuid = requireUUID(event)
  const user = await authorize(event, 'read')
  return { success: true, data: (await readRows(event, uuid, user)).map(versionResponse) }
}

export async function enterpriseCodocsVersionView(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const uuid = requireUUID(event)
  const versionId = requireVersionID(event)
  const user = await authorize(event, 'read')
  const row = await readVersion(event, uuid, versionId, user)
  const version = versionResponse(row)
  if (!version.ossVersionId) throw createError({ statusCode: 400, message: '版本数据不完整，该版本可能是在开启 OSS 版本控制之前创建的' })

  const metadata = await callEnterpriseRuntime(event, operation('documentView'), {
    tenant: user.tenant, deployment: user.deployment, code: uuid, query: {}, authorization: permit(user, 'read')
  }) as { success?: boolean, data?: { uuid?: string, oss_path?: string | null, doc_type?: string } }
  if (metadata?.success !== true || metadata.data?.uuid !== uuid || typeof metadata.data.oss_path !== 'string' || typeof metadata.data.doc_type !== 'string') {
    throw createError({ statusCode: 503, message: '文档版本元数据响应无效' })
  }
  let content: Buffer
  try {
    const client = await createRuntimeOSSClient({ event })
    const object = await client.get(version.objectKey ?? metadata.data.oss_path, { versionId: version.ossVersionId })
    content = object.content
  } catch (error) {
    const status = error as { status?: number, statusCode?: number, code?: string }
    if (status.status === 404 || status.statusCode === 404 || status.code === 'NoSuchKey') {
      // The storage lifecycle deletes superseded versions 30 days after they are
      // replaced (accepted retention, 2026-09-23). Only a superseded version can
      // expire; a missing current version is a real inconsistency.
      const latest = Math.max(...(await readRows(event, uuid, user)).map(item => Number(item.version_num ?? item.versionNum) || 0))
      // Only overwritten v1 versions expire; v2 snapshot objects are never replaced.
      if (version.objectKey === null && version.versionNum < latest) {
        throw createError({ statusCode: 410, message: VERSION_EXPIRED_MESSAGE, data: { code: 'codocs_version_expired', message: VERSION_EXPIRED_MESSAGE } })
      }
      throw createError({ statusCode: 404, message: '版本正文不存在' })
    }
    throw createError({ statusCode: 503, message: '文档版本存储暂不可用' })
  }
  // Legacy rows can predate the content digest. For rows with a digest, never
  // render bytes from the wrong object version or a truncated storage response.
  if (version.contentSha256 !== null) {
    if (!/^[a-f0-9]{64}$/.test(version.contentSha256)
      || content.length !== version.contentSize
      || createHash('sha256').update(content).digest('hex') !== version.contentSha256) {
      throw createError({ statusCode: 503, message: '文档版本正文校验失败' })
    }
  }
  return { success: true, data: { content: content.toString('utf-8'), versionNum: version.versionNum, editorUid: version.editorUid, createdAt: version.createdAt } }
}

export async function enterpriseCodocsVersionDelete(event: H3Event) {
  setHeader(event, 'Cache-Control', 'no-store')
  const uuid = requireUUID(event)
  const versionId = requireVersionID(event)
  const key = String(getHeader(event, 'idempotency-key') || '').trim()
  if (!keyPattern.test(key) || Number(getHeader(event, 'content-length') || 0) > 0 || getHeader(event, 'transfer-encoding')) {
    throw createError({ statusCode: 400, message: '删除版本只接受文档、版本标识和有效的 Idempotency-Key' })
  }
  const user = await authorize(event, 'edit')
  return callEnterpriseRuntime(event, operation('delete'), {
    tenant: user.tenant, deployment: user.deployment, code: uuid, objectId: versionId, query: {}, authorization: permit(user, 'edit')
  }, { idempotencyKey: key })
}
