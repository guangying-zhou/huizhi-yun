/**
 * 部门开放文档预览
 * GET /api/open-department-docs/:uuid
 */
import { downloadDocument } from '~~/server/utils/oss'
import { requireRequestUid } from '~~/server/utils/authIdentity'
import { requireOpenDepartmentDocument } from '~~/server/utils/openDepartmentDocs'
import { hasMeaningfulMarkdownContent, recoverMarkdownFromYjsSnapshot } from '~~/server/utils/yjsMarkdownRecovery'

export default defineEventHandler(async (event) => {
  const uuid = getRouterParam(event, 'uuid')
  if (!uuid) {
    throw createError({ statusCode: 400, message: '文档 UUID 不能为空' })
  }

  requireRequestUid(event)
  const doc = await requireOpenDepartmentDocument(event, uuid)

  let content = ''
  if (doc.oss_path) {
    content = (await downloadDocument(doc.oss_path, doc.doc_type)) || ''
    if (!hasMeaningfulMarkdownContent(content)) {
      content = await recoverMarkdownFromYjsSnapshot(doc.oss_path, doc.doc_type)
    }
  }

  return {
    success: true,
    data: {
      ...doc,
      content,
      readonly_flag: 1,
      readonly: true
    }
  }
})
