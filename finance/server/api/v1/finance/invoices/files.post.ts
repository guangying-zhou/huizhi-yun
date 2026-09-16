import { randomUUID } from 'node:crypto'
import { extname, join } from 'node:path'
import { createError, readMultipartFormData, type H3Event } from 'h3'
import { createAliOssCompatibleClient } from '@hzy/foundation/server/utils/objectStorage'
import { getOssIntegrationConfig } from '@hzy/foundation/server/utils/ossIntegration'
import { requirePermission } from '~~/server/utils/checkPermission'

const maxInvoiceFileSize = 30 * 1024 * 1024

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function normalizeBasePath(value: unknown) {
  const text = stringValue(value)
  if (!text || text === '/') return '/'
  const withLeading = text.startsWith('/') ? text : `/${text}`
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`
}

function safeFileName(value: string) {
  return value
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160) || 'invoice-file'
}

function allowedExtension(medium: string, filename: string, mimeType: string) {
  const ext = extname(filename).replace(/^\./, '').toLowerCase()
  if (medium === 'paper') {
    return ext === 'pdf' || mimeType === 'application/pdf'
  }
  return ext === 'pdf' || ext === 'ofd' || mimeType === 'application/pdf' || mimeType === 'application/ofd'
}

function contentType(filename: string, type?: string) {
  const ext = extname(filename).replace(/^\./, '').toLowerCase()
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'ofd') return 'application/ofd'
  return type || 'application/octet-stream'
}

function trimSlashes(value: string) {
  return value.replace(/^\/+|\/+$/g, '')
}

function encodeObjectKey(value: string) {
  return value.split('/').map(part => encodeURIComponent(part)).join('/')
}

function headerFileName(value: string) {
  return encodeURIComponent(value).replace(/['()]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}

function errorStatusCode(error: unknown) {
  const candidate = error as { statusCode?: number, status?: number }
  const status = Number(candidate?.statusCode || candidate?.status || 0)
  return Number.isFinite(status) && status >= 400 ? status : 500
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  const candidate = error as { statusMessage?: string, message?: string }
  return stringValue(candidate?.statusMessage || candidate?.message || error)
}

function shouldUseLocalFallback() {
  const storageMode = stringValue(process.env.HZY_FINANCE_INVOICE_FILE_STORAGE).toLowerCase()
  if (storageMode === 'local') return true
  return process.env.NODE_ENV !== 'production' && storageMode !== 'oss'
}

function ossPublicUrl(config: Awaited<ReturnType<typeof getOssIntegrationConfig>>, objectKey: string, fallbackUrl: string) {
  const configuredBase = stringValue(
    config.config.invoiceFileBaseUrl
    || config.config.publicBaseUrl
    || config.config.bucketDomain
    || config.bucketDomain
  )
  if (configuredBase) {
    return `${configuredBase.replace(/\/+$/, '')}/${encodeObjectKey(objectKey)}`
  }
  return fallbackUrl || objectKey
}

function objectStorageProvider(config: Awaited<ReturnType<typeof getOssIntegrationConfig>>) {
  return stringValue(
    config.config.provider
    || config.config.objectStorageProvider
    || config.config.storageProvider
    || 'aliyun-oss-s3'
  )
}

async function uploadToOss(event: H3Event, objectKey: string, fileData: Buffer, originalName: string, mimeType: string) {
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
  const result = await client.put(objectKey, fileData, {
    headers: {
      'Content-Type': mimeType,
      'Content-Disposition': `inline; filename*=UTF-8''${headerFileName(originalName)}`
    }
  })
  return ossPublicUrl(config, objectKey, result.url || '')
}

async function uploadToLocalFile(
  event: H3Event,
  storedName: string,
  fileData: Buffer
) {
  const [{ mkdir, writeFile }] = await Promise.all([import('node:fs/promises')])
  const config = useRuntimeConfig(event) as { public?: { appBasePath?: string } }
  const basePath = normalizeBasePath(config.public?.appBasePath)
  const relativePath = `uploads/finance/invoices/${storedName}`
  const configuredDirectory = stringValue(process.env.HZY_FINANCE_INVOICE_FILE_LOCAL_DIR)
  const directory = configuredDirectory || join(process.cwd(), 'public', 'uploads', 'finance', 'invoices')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, storedName), fileData)
  return `${basePath}${relativePath}`
}

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'invoices', 'edit')

  const parts = await readMultipartFormData(event)
  if (!parts?.length) {
    throw createError({ statusCode: 400, statusMessage: '请上传发票文件' })
  }

  const fields = new Map<string, string>()
  const files = parts.filter(part => part.filename)
  for (const part of parts) {
    if (!part.filename) {
      fields.set(part.name || '', (part.data || Buffer.from('')).toString('utf8'))
    }
  }

  const medium = stringValue(fields.get('invoiceMedium') || fields.get('invoice_medium') || 'electronic')
  if (!['electronic', 'paper'].includes(medium)) {
    throw createError({ statusCode: 400, statusMessage: '无效的发票介质' })
  }
  if (files.length !== 1) {
    throw createError({ statusCode: 400, statusMessage: '请上传一个发票文件' })
  }

  const file = files[0]!
  const originalName = safeFileName(file.filename || 'invoice-file')
  const mimeType = contentType(originalName, file.type)
  const size = file.data?.length || 0
  if (size <= 0) {
    throw createError({ statusCode: 400, statusMessage: '发票文件为空' })
  }
  if (size > maxInvoiceFileSize) {
    throw createError({ statusCode: 413, statusMessage: '发票文件不能超过 30MB' })
  }
  if (!allowedExtension(medium, originalName, mimeType)) {
    throw createError({
      statusCode: 400,
      statusMessage: medium === 'paper' ? '纸质发票扫描件只支持 PDF 文件' : '电子发票只支持 PDF 或 OFD 文件'
    })
  }

  const ext = extname(originalName).toLowerCase() || (mimeType === 'application/pdf' ? '.pdf' : '.ofd')
  const storedName = `${Date.now()}-${randomUUID()}${ext}`
  const objectKey = `finance/invoices/${new Date().toISOString().slice(0, 10)}/${trimSlashes(storedName)}`

  let url = ''
  try {
    url = await uploadToOss(event, objectKey, file.data, originalName, mimeType)
  } catch (error) {
    if (!shouldUseLocalFallback()) {
      console.error('[Finance] invoice file object storage upload failed:', errorMessage(error))
      throw createError({
        statusCode: errorStatusCode(error),
        message: `发票文件上传失败：${errorMessage(error)}`
      })
    }
    url = await uploadToLocalFile(event, storedName, file.data)
  }

  return {
    code: 0,
    message: '上传成功',
    data: {
      url,
      fileName: originalName,
      mimeType,
      size
    }
  }
})
