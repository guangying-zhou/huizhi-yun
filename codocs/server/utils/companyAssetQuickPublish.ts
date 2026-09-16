import { createError } from 'h3'

export interface QuickPublishItem {
  sourceUuid: string
  sourcePath: string
  title: string
  newUuid: string
  ossPath: string
}
interface HeadResult {
  meta?: Record<string, string>
  res: { headers: Record<string, string> }
}
export interface QuickPublishStorage {
  head: (path: string) => Promise<HeadResult>
  get: (path: string) => Promise<{ content: Buffer, res: { headers: Record<string, string> } }>
  put: (target: string, content: Buffer, options: { forbidOverwrite: boolean, headers: Record<string, string>, meta: Record<string, string> }) => Promise<unknown>
}
function missing(error: unknown) {
  const value = error as { status?: number, statusCode?: number, code?: string }
  return value.status === 404 || value.statusCode === 404 || value.code === 'NoSuchKey'
}
async function optionalHead(client: QuickPublishStorage, path: string) {
  try {
    return await client.head(path)
  } catch (error) {
    if (missing(error)) return null
    throw error
  }
}
function evidence(item: QuickPublishItem, head: HeadResult, operationId: string) {
  if (head.meta?.['quick-publish-operation'] !== operationId || head.meta?.['quick-publish-source'] !== item.sourceUuid) {
    throw createError({ statusCode: 409, message: '目标文件已存在且不属于本次发布，请重新选择发布操作' })
  }
  const etag = String(head.res.headers.etag || '')
  const size = Number(head.res.headers['content-length'])
  if (!etag || !Number.isSafeInteger(size) || size < 0) throw createError({ statusCode: 502, message: '无法验证已复制的文档' })
  return { newUuid: item.newUuid, ossPath: item.ossPath, etag, size }
}
/** Destination is reserved in Runtime. Conditional upload prevents races or retries from overwriting any object. */
export async function copyQuickPublishDocument(client: QuickPublishStorage, operationId: string, item: QuickPublishItem) {
  const existing = await optionalHead(client, item.ossPath)
  if (existing) return evidence(item, existing, operationId)
  const source = await client.get(item.sourcePath)
  const etag = String(source.res.headers.etag || '')
  if (!etag) throw createError({ statusCode: 502, message: '无法验证源文档版本' })
  try {
    await client.put(item.ossPath, source.content, {
      forbidOverwrite: true,
      headers: { 'content-type': 'text/markdown; charset=utf-8' },
      meta: { 'quick-publish-operation': operationId, 'quick-publish-source': item.sourceUuid, 'quick-publish-source-etag': etag }
    })
  } catch (error) {
    // A concurrent identical retry may already have copied the reserved object.
    const copied = await optionalHead(client, item.ossPath)
    if (copied) return evidence(item, copied, operationId)
    throw error
  }
  return evidence(item, await client.head(item.ossPath), operationId)
}
