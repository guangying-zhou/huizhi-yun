/**
 * 预览部门资产文件内容
 * GET /api/dept-assets/preview?path=codocs/departments/xxx/records/yyy.md
 */
export default defineEventHandler(async (event) => {
  const { path: ossPath } = getQuery(event) as { path: string }

  if (!ossPath || !ossPath.startsWith('codocs/departments/')) {
    throw createError({ statusCode: 400, message: '无效的文件路径' })
  }

  const content = await downloadDocument(ossPath, 'department')
  if (content === null) {
    throw createError({ statusCode: 404, message: '文件不存在' })
  }

  return { code: 0, data: { content } }
})
