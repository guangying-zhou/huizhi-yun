import { createError, defineEventHandler, getRouterParam, readBody, type H3Event } from 'h3'
import { createAliOssCompatibleClient } from '@hzy/foundation/server/utils/objectStorage'
import { getOssIntegrationConfig } from '@hzy/foundation/server/utils/ossIntegration'
import { getRequestUid } from '~~/server/utils/authIdentity'
import { requirePermission } from '~~/server/utils/checkPermission'
import { maybeCallFinanceDataRuntime } from '~~/server/utils/dataRuntime'

const invoiceObjectPrefix = 'finance/invoices/'

type RuntimeEnvelope<T> = {
  code?: number
  data?: T
  message?: string
}

type InvoiceRow = Record<string, unknown>

function stringValue(value: unknown) {
  return String(value || '').trim()
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
  if (!source) return ''
  if (!/^https?:\/\//i.test(source)) return normalizeObjectKey(source)

  let parsed: URL
  try {
    parsed = new URL(source)
  } catch {
    return ''
  }

  if (!configuredHosts(config).has(parsed.host.toLowerCase())) return ''

  let objectKey = normalizeObjectKey(parsed.pathname)
  const bucketPrefix = `${config.bucket}/`
  if (objectKey.startsWith(bucketPrefix)) {
    objectKey = objectKey.slice(bucketPrefix.length)
  }
  return objectKey
}

function invoiceObjectKey(objectKey: string) {
  if (!objectKey || objectKey.includes('..') || !objectKey.startsWith(invoiceObjectPrefix)) return ''
  return objectKey
}

function objectStorageProvider(config: Awaited<ReturnType<typeof getOssIntegrationConfig>>) {
  return stringValue(
    config.config.provider
    || config.config.objectStorageProvider
    || config.config.storageProvider
    || 'aliyun-oss-s3'
  )
}

async function deleteInvoiceFileIfManaged(event: H3Event, fileUrl: string) {
  if (!fileUrl) {
    return { attempted: false, deleted: false, skipped: true, reason: 'empty_file_url' }
  }

  const config = await getOssIntegrationConfig('oss.default', { event })
  const objectKey = invoiceObjectKey(extractObjectKey(fileUrl, config))
  if (!objectKey) {
    return { attempted: false, deleted: false, skipped: true, reason: 'external_or_unmanaged_file' }
  }

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
  await client.delete(objectKey)
  return { attempted: true, deleted: true, skipped: false, objectKey }
}

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'invoices', 'admin', '只有管理员可以删除发票')

  const code = stringValue(getRouterParam(event, 'code'))
  if (!code) throw createError({ statusCode: 400, statusMessage: 'code is required' })

  const body = await readBody<Record<string, unknown>>(event).catch((): Record<string, unknown> => ({}))
  const operatorId = stringValue(body.deletedBy || body.deleted_by || getRequestUid(event) || 'finance-ui')

  const invoiceRuntime = await maybeCallFinanceDataRuntime<RuntimeEnvelope<InvoiceRow>>(
    event,
    `/v1/finance/invoices/${encodeURIComponent(code)}`,
    { scope: 'finance.invoices.read', method: 'GET', query: {} }
  )
  if (!invoiceRuntime.handled) {
    throw createError({ statusCode: 503, statusMessage: 'Finance tenant-runtime is required to delete invoices.' })
  }
  const invoice = invoiceRuntime.data.data
  if (!invoice) throw createError({ statusCode: 404, statusMessage: 'invoice not found' })

  let fileDelete: Record<string, unknown>
  try {
    fileDelete = await deleteInvoiceFileIfManaged(event, stringValue(invoice.invoice_file_url || invoice.invoiceFileUrl))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[Finance] invoice file delete failed:', message)
    throw createError({
      statusCode: 502,
      statusMessage: '发票文件删除失败',
      message
    })
  }

  const deleteRuntime = await maybeCallFinanceDataRuntime<RuntimeEnvelope<InvoiceRow>>(
    event,
    `/v1/finance/invoices/${encodeURIComponent(code)}`,
    {
      scope: 'finance.write',
      method: 'DELETE',
      body: {
        reason: stringValue(body.reason || body.deleteReason || body.delete_reason),
        deletedBy: operatorId,
        fileDelete
      }
    }
  )
  if (!deleteRuntime.handled) {
    throw createError({ statusCode: 503, statusMessage: 'Finance tenant-runtime is required to delete invoices.' })
  }

  return {
    code: 0,
    message: '删除成功',
    data: {
      ...(deleteRuntime.data.data || {}),
      fileDelete
    }
  }
})
