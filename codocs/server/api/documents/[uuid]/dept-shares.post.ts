/**
 * 发起文档移交到部门
 * POST /api/documents/:uuid/dept-shares
 *
 * Body: { deptCode, departmentName }
 * 创建待确认的部门移交记录，通知部门负责人
 */
import { fetchUserDepartments } from '~~/server/utils/userDepartments'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { fetchDirectoryData } from '~~/server/utils/directoryCompat'
import { callCodocsTenantRuntime, getCodocsDocumentMetadata } from '~~/server/utils/codocsRuntime'
import type { AccountUser, Department } from '~/types/account'

interface UserDeptNode {
  deptCode: string
  children?: UserDeptNode[]
}

interface DocumentTransferRow {
  id: number
  uuid: string
  title: string
  owner_uid: string
  dept_code: string | null
  doc_type: string
  readonly_flag?: number
}

function hasDeptCode(nodes: UserDeptNode[], targetDeptCode: string): boolean {
  for (const node of nodes) {
    if (node.deptCode === targetDeptCode) return true
    if (Array.isArray(node.children) && hasDeptCode(node.children, targetDeptCode)) {
      return true
    }
  }
  return false
}

export default defineEventHandler(async (event) => {
  const uuid = getRouterParam(event, 'uuid')
  const uid = requireRequestUid(event)

  const { deptCode, departmentName, message } = await readBody(event)
  if (!uuid || !deptCode) {
    throw createError({ statusCode: 400, message: '缺少必填参数' })
  }

  const doc = await getCodocsDocumentMetadata(event, uuid, { actorUid: uid }) as DocumentTransferRow

  if (doc.owner_uid !== uid) {
    throw createError({ statusCode: 403, message: '仅文档所有者可发起移交' })
  }

  if (doc.doc_type !== 'private') {
    throw createError({ statusCode: 400, message: '当前仅支持移交个人文档' })
  }

  if (doc.readonly_flag === 1) {
    throw createError({ statusCode: 403, message: '当前文档为只读状态，无法移交' })
  }

  const { departments, primaryDeptCode } = await fetchUserDepartments(uid)
  const canTransferToDept = hasDeptCode(departments as UserDeptNode[], deptCode) || primaryDeptCode === deptCode
  if (!canTransferToDept) {
    throw createError({ statusCode: 403, message: '仅可移交到你关联的部门或委员会' })
  }

  // 检查重复
  const existing = await callCodocsTenantRuntime<{ items?: Array<{ id: number }> }>(event, '/v1/codocs/dept-shares', {
    query: { document_id: doc.id, dept_code: deptCode, status: 'pending' },
    scope: 'codocs.read'
  })
  if ((existing.items || []).length > 0) {
    throw createError({ statusCode: 409, message: '已有待确认的移交请求' })
  }

  await callCodocsTenantRuntime(event, '/v1/codocs/dept-shares', {
    method: 'POST',
    scope: 'codocs.write',
    body: {
      document_id: doc.id,
      document_uuid: doc.uuid,
      document_title: doc.title,
      mode: 'transfer',
      from_uid: uid,
      shared_by: uid,
      from_dept_code: doc.dept_code || '',
      dept_code: deptCode,
      department_name: departmentName || '',
      message: message || null
    }
  })

  // 通知部门负责人（企业微信）
  try {
    const sharerUser = await fetchDirectoryData<AccountUser>(`/users/${encodeURIComponent(uid)}`)
    const sharerName = sharerUser?.realName || uid
    const config = useRuntimeConfig()
    const department = await fetchDirectoryData<Department>(`/departments/${encodeURIComponent(deptCode)}`)
    const managerUids = [department?.managerId, department?.leaderId].filter((item): item is string => Boolean(item))

    if (managerUids.length > 0) {
      const baseUrl = (config.public as Record<string, string>).siteUrl || 'https://codocs.wiztek.cn'
      await sendNotification({
        touser: managerUids,
        title: '文档移交待接收',
        description: `${sharerName} 申请将文档《${doc.title}》移交至您的部门，请确认接收${message ? '\n附言：' + message : ''}`,
        url: `${baseUrl}/departments`,
        btntxt: '查看详情'
      })
    }
  } catch (e) {
    console.warn('[DeptShare] Failed to notify:', e)
  }

  return { code: 0, message: 'success' }
})
