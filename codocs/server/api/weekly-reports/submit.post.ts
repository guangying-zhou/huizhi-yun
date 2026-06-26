/**
 * 提交（发布）部门周报
 * POST /api/weekly-reports/submit
 * body: { uuid }
 *
 * 1. 校验当前用户是部门负责人
 * 2. 将文档置为只读 (readonly_flag = 1)
 * 3. 向部门成员、分管领导、上级部门负责人发送通知
 */

import { requireRequestUid } from '~~/server/utils/authIdentity'
import { fetchDirectoryData } from '~~/server/utils/directoryCompat'
import { getCodocsDocumentMetadata, updateCodocsDocumentMetadata } from '~~/server/utils/codocsRuntime'
import type { Department, DepartmentResponse } from '~/types/account'

interface DocumentRow {
  uuid: string
  title: string
  dept_code: string
  owner_uid: string
  readonly_flag: number
}

interface DeptMembersData {
  items?: Array<{ uid?: string }>
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { uuid } = body
  const operatorUid = requireRequestUid(event)

  if (!uuid) {
    throw createError({ statusCode: 400, message: '缺少参数: uuid' })
  }

  const doc = await getCodocsDocumentMetadata(event, uuid, { actorUid: operatorUid }) as DocumentRow
  if (doc.readonly_flag) {
    throw createError({ statusCode: 400, message: '该周报已提交' })
  }

  // 2. 校验部门负责人身份
  const config = useRuntimeConfig()

  const deptRes = await fetchDirectoryData<DepartmentResponse>('/departments')
  const allDepts = deptRes.flat || []
  const dept = allDepts.find(d => d.deptCode === doc.dept_code)

  if (!dept || (dept.managerId !== operatorUid && dept.leaderId !== operatorUid)) {
    throw createError({ statusCode: 403, message: '仅部门负责人可以提交周报' })
  }

  // 3. 置为只读
  await updateCodocsDocumentMetadata(event, uuid, { readonlyFlag: true, actorUid: operatorUid })

  // 4. 收集通知对象
  const notifyUids = new Set<string>()

  // 4a. 部门成员
  try {
    const membersRes = await fetchDirectoryData<DeptMembersData>(
      `/departments/${encodeURIComponent(doc.dept_code)}/members`,
      { timeout: 10000 }
    )
    if (Array.isArray(membersRes.items)) {
      membersRes.items.forEach((m) => {
        if (m.uid) notifyUids.add(m.uid)
      })
    }
  } catch (e) {
    console.warn('[WeeklyReport/Submit] Failed to fetch dept members:', e)
  }

  // 4b. 分管领导
  if (dept.leaderId) notifyUids.add(dept.leaderId)

  // 4c. 上级部门负责人
  if (dept.parentId) {
    const parentDept = allDepts.find((d: Department) => d.deptCode === dept.parentId)
    if (parentDept) {
      if (parentDept.managerId) notifyUids.add(parentDept.managerId)
      if (parentDept.leaderId) notifyUids.add(parentDept.leaderId)
    }
  }

  // 排除自己
  notifyUids.delete(operatorUid)

  // 5. 发送通知
  if (notifyUids.size > 0) {
    const baseUrl = (config.public.siteUrl || 'https://codocs.wiztek.cn') as string
    try {
      await sendNotification({
        touser: [...notifyUids],
        title: '部门周报发布通知',
        description: `${dept.name}发布了${doc.title}，请查阅。`,
        url: `${baseUrl}/departments/weekly-reports?dept=${doc.dept_code}`,
        btntxt: '查看周报'
      })
    } catch (e) {
      console.warn('[WeeklyReport/Submit] Notification failed:', e)
    }
  }

  return { success: true, data: { uuid, notifiedCount: notifyUids.size } }
})
