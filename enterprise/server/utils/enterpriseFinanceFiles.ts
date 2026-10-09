import { createHash } from 'node:crypto'
import { createError, getHeader, getQuery, readMultipartFormData, type H3Event } from 'h3'
import { createAliOssCompatibleClient } from '@hzy/foundation/server/utils/objectStorage'
import { getOssIntegrationConfig } from '@hzy/foundation/server/utils/ossIntegration'
import { authorizeFinanceLedger, callFinanceLedger, normalizeFinanceLedgerRequest } from './enterpriseFinanceLedger'
import { requireEnterpriseUser } from '@hzy/foundation/server/utils/enterpriseRuntimeClient'

async function storage(event: H3Event) {
  const c = await getOssIntegrationConfig('oss.default', { event })
  return createAliOssCompatibleClient({ provider: financeFileStorageProvider(c.config.provider, c.endpoint), bucket: c.bucket, endpoint: c.endpoint.includes('://') ? c.endpoint : `https://${c.endpoint}`, accessKeyId: c.accessKeyId, accessKeySecret: c.accessKeySecret, region: c.region, bucketDomain: c.bucketDomain, forcePathStyle: String(c.config.forcePathStyle || '') })
}

// Native OSS endpoints must use the existing OSS SDK transport. The S3 adapter
// rewrites them to s3. hosts, which are not necessarily reachable. Explicit S3
// endpoints and other providers retain their configured transport.
export function financeFileStorageProvider(provider: unknown, endpoint: string): string {
  const configured = String(provider || 'aliyun')
  if (!['aliyun-oss-s3', 'oss-s3'].includes(configured.toLowerCase().trim())) return configured
  const host = new URL(endpoint.includes('://') ? endpoint : `https://${endpoint}`).hostname
  return /^oss-[a-z0-9-]+\.aliyuncs\.com$/.test(host) ? 'aliyun-oss-native' : configured
}
export async function attachFinanceFile(event: H3Event) {
  const user = await requireEnterpriseUser(event)
  const key = getHeader(event, 'idempotency-key')
  if (!key || !/^[A-Za-z0-9._:-]{1,100}$/.test(key)) throw createError({ statusCode: 400 })
  const parts = await readMultipartFormData(event)
  const file = parts?.find(p => p.name === 'file' && p.filename)
  const entityType = parts?.find(p => p.name === 'entityType')?.data.toString()
  const entityCode = parts?.find(p => p.name === 'entityCode')?.data.toString()
  if (!file || !file.filename || file.data.length < 1 || file.data.length > 30 * 1024 * 1024 || !['application/pdf', 'application/ofd'].includes(file.type || '') || !['finance_invoice', 'finance_invoice_request'].includes(entityType || '') || !entityCode) throw createError({ statusCode: 400 })
  // Verify owning read access before any object storage IO. Write is independently checked below.
  const parent = await callFinanceLedger(event, entityType === 'finance_invoice' ? 'invoices-detail' : 'invoice-requests-detail', normalizeFinanceLedgerRequest(entityType === 'finance_invoice' ? 'invoices-detail' : 'invoice-requests-detail', entityCode, {}, {}))
  const sha = createHash('sha256').update(file.data).digest('hex')
  const name = file.filename.replace(/[\\/:*?"<>|]/g, '_').slice(0, 160)
  const identity = createHash('sha256').update(JSON.stringify([user.tenant, user.uid, key, entityType, entityCode])).digest('hex')
  const fileKey = `finance/invoices/${user.tenant}/${identity}/${sha}.${file.type === 'application/pdf' ? 'pdf' : 'ofd'}`
  if (!parent.data || typeof parent.data !== 'object' || Array.isArray(parent.data)) throw createError({ statusCode: 503 })
  const row = parent.data as Record<string, unknown>
  const issuance = entityType === 'finance_invoice_request' && row.status === 'approved'
  if (issuance && (row.issuance_responsible_uid !== user.uid || !row.requested_by || row.requested_by === user.uid)) throw createError({ statusCode: 403, message: '仅当前开票责任人可办理，申请人不能是开票人' })
  const payload = { ...(issuance ? { attachmentPurpose: 'issuance' } : {}), entityType, entityCode, fileKey, fileName: name, mimeType: file.type, fileSize: file.data.length, fileSha256: sha }
  // Authorization and metadata validation precede upload; holding no DB transaction.
  const finance = normalizeFinanceLedgerRequest('invoice-files-attach', undefined, {}, payload)
  await authorizeFinanceLedger(event, 'invoice-files-attach', finance)
  await (await storage(event)).put(fileKey, file.data, { headers: { 'Content-Type': file.type || 'application/pdf' } })
  // Fresh authorization after IO; a failure leaves no usable attachment metadata.
  return await callFinanceLedger(event, 'invoice-files-attach', finance)
}
export async function readFinanceFile(event: H3Event) {
  const query = getQuery(event)
  if (Object.keys(query).some(k => k !== 'code') || typeof query.code !== 'string') throw createError({ statusCode: 400 })
  const response = await callFinanceLedger(event, 'invoice-files-read', normalizeFinanceLedgerRequest('invoice-files-read', query.code, {}, {}))
  const row = response.data as Record<string, unknown>
  const url = await (await storage(event)).createSignedGetUrl(String(row.file_key), { expires: 600 })
  return { data: { url, fileName: row.file_name, mimeType: row.mime_type, expiresIn: 600 } }
}
