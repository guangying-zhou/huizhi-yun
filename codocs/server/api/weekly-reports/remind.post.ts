/**
 * 提醒填报/上报周报
 * POST /api/weekly-reports/remind
 * body: {
 *   type: 'dept-report' | 'personal-report'
 *   dept_code: string        // 部门编码
 *   dept_name: string        // 部门名称
 *   target_uid?: string      // 被提醒人 uid（个人周报时必填）
 *   target_name?: string     // 被提醒人姓名
 *   year: number
 *   week: number
 * }
 *
 * 权限：
 * - 个人周报提醒：部门经理、分管领导、上级部门负责人
 * - 部门周报提醒：分管领导、上级部门负责人
 */

import { requireRequestUid } from '~~/server/utils/authIdentity'
import { fetchDirectoryData } from '~~/server/utils/directoryCompat'
import {
  buildCodocsNotification,
  codocsNotificationIdempotencyKey,
  requireCodocsNotificationRequestKey
} from '~~/server/utils/codocsNotificationBuilders'
import type { DepartmentResponse } from '~/types/account'

export default defineEventHandler(async (event) => {
  const operatorUid = requireRequestUid(event)
  const body = await readBody(event)
  const { type, dept_code, dept_name, target_uid, target_name, year, week } = body

  if (!type || !dept_code || !year || !week) {
    throw createError({ statusCode: 400, message: '缺少参数' })
  }
  if (type === 'personal-report' && !target_uid) {
    throw createError({ statusCode: 400, message: '缺少 target_uid' })
  }

  // 获取部门信息
  const config = useRuntimeConfig()
  const deptRes = await fetchDirectoryData<DepartmentResponse>('/departments')
  const allDepts = deptRes.flat || []
  const dept = allDepts.find(d => d.deptCode === dept_code)

  if (!dept) {
    throw createError({ statusCode: 404, message: '部门不存在' })
  }

  // 权限校验
  const isManager = dept.managerId === operatorUid
  const isLeader = dept.leaderId === operatorUid
  const parentDept = dept.parentId ? allDepts.find(d => d.deptCode === dept.parentId) : null
  const isParentManager = parentDept?.managerId === operatorUid
  const isParentLeader = parentDept?.leaderId === operatorUid

  if (type === 'personal-report') {
    // 个人周报提醒：部门经理、分管领导、上级部门负责人
    if (!isManager && !isLeader && !isParentManager && !isParentLeader) {
      throw createError({ statusCode: 403, message: '无权发送提醒' })
    }
  } else if (type === 'dept-report') {
    // 部门周报提醒：分管领导、上级部门负责人（经理自己不用提醒自己）
    if (!isLeader && !isParentManager && !isParentLeader) {
      throw createError({ statusCode: 403, message: '无权发送提醒' })
    }
  } else {
    throw createError({ statusCode: 400, message: '无效的 type' })
  }

  const requestKey = requireCodocsNotificationRequestKey(event, 'Weekly report reminder')
  const weekStr = String(week).padStart(2, '0')
  const baseUrl = (config.public.siteUrl || 'https://codocs.wiztek.cn') as string

  // 发送通知
  if (type === 'personal-report') {
    const reminderBizId = `${dept_code}:${year}-W${weekStr}:${target_uid}`
    await sendNotification(buildCodocsNotification({
      touser: [target_uid],
      title: '工作周报填报提醒',
      description: `请尽快填写并上报 ${year}年第${weekStr}周 工作周报。`,
      url: `${baseUrl}/mydocs/weekly-reports`,
      btntxt: '填写周报',
      eventType: 'codocs.weekly_report.personal_reminder',
      category: 'weekly_report',
      severity: 'warning',
      bizType: 'weekly_report_reminder',
      bizId: reminderBizId,
      idempotencyKey: codocsNotificationIdempotencyKey('weekly-report-reminder', requestKey, type, reminderBizId),
      metadata: {
        notificationKind: 'manual_reminder',
        requestKeyHash: codocsNotificationIdempotencyKey('request', requestKey),
        departmentCode: dept_code,
        targetUid: target_uid,
        operatorUid,
        year,
        week
      }
    }))
  } else {
    // 提醒部门经理填报部门周报
    const notifyUids: string[] = []
    if (dept.managerId) notifyUids.push(dept.managerId)
    if (notifyUids.length === 0) {
      throw createError({ statusCode: 400, message: '该部门未设置负责人' })
    }
    const reminderBizId = `${dept_code}:${year}-W${weekStr}:department`
    await sendNotification(buildCodocsNotification({
      touser: notifyUids,
      title: '部门周报填报提醒',
      description: `请尽快填写并提交 ${dept_name || dept.name} ${year}年第${weekStr}周 工作周报。`,
      url: `${baseUrl}/departments/weekly-reports?dept=${dept_code}`,
      btntxt: '填写周报',
      eventType: 'codocs.weekly_report.department_reminder',
      category: 'weekly_report',
      severity: 'warning',
      bizType: 'weekly_report_reminder',
      bizId: reminderBizId,
      idempotencyKey: codocsNotificationIdempotencyKey('weekly-report-reminder', requestKey, type, reminderBizId),
      metadata: {
        notificationKind: 'manual_reminder',
        requestKeyHash: codocsNotificationIdempotencyKey('request', requestKey),
        departmentCode: dept_code,
        operatorUid,
        year,
        week
      }
    }))
  }

  return {
    success: true,
    data: {
      type,
      targetName: type === 'personal-report' ? (target_name || target_uid) : (dept_name || dept.name)
    }
  }
})
