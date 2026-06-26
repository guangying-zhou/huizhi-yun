import { fetchDirectoryUser } from '~~/server/utils/directoryCompat'
import { resolveDepartmentAccess } from '~~/server/utils/departmentAccess'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { callCodocsTenantRuntime, getCodocsDocumentMetadata } from '~~/server/utils/codocsRuntime'

interface DocumentSharesPostRow {
  id: number
  owner_uid: string
  title: string
  doc_type: string | null
  dept_code: string | null
  readonly_flag: number
}

export default defineEventHandler(async (event) => {
  const documentId = getRouterParam(event, 'uuid')
  const body = await readBody(event)
  const { sharedToUid, uid, permission, ownerName, message } = body
  const actorUid = requireRequestUid(event)

  if (!documentId || (!sharedToUid && !uid)) {
    throw createError({ statusCode: 400, message: 'Missing required fields' })
  }

  // codocs 中 document_shares.shared_to_uid 存储的是 Account 的 uid（字符串）
  const targetUid = String(sharedToUid || uid || '').trim()
  if (!targetUid) {
    throw createError({ statusCode: 400, message: 'Missing target uid' })
  }

  const doc = await getCodocsDocumentMetadata(event, documentId, { actorUid }) as DocumentSharesPostRow
  const ownerUid = doc.owner_uid
  const docTitle = doc.title || '未命名文档'
  const isDepartmentDocument = doc.doc_type === 'department' && !!doc.dept_code

  if (!actorUid || actorUid !== ownerUid) {
    throw createError({ statusCode: 403, message: '仅文档所有者可管理共享' })
  }

  if (doc.readonly_flag === 1) {
    throw createError({ statusCode: 403, message: '当前文档为只读状态，无法管理共享' })
  }

  const config = useRuntimeConfig()
  const baseUrl = config.public.siteUrl || 'https://codocs.wiztek.cn'
  const messageSuffix = message ? `\n附言：${message}` : ''

  if (isDepartmentDocument) {
    const access = await resolveDepartmentAccess(targetUid, doc.dept_code!)
    const shouldNotifyOnly = access && ['member', 'dept_manager', 'dept_leader'].includes(access.role)

    if (shouldNotifyOnly) {
      try {
        const sharerUser = await fetchDirectoryUser(ownerUid)
        const sharerName = sharerUser?.realName || ownerName || ownerUid

        await sendNotification({
          touser: targetUid,
          title: '部门文档协同提醒',
          description: `${sharerName}提醒你可对部门文档《${docTitle}》进行协同编辑${messageSuffix}`,
          url: `${baseUrl}/documents/${documentId}`,
          btntxt: '查看文档'
        })
      } catch (error) {
        console.error('[DocumentShare] Department reminder notification failed:', error)
      }

      return {
        success: true,
        code: 0,
        message: 'success',
        data: {
          notifiedOnly: true
        }
      }
    }
  }

  await callCodocsTenantRuntime(event, `/v1/codocs/documents/${encodeURIComponent(documentId)}/shares`, {
    method: 'POST',
    scope: 'codocs.write',
    body: {
      sharedToUid: targetUid,
      permission: permission || 'read',
      message: message || null,
      actorUid
    }
  })

  if (targetUid) {
    try {
      const sharerUser = await fetchDirectoryUser(ownerUid)
      const sharerName = sharerUser?.realName || ownerName || ownerUid

      await sendNotification({
        touser: targetUid,
        title: '文档共享通知',
        description: permission === 'write'
          ? `${sharerName}共享了文档《${docTitle}》，邀请您协同编辑${messageSuffix}`
          : `${sharerName}向您共享了文档《${docTitle}》，请查阅${messageSuffix}`,
        url: `${baseUrl}/documents/${documentId}`,
        btntxt: '查看文档'
      })
    } catch (error) {
      // 通知失败不影响共享操作
      console.error('[DocumentShare] Notification failed:', error)
    }
  }

  return {
    success: true,
    code: 0,
    message: 'success',
    data: {
      notifiedOnly: false
    }
  }
})
