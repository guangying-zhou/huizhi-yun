/**
 * 接收/拒绝部门文档移交
 * PATCH /api/dept-shares/:id
 */
import { fetchDirectoryUser } from '~~/server/utils/directoryCompat'
import { requireDepartmentManagerAccess } from '~~/server/utils/departmentAccess'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'

interface DeptShareRow {
  id: number
  document_uuid?: string | null
  mode: 'share' | 'transfer'
  dept_code: string
  department_name?: string | null
  from_uid?: string | null
  shared_by?: string | null
  document_title?: string | null
  status: string
}

async function notifyShareSender(share: DeptShareRow, handlerUid: string, action: 'accept' | 'reject') {
  const fromUid = share.from_uid || share.shared_by
  if (!fromUid) return

  try {
    const handlerUser = await fetchDirectoryUser(handlerUid)
    const handlerName = handlerUser?.realName || handlerUid
    const deptName = share.department_name || share.dept_code
    const config = useRuntimeConfig()
    const baseUrl = (config.public as Record<string, string>).siteUrl || 'https://codocs.wiztek.cn'
    const actionText = action === 'accept' ? '已接收' : '已拒绝'
    const actionSubject = share.mode === 'transfer' ? '文档移交' : '部门共享'

    await sendNotification({
      touser: fromUid,
      title: `${actionSubject}${actionText}`,
      description: `${handlerName}${actionText}${deptName} 的文档《${share.document_title || '未命名文档'}》`,
      url: share.document_uuid ? `${baseUrl}/documents/${share.document_uuid}` : `${baseUrl}/mydocs`,
      btntxt: '查看文档'
    })
  } catch (error) {
    console.warn('[DeptShare] Failed to notify sender:', error)
  }
}

export default defineEventHandler(async (event) => {
  const uid = requireRequestUid(event)
  const id = getRouterParam(event, 'id')
  const { action } = await readBody(event)

  if (!id || !['accept', 'reject'].includes(action)) {
    throw createError({ statusCode: 400, message: '参数错误' })
  }

  const share = await callCodocsTenantRuntime<DeptShareRow>(event, `/v1/codocs/dept-shares/${encodeURIComponent(id)}`, {
    scope: 'codocs.read'
  })
  if (share.status !== 'pending') {
    throw createError({ statusCode: 404, message: '记录不存在或已处理' })
  }

  await requireDepartmentManagerAccess(uid, share.dept_code, '仅部门经理可接收或拒绝移交文档')

  const nextStatus = action === 'accept' ? 'accepted' : 'rejected'
  await callCodocsTenantRuntime(event, `/v1/codocs/dept-shares/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    scope: 'codocs.write',
    body: {
      status: nextStatus,
      accepted_by: uid,
      handled_by: uid,
      handled_at: new Date().toISOString()
    }
  })

  await notifyShareSender(share, uid, action)

  return {
    code: 0,
    message: action === 'accept' ? '已接收' : '已拒绝',
    data: { documentUuid: share.document_uuid || null }
  }
})
