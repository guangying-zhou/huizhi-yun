import { createError, defineEventHandler, getQuery, sendRedirect, type H3Event } from 'h3'
import { createAliOssCompatibleClient } from '@hzy/foundation/server/utils/objectStorage'
import { getOssIntegrationConfig } from '@hzy/foundation/server/utils/ossIntegration'
import { requirePermission } from '~~/server/utils/checkPermission'

const invoiceObjectPrefix = 'finance/invoices/'
const signedUrlExpiresIn = 10 * 60
const legacyPreviewExtensions = new Set(['pdf', 'ofd', 'jpg', 'jpeg', 'png'])

function firstValue(value: unknown) {
  return Array.isArray(value) ? value[0] : value
}

function stringValue(value: unknown) {
  return String(firstValue(value) || '').trim()
}

function normalizeEndpoint(endpoint: string) {
  return /^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`
}

function hostFromUrl(value: unknown) {
  const text = stringValue(value)
  if (!text) return ''
  try {
    return new URL(normalizeEndpoint(text)).host.toLowerCase()
  } catch {
    return ''
  }
}

function legacyFileHosts() {
  const hosts = new Set(['img.wiztek.cn'])
  for (const source of [
    process.env.HZY_FINANCE_INVOICE_LEGACY_FILE_HOSTS,
    process.env.HZY_LEGACY_INVOICE_FILE_HOSTS
  ]) {
    for (const item of stringValue(source).split(/[,\s]+/)) {
      const host = hostFromUrl(item) || item.trim().toLowerCase()
      if (host) hosts.add(host)
    }
  }
  return hosts
}

function safeDecodePath(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function fileExtensionFromPath(value: string) {
  const pathname = value.split(/[?#]/, 1)[0] || ''
  const index = pathname.lastIndexOf('.')
  return index >= 0 ? pathname.slice(index + 1).toLowerCase() : ''
}

function legacyInvoiceFileUrl(source: string) {
  if (!/^https?:\/\//i.test(source)) return ''

  let parsed: URL
  try {
    parsed = new URL(source)
  } catch {
    throw createError({ statusCode: 400, statusMessage: '发票文件地址无效' })
  }

  if (!legacyFileHosts().has(parsed.host.toLowerCase())) return ''
  if (parsed.protocol !== 'https:') {
    throw createError({ statusCode: 403, statusMessage: '历史发票文件必须使用 HTTPS 地址' })
  }

  const decodedPath = safeDecodePath(parsed.pathname)
  if (decodedPath.includes('..') || !decodedPath.toLowerCase().startsWith('/archives/')) {
    throw createError({ statusCode: 403, statusMessage: '无权访问该历史发票文件' })
  }

  if (!legacyPreviewExtensions.has(fileExtensionFromPath(decodedPath))) {
    throw createError({ statusCode: 403, statusMessage: '不支持预览该历史发票文件格式' })
  }

  return parsed.toString()
}

function decodeObjectKey(value: string) {
  return value
    .split('/')
    .map((part) => {
      try {
        return decodeURIComponent(part)
      } catch {
        return part
      }
    })
    .join('/')
}

function normalizeObjectKey(value: string) {
  return decodeObjectKey(value.split(/[?#]/, 1)[0] || '').replace(/^\/+/, '')
}

function configuredHosts(config: Awaited<ReturnType<typeof getOssIntegrationConfig>>) {
  const hosts = new Set<string>()
  const endpointHost = hostFromUrl(config.endpoint)
  if (endpointHost) {
    hosts.add(endpointHost)
    hosts.add(`${config.bucket}.${endpointHost}`)
  }

  for (const value of [
    config.bucketDomain,
    config.config.invoiceFileBaseUrl,
    config.config.publicBaseUrl,
    config.config.bucketDomain
  ]) {
    const host = hostFromUrl(value)
    if (host) hosts.add(host)
  }

  return hosts
}

function extractObjectKey(source: string, config: Awaited<ReturnType<typeof getOssIntegrationConfig>>) {
  if (!source) {
    throw createError({ statusCode: 400, statusMessage: '缺少发票文件地址' })
  }

  if (!/^https?:\/\//i.test(source)) {
    return normalizeObjectKey(source)
  }

  let parsed: URL
  try {
    parsed = new URL(source)
  } catch {
    throw createError({ statusCode: 400, statusMessage: '发票文件地址无效' })
  }

  if (!configuredHosts(config).has(parsed.host)) {
    throw createError({ statusCode: 400, statusMessage: '发票文件不属于默认对象存储' })
  }

  let objectKey = normalizeObjectKey(parsed.pathname)
  const bucketPrefix = `${config.bucket}/`
  if (objectKey.startsWith(bucketPrefix)) {
    objectKey = objectKey.slice(bucketPrefix.length)
  }
  return objectKey
}

function assertInvoiceObjectKey(objectKey: string) {
  if (!objectKey || objectKey.includes('..') || !objectKey.startsWith(invoiceObjectPrefix)) {
    throw createError({ statusCode: 403, statusMessage: '无权访问该发票文件' })
  }
}

function headerFileName(value: string) {
  return encodeURIComponent(value).replace(/['()]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

function safeFileName(value: string) {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

function objectStorageProvider(config: Awaited<ReturnType<typeof getOssIntegrationConfig>>) {
  return stringValue(
    config.config.provider
    || config.config.objectStorageProvider
    || config.config.storageProvider
    || 'aliyun-oss-s3'
  )
}

async function createSignedInvoiceFileUrl(event: H3Event, objectKey: string, fileName: string) {
  const config = await getOssIntegrationConfig('oss.default', { event })
  const client = createAliOssCompatibleClient({
    provider: objectStorageProvider(config),
    bucket: config.bucket,
    endpoint: config.endpoint,
    accessKeyId: config.accessKeyId,
    accessKeySecret: config.accessKeySecret,
    region: config.region,
    bucketDomain: config.bucketDomain,
    forcePathStyle: stringValue(config.config.forcePathStyle || config.config.pathStyle)
  })
  const response: Record<string, string> = {}
  const normalizedFileName = safeFileName(fileName)
  if (normalizedFileName) {
    response['content-disposition'] = `inline; filename*=UTF-8''${headerFileName(normalizedFileName)}`
  }
  return await client.createSignedGetUrl(objectKey, {
    expires: signedUrlExpiresIn,
    response
  })
}

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'invoices', 'view')

  const query = getQuery(event)
  const source = stringValue(query.key || query.objectKey || query.url || query.fileUrl)
  const legacyUrl = legacyInvoiceFileUrl(source)
  if (legacyUrl) {
    if (stringValue(query.format).toLowerCase() === 'json') {
      return {
        code: 0,
        message: 'ok',
        data: {
          url: legacyUrl,
          expiresIn: 0,
          legacy: true
        }
      }
    }

    return sendRedirect(event, legacyUrl, 302)
  }

  const config = await getOssIntegrationConfig('oss.default', { event })
  const objectKey = extractObjectKey(source, config)
  assertInvoiceObjectKey(objectKey)

  const signedUrl = await createSignedInvoiceFileUrl(
    event,
    objectKey,
    stringValue(query.name || query.fileName)
  )

  if (stringValue(query.format).toLowerCase() === 'json') {
    return {
      code: 0,
      message: 'ok',
      data: {
        url: signedUrl,
        expiresIn: signedUrlExpiresIn
      }
    }
  }

  return sendRedirect(event, signedUrl, 302)
})
