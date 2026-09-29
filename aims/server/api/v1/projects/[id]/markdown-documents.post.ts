/**
 * POST /api/v1/projects/:id/markdown-documents
 *
 * Creates a Codocs Markdown document and registers it in Aims project_documents
 * through tenant-runtime. Aims keeps project/milestone indexing; Codocs owns
 * document content and collaboration.
 *
 * 逻辑在 server/utils/projectDocumentWrites.ts，企业宿主的 service 端点复用同一份。
 */
import { createProjectMarkdownDocument, type CreateMarkdownDocumentBody } from '~~/server/utils/projectDocumentWrites'

export default defineEventHandler(async (event) => {
  const uid = getRequestUid(event)
  if (!uid) {
    throw createError({ statusCode: 401, message: '请先登录' })
  }
  const projectId = Number(getRouterParam(event, 'id'))
  return await createProjectMarkdownDocument(event, uid, projectId, await readBody<CreateMarkdownDocumentBody>(event))
})
