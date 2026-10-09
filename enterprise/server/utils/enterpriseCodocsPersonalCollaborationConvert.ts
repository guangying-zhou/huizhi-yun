import { createHash } from 'node:crypto'
import { createError, type H3Event } from 'h3'
import { callEnterpriseRuntime, enterpriseRuntimePermitExpiresAt, prepareEnterpriseRuntime, type requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'
import { readSnapshotHead, saveSnapshotV2 } from './enterpriseCodocsSnapshot'
import { readLegacyMarkdown } from './enterpriseCodocsDocumentContent'
import { assertNoActiveLegacyCollaboration } from './enterpriseCodocsDepartmentCollaboration'

type User = Awaited<ReturnType<typeof requireEnterpriseUser>>

// Only called after Runtime collaboration-open verified the writer ACL and
// refused an unpublished personal document. All writes recheck the same ACL
// under the owning document lock; browser content/path/digest are never used.
export async function ensurePersonalCollaborationSnapshot(event: H3Event, user: User, uuid: string) {
  const head = await readSnapshotHead(event, user, uuid)
  if (head.generation > 0) return
  await prepareEnterpriseRuntime(event, 'codocs.personal-document-view')
  const view = await callEnterpriseRuntime<{ success?: boolean, data?: Record<string, unknown> }>(event, 'codocs.personal-document-view', {
    tenant: user.tenant, deployment: user.deployment, code: uuid, query: {},
    authorization: { actorUid: user.uid, tenant: user.tenant, deployment: user.deployment, resource: 'personal-documents', action: 'read', expiresAt: enterpriseRuntimePermitExpiresAt() }
  })
  const doc = view?.data
  if (view?.success !== true || !doc || doc.uuid !== uuid) throw createError({ statusCode: 503, message: '文档元数据响应无效' })
  if (doc.doc_type !== 'private' || Number(doc.status) !== 1 || doc.readonly === true || Number(doc.readonly_flag ?? 0) !== 0 || typeof doc.oss_path !== 'string' || !doc.oss_path.endsWith('.md') || doc.oss_path.startsWith('recycle.bin/')) {
    throw createError({ statusCode: 409, message: '该文档不支持协作编辑', data: { code: 'personal_document_not_convertible' } })
  }
  try {
    await assertNoActiveLegacyCollaboration(event, doc)
  } catch (error) {
    const failure = error as { statusCode?: number, data?: { code?: string } }
    // A concurrent publication also updates updated_at. Its new v2 head,
    // rather than that legacy freshness proxy, now governs the document.
    if (failure.statusCode === 409 && failure.data?.code === 'document_v1_collaboration_active'
      && (await readSnapshotHead(event, user, uuid)).generation > 0) return
    throw error
  }
  const bytes = Buffer.from(await readLegacyMarkdown(event, doc.oss_path, 'private'), 'utf8')
  if (bytes.length > 10 * 1024 * 1024) throw createError({ statusCode: 413, message: '文档正文超过 10 MiB，无法转为协作文档' })
  // Stable across retries of this exact actor/body/base; other writers have
  // their own intent and generation 0 CAS permits only one publication.
  const key = `personal-convert:${createHash('sha256').update(['codocs.personal-convert.v1', user.tenant, user.deployment, user.uid, uuid, head.epoch, 0, createHash('sha256').update(bytes).digest('hex')].join('\0')).digest('hex')}`
  try {
    await saveSnapshotV2(event, user, uuid, key, bytes, { expectedGeneration: 0, expectedEpoch: head.epoch })
  } catch (error) {
    const failure = error as { statusCode?: number, data?: { code?: string, data?: { code?: string } } }
    const code = failure.data?.data?.code ?? failure.data?.code
    if (failure.statusCode !== 409 || code !== 'snapshot_generation_conflict') throw error
    // A concurrent writer won. Only a freshly authorized published head
    // permits joining; never swallow unrelated conflicts or failed storage.
    if ((await readSnapshotHead(event, user, uuid)).generation > 0) return
    throw error
  }
}
