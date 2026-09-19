import { uploadProjectOtherDocument } from '~~/server/utils/projectDocumentUpload'

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) throw createError({ statusCode: 401, message: '请先登录' })
  const projectId = Number(getRouterParam(event, 'id'))
  if (!Number.isSafeInteger(projectId) || projectId <= 0) throw createError({ statusCode: 400, message: '无效的项目ID' })
  const multipart = await readMultipartFormData(event)
  const file = multipart?.find(part => part.name === 'file' && part.filename)
  if (!file?.filename || !file.data.length) throw createError({ statusCode: 400, message: '请选择文件' })
  const documentUuid = multipart?.find(part => part.name === 'documentUuid')?.data.toString() || crypto.randomUUID()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(documentUuid)) throw createError({ statusCode: 400, message: '文档标识无效' })
  return await uploadProjectOtherDocument(event, uid, projectId, {
    fileName: file.filename, data: file.data, contentType: file.type, documentUuid,
    docCategory: multipart?.find(part => part.name === 'docCategory')?.data.toString()
  })
})
