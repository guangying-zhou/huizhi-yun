import { createError } from 'h3'

export interface ProductCreationSnapshot {
  operationId: string
  documentUuid: string
  content: string
  contentSha256: string
  state: 'prepared' | 'completed'
  publishedPath: string
}

// Internal Codocs orchestration, after signature, user create eligibility and
// current template ACL checks. Snapshot comes from the preparation Runtime.
export async function uploadPreparedProductDocument<T>(
  snapshot: ProductCreationSnapshot,
  expected: { operationId: string, documentUuid: string },
  dependencies: {
    upload: (path: string, content: string, docType: string) => Promise<unknown>
    complete: (path: string, contentSha256: string) => Promise<T>
  }
): Promise<T> {
  const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) && value !== '00000000-0000-0000-0000-000000000000'
  if (!snapshot || !uuid(expected.operationId) || !uuid(expected.documentUuid) || snapshot.operationId !== expected.operationId || snapshot.documentUuid !== expected.documentUuid || typeof snapshot.content !== 'string' || !snapshot.content.isWellFormed() || !/^[0-9a-f]{64}$/.test(snapshot.contentSha256)) throw createError({ statusCode: 503, message: '文档创建快照无效' })
  const bytes = new TextEncoder().encode(snapshot.content)
  if (bytes.length > 4 * 1024 * 1024) throw createError({ statusCode: 503, message: '文档创建快照过大' })
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
  if (digest !== snapshot.contentSha256) throw createError({ statusCode: 503, message: '文档创建快照校验失败' })
  const prefix = `product-creations/${snapshot.operationId}/`
  if (snapshot.state === 'completed') {
    const path = snapshot.publishedPath
    if (typeof path !== 'string' || !path.startsWith(prefix) || !path.endsWith('.md') || !uuid(path.slice(prefix.length, -3))) throw createError({ statusCode: 503, message: '文档创建完成记录无效' })
    return dependencies.complete(path, digest)
  }
  if (snapshot.state !== 'prepared' || snapshot.publishedPath !== '') throw createError({ statusCode: 503, message: '文档创建状态无效' })
  // Every attempt owns a fresh object. Concurrent/late retries cannot overwrite
  // the object selected by a successful completion or later user edits.
  const path = `${prefix}${crypto.randomUUID()}.md`
  try {
    await dependencies.upload(path, snapshot.content, 'product')
  } catch {
    throw createError({ statusCode: 503, message: '文档上传暂不可用，请重试' })
  }
  return dependencies.complete(path, digest)
}
