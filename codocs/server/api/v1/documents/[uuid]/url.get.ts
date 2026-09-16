/**
 * 生成文档访问 URL
 * GET /api/v1/documents/:uuid/url
 * Query: mode=edit|readonly
 *
 * 供其他模块调用，需 Console service token
 * 返回可直接跳转的 Codocs 编辑器 URL
 */
import { verifyInternalApi } from '~~/server/utils/internalApi'
import { getCodocsDocumentMetadata } from '~~/server/utils/codocsRuntime'

export default defineEventHandler(async (event) => {
  await verifyInternalApi(event, { scopes: ['codocs:documents:read'] })

  const uuid = getRouterParam(event, 'uuid')
  if (!uuid) {
    throw createError({ statusCode: 400, message: '缺少文档 UUID' })
  }

  const query = getQuery(event)
  const mode = query.mode === 'readonly' ? 'readonly' : 'edit'

  // 验证文档存在
  const doc = await getCodocsDocumentMetadata(event, uuid)

  // 构建 URL
  const config = useRuntimeConfig()
  const siteUrl = (config.public?.siteUrl as string)
    || (config.public?.codocsSiteUrl as string)
    || ''

  // 如果文档本身是只读，强制 readonly 模式
  const effectiveMode = doc.readonly_flag === 1 ? 'readonly' : mode
  const url = `${siteUrl}/documents/${uuid}${effectiveMode === 'readonly' ? '?readonly=1' : ''}`

  return {
    code: 0,
    data: {
      uuid: doc.uuid,
      url,
      mode: effectiveMode
    }
  }
})
