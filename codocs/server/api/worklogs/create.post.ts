/**
 * 创建工作日志
 * POST /api/worklogs/create
 * body: { owner_uid, owner_realname, date: 'YYYYMMDD' }
 *
 * 文件命名: YYYYMMDD-{realName}工作日志
 * OSS 路径: codocs/worklogs/{username}/YYYYMMDD-{realName}工作日志.md
 * 同时在 documents 表创建记录（doc_type = 'private'）
 */

import { uploadDocument } from '../../utils/oss'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { callCodocsTenantRuntime, createCodocsDocumentMetadata } from '~~/server/utils/codocsRuntime'

interface WorklogRow { uuid: string, title: string }

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { owner_uid, owner_realname, date } = body
  const operatorUid = requireRequestUid(event)

  if (!owner_uid || !date) {
    throw createError({
      statusCode: 400,
      message: '缺少参数: owner_uid, date'
    })
  }

  // 验证日期格式 YYYYMMDD
  if (!/^\d{8}$/.test(date)) {
    throw createError({
      statusCode: 400,
      message: '日期格式错误，应为 YYYYMMDD'
    })
  }

  const displayName = owner_realname || owner_uid
  const title = `${date}-${displayName}工作日志`
  const ossPath = `codocs/worklogs/${owner_uid}/${title}.md`

  // 检查是否已存在（兼容新旧两种格式）
  const existingPage = await callCodocsTenantRuntime<{ items?: WorklogRow[] }>(event, '/v1/codocs/documents', {
    query: { owner: owner_uid, limit: 5000 },
    scope: 'codocs.read'
  })
  const existing = (existingPage.items || []).find(item => item.title === title || item.title === `工作日志_${date}`)
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

  // 格式化日期显示
  const y = date.substring(0, 4)
  const m = date.substring(4, 6)
  const d = date.substring(6, 8)
  const dateStr = `${y}年${m}月${d}日`
  const weekDays = ['日', '一', '二', '三', '四', '五', '六']
  const weekDay = weekDays[new Date(`${y}-${m}-${d}`).getDay()]

  // 初始内容模板
  const content = `# ${dateStr} 星期${weekDay} 工作日志

| 项目 | 内容 |
|------|------|
| **姓名** | ${displayName} |
| **日期** | ${dateStr} 星期${weekDay} |

---

## 今日工作

| 序号 | 工作内容 | 所属项目 | 完成情况 | 耗时(h) |
|------|----------|----------|----------|---------|
| 1 |  |  |  |  |
| 2 |  |  |  |  |
| 3 |  |  |  |  |

## 明日计划

| 序号 | 计划事项 | 所属项目 | 优先级 |
|------|----------|----------|--------|
| 1 |  |  |  |
| 2 |  |  |  |

## 遇到的问题/需要协调的事项

-

## 备注

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
