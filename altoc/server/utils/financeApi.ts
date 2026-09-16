import { createError, type H3Event } from 'h3'
import { buildAppHomeUrl } from '@hzy/foundation/server/utils/appUrls'
import { createAliOssCompatibleClient } from '@hzy/foundation/server/utils/objectStorage'
import { getOssIntegrationConfig } from '@hzy/foundation/server/utils/ossIntegration'
import { getConsoleRuntimeConfig } from '@hzy/foundation/server/utils/consoleRuntime'
import { requestServiceAccessToken } from '@hzy/foundation/server/utils/serviceOidc'

interface FinanceListResponse<T> {
  data?: T[]
  total?: number
  page?: number
  pageSize?: number
  warning?: string
}

interface FinanceDataResponse<T> {
  data?: T
  warning?: string
}

export interface FinanceInvoice {
  id?: number
  code: string
  invoice_no: string | null
  customer_code: string | null
  customer_name: string | null
  contract_code: string | null
  project_code: string | null
  receivable_plan_code?: string | null
  invoice_type: string | null
  invoice_medium?: string | null
  invoice_amount: string
  tax_amount: string | null
  invoice_date: string | null
  status: string
  invoice_file_url?: string | null
  invoice_file_name?: string | null
  invoice_file_mime_type?: string | null
  invoice_file_size?: number | string | null
  created_at: string | null
}

export interface FinanceContractSummary {
  contractCode: string
  customerCode: string | null
  projectCode: string | null
  contractAmount: string | null
  invoiceAmount: string
  receivedAmount: string
  reconciledAmount: string
  unreceivedAmount: string | null
  unreconciledAmount: string | null
  invoiceCount: number
  receiptCount: number
  latestInvoiceDate: string | null
  latestReceivedAt: string | null
  riskStatus: string
  calculatedAt: string | null
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

const invoiceObjectPrefix = 'finance/invoices/'
const signedUrlExpiresIn = 10 * 60
const legacyPreviewExtensions = new Set(['pdf', 'ofd', 'jpg', 'jpeg', 'png'])

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function joinApiRoot(homeUrl: string, apiBase: string) {
  const base = homeUrl.endsWith('/') ? homeUrl : `${homeUrl}/`
  const path = apiBase.replace(/^\/+/, '')
  return new URL(path, base).toString().replace(/\/+$/, '')
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
    process.env.HZY_ALTOC_INVOICE_LEGACY_FILE_HOSTS,
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

function extractInvoiceObjectKey(source: string, config: Awaited<ReturnType<typeof getOssIntegrationConfig>>) {
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
  if (!objectKey || objectKey.includes('..') || !objectKey.startsWith(invoiceObjectPrefix)) {
    throw createError({ statusCode: 403, statusMessage: '无权访问该发票文件' })
  }
  return objectKey
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

async function getFinanceApiRoot(event?: H3Event | null) {
  try {
    const runtime = await getConsoleRuntimeConfig({ event })
    const deployment = runtime.deployment as Record<string, unknown> | undefined
    const applications = Array.isArray(runtime.applications) ? runtime.applications : []
    const finance = applications.find(item => stringValue(item.appCode) === 'finance')

    if (finance) {
      const homeUrl = stringValue(finance.homeUrl)
        || buildAppHomeUrl(deployment?.publicUrl, finance.basePath)
      const apiBase = stringValue(finance.apiBase) || '/api/v1/finance'
      if (homeUrl) return joinApiRoot(homeUrl, apiBase)
    }
  } catch {
    // Console runtime 不可用时回退到本地开发地址。
  }

  const config = useRuntimeConfig() as unknown as {
    financeApiUrl?: string
    public?: { financeBaseUrl?: string }
  }
  const financeBaseUrl = stringValue(config.financeApiUrl)
    || stringValue(config.public?.financeBaseUrl)
    || stringValue(process.env.HZY_FINANCE_API_URL)
    || stringValue(process.env.HZY_FINANCE_BASE_URL)
    || 'http://localhost:3006'
  return `${trimTrailingSlash(financeBaseUrl)}/api/v1/finance`
}

async function getFinanceHeaders(event?: H3Event | null, options: { optional?: boolean } = {}): Promise<Record<string, string>> {
  try {
    const token = await requestServiceAccessToken({
      audience: 'finance',
      scope: 'finance:read',
      event
    })
    return { Authorization: `Bearer ${token}` }
  } catch (error: unknown) {
    if (!options.optional) throw error
    const err = error as { message?: string }
    console.warn('[financeApi] service token unavailable, calling Finance without Authorization:', err.message)
    return {}
  }
}

async function listFinanceInvoices(query: Record<string, string | number>, event?: H3Event | null) {
  if (!Object.values(query).some(value => String(value || '').trim())) return { items: [], total: 0, warning: '' }

  const apiRoot = await getFinanceApiRoot(event)
  try {
    const response = await $fetch<FinanceListResponse<FinanceInvoice>>(`${apiRoot}/invoices`, {
      query: {
        ...query,
        pageSize: query.pageSize || 100
      },
      headers: await getFinanceHeaders(event),
      timeout: 10000
    })

    return {
      items: response.data || [],
      total: Number(response.total || 0),
      warning: response.warning || ''
    }
  } catch (error: unknown) {
    const err = error as { message?: string }
    console.warn('[financeApi] list invoices failed:', err.message)
    return { items: [], total: 0, warning: err.message || 'Finance 发票接口调用失败' }
  }
}

export async function listFinanceInvoicesByContract(contractCode: string, event?: H3Event | null) {
  return listFinanceInvoices({ contract_code: contractCode }, event)
}

export async function listFinanceInvoicesByReceivablePlan(receivablePlanCode: string, event?: H3Event | null) {
  return listFinanceInvoices({ receivable_plan_code: receivablePlanCode }, event)
}

export async function createFinanceInvoiceFileViewUrl(query: {
  url: string
  name?: string
  mimeType?: string
}, event?: H3Event | null) {
  const legacyUrl = legacyInvoiceFileUrl(query.url)
  if (legacyUrl) return legacyUrl

  const config = await getOssIntegrationConfig('oss.default', { event })
  const objectKey = extractInvoiceObjectKey(query.url, config)
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
  const fileName = safeFileName(query.name || '')
  if (fileName) {
    response['content-disposition'] = `inline; filename*=UTF-8''${headerFileName(fileName)}`
  }
  return await client.createSignedGetUrl(objectKey, {
    expires: signedUrlExpiresIn,
    response
  })
}

export async function getFinanceContractSummaries(contractCodes: string[], event?: H3Event | null) {
  const codes = [...new Set(contractCodes.map(code => stringValue(code)).filter(Boolean))]
  if (codes.length === 0) return new Map<string, FinanceContractSummary>()

  const apiRoot = await getFinanceApiRoot(event)
  const headers = await getFinanceHeaders(event)
  const result = new Map<string, FinanceContractSummary>()

  for (let i = 0; i < codes.length; i += 80) {
    const chunk = codes.slice(i, i + 80)
    try {
      const response = await $fetch<FinanceDataResponse<FinanceContractSummary[]>>(`${apiRoot}/contracts/summaries`, {
        query: { contractCodes: chunk.join(',') },
        headers,
        timeout: 10000
      })

      for (const item of response.data || []) {
        result.set(item.contractCode, item)
      }
    } catch (error: unknown) {
      const err = error as { message?: string }
      console.warn('[financeApi] contract summaries failed:', err.message)
    }
  }

  return result
}
