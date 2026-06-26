/**
 * 扫描 OSS 图片并检测孤立图片。
 * 文档元数据通过 tenant-runtime 查询，不在 Codocs server 直连数据库。
 */
import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { downloadDocument, getImageMetadata, listImages } from '~~/server/utils/oss'

interface RuntimePage<T> {
  items?: T[]
}

interface DocumentRow {
  uuid: string
  title: string
  doc_type: string
  oss_path: string
}

const extractOwner = (path: string): string => {
  const match = path.match(/^codocs\/users\/([^/]+)\/images\//)
  return match ? match[1]! : ''
}

const imagePreviewUrl = (baseURL: string, path: string) => {
  const normalizedBase = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL
  return `${normalizedBase}/api/admin/images/preview?path=${encodeURIComponent(path)}`
}

const findDocumentByOssPath = async (event: Parameters<typeof callCodocsTenantRuntime>[0], ossPath: string) => {
  const page = await callCodocsTenantRuntime<RuntimePage<DocumentRow>>(event, '/v1/codocs/documents', {
    query: {
      oss_path: ossPath,
      limit: 1
    },
    scope: 'codocs.read'
  })
  return page.items?.[0] || null
}

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig()
  const baseURL = runtimeConfig.app.baseURL || ''
  const images = await listImages()
  const imagesWithMeta = await Promise.all(images.map(async (img) => {
    const meta = await getImageMetadata(img.path)
    const rawDocPath = meta['doc-path'] || ''
    const docPath = rawDocPath ? decodeURIComponent(rawDocPath) : ''
    return { ...img, docPath }
  }))

  const docInfoMap = new Map<string, DocumentRow | null>()
  const docPaths = [...new Set(imagesWithMeta.map(i => i.docPath).filter(Boolean))]
  for (const docPath of docPaths) {
    try {
      docInfoMap.set(docPath, await findDocumentByOssPath(event, docPath))
    } catch (error) {
      console.warn(`[AdminImages] Failed to lookup document for ${docPath}:`, error)
      docInfoMap.set(docPath, null)
    }
  }

  const docContentCache = new Map<string, string | null>()
  for (const [docPath, doc] of docInfoMap.entries()) {
    if (!doc) continue
    try {
      docContentCache.set(docPath, await downloadDocument(docPath, doc.doc_type))
    } catch {
      docContentCache.set(docPath, null)
    }
  }

  const results = imagesWithMeta.map((img) => {
    let orphan: '' | 'deleted' | 'unreferenced' | 'no-meta' = ''
    const doc = img.docPath ? docInfoMap.get(img.docPath) : null

    if (!img.docPath) {
      orphan = 'no-meta'
    } else if (!doc) {
      orphan = 'deleted'
    } else {
      const content = docContentCache.get(img.docPath)
      if (content !== null && content !== undefined && !content.includes(img.name)) {
        orphan = 'unreferenced'
      }
    }

    return {
      name: img.name,
      path: img.path,
      size: img.size,
      lastModified: img.lastModified,
      url: imagePreviewUrl(baseURL, img.path),
      docPath: img.docPath,
      orphan,
      owner: extractOwner(img.path)
    }
  }).sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime())

  return {
    success: true,
    data: {
      total: results.length,
      orphanCount: results.filter(r => r.orphan !== '').length,
      deletedCount: results.filter(r => r.orphan === 'deleted').length,
      unreferencedCount: results.filter(r => r.orphan === 'unreferenced').length,
      noMetaCount: results.filter(r => r.orphan === 'no-meta').length,
      images: results
    }
  }
})
