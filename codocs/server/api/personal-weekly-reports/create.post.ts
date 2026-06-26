/**
 * 创建个人工作周报
 * POST /api/personal-weekly-reports/create
 * body: { owner_uid, owner_realname, year, week }
 *
 * 文件命名: YYYY-Wnn-个人工作周报
 * OSS 路径: codocs/worklogs/{owner_uid}/weekly/YYYY-Wnn-个人工作周报.md
 * 同时在 documents 表创建记录（doc_type = 'private'）
 */

import { uploadDocument } from '../../utils/oss'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { callCodocsTenantRuntime, createCodocsDocumentMetadata } from '~~/server/utils/codocsRuntime'

interface WeeklyReportRow { uuid: string, title: string }

/**
 * 计算指定年份第几周的起止日期（ISO 周：周一为一周的开始）
 */
function getWeekDateRange(year: number, week: number): { start: string, end: string } {
  const jan4 = new Date(year, 0, 4)
  const dayOfWeek = jan4.getDay() || 7
  const week1Monday = new Date(jan4)
  week1Monday.setDate(jan4.getDate() - dayOfWeek + 1)

  const targetMonday = new Date(week1Monday)
  targetMonday.setDate(week1Monday.getDate() + (week - 1) * 7)

  const targetSunday = new Date(targetMonday)
  targetSunday.setDate(targetMonday.getDate() + 6)

  const fmt = (d: Date) => {
    const yy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yy}年${mm}月${dd}日`
  }

  return {
    start: fmt(targetMonday),
    end: fmt(targetSunday)
  }
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { owner_uid, owner_realname, year, week } = body
  const operatorUid = requireRequestUid(event)

  if (!owner_uid || !year || !week) {
    throw createError({
      statusCode: 400,
      message: '缺少参数: owner_uid, year, week'
    })
  }

  const weekNum = parseInt(week)
  const yearNum = parseInt(year)

  if (weekNum < 1 || weekNum > 53) {
    throw createError({
      statusCode: 400,
      message: '周数无效，应为 1-53'
    })
  }

  const weekStr = String(weekNum).padStart(2, '0')
  const displayName = owner_realname || owner_uid
  const title = `${yearNum}-W${weekStr}-${displayName}工作周报`
  const ossPath = `codocs/worklogs/${owner_uid}/weekly/${title}.md`

  // 检查是否已存在
  const existingPage = await callCodocsTenantRuntime<{ items?: WeeklyReportRow[] }>(event, '/v1/codocs/documents', {
    query: { owner: owner_uid, limit: 5000 },
    scope: 'codocs.read'
  })
  const existing = (existingPage.items || []).find(item => item.title === title)
  if (existing) {
    return {
      success: true,
      data: {
        uuid: existing.uuid,
        title,
        existed: true
      }
    }
  }

  // 计算日期范围
  const { start: dateStart, end: dateEnd } = getWeekDateRange(yearNum, weekNum)

  // 当前日期（填报日期）
  const now = new Date()
  const todayStr = `${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月${String(now.getDate()).padStart(2, '0')}日`
  const fillerName = owner_realname || ''

  // 初始内容模板
  const content = `# ${title}

| 项目 | 内容 |
|------|------|
| **姓名** | ${fillerName} |
| **日期范围** | ${dateStart} ~ ${dateEnd} |
| **填报日期** | ${todayStr} |

---

## 一、上周计划完成情况

| 序号 | 计划事项 | 完成情况 | 完成率 | 未完成原因 |
|------|----------|----------|--------|------------|
| 1 |  |  |  |  |
| 2 |  |  |  |  |
| 3 |  |  |  |  |

## 二、本周工作内容及完成情况

| 序号 | 工作内容 | 所属项目 | 完成情况 | 耗时(h) | 备注 |
|------|----------|----------|----------|---------|------|
| 1 |  |  |  |  |  |
| 2 |  |  |  |  |  |
| 3 |  |  |  |  |  |

## 三、下周工作计划

| 序号 | 计划事项 | 所属项目 | 预计完成时间 | 优先级 |
|------|----------|----------|-------------|--------|
| 1 |  |  |  |  |
| 2 |  |  |  |  |
| 3 |  |  |  |  |

## 四、需要协调/支持的事项

| 序号 | 事项描述 | 需要谁协助 | 期望时间 |
|------|----------|-----------|----------|
| 1 |  |  |  |

## 五、本周学习与成长

-

## 六、其他事项

`

  const doc = await createCodocsDocumentMetadata(event, {
    title,
    docType: 'private',
    ownerUid: owner_uid,
    operatorUid,
    ossPath,
    contentSize: Buffer.byteLength(content, 'utf-8')
  })

  await uploadDocument(doc.oss_path || ossPath, content)

  return {
    success: true,
    data: {
      uuid: doc.uuid,
      title,
      oss_path: doc.oss_path || ossPath,
      existed: false
    }
  }
})
