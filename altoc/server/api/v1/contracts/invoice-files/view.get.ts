import { createError, defineEventHandler, getQuery, sendRedirect, type H3Event } from 'h3'
import { maybeCallTenantRuntime } from '@hzy/foundation/server/utils/tenantRuntimeClient'
import { createFinanceInvoiceFileViewUrl, type FinanceInvoice } from '~~/server/utils/financeApi'
import { requirePermission } from '~~/server/utils/checkPermission'
import { resolveCurrentAltocDataAccessQuery } from '~~/server/utils/altocScopedAuthorization'

interface RuntimeEnvelope<T> {
  code?: number
  data?: T
  message?: string
}

interface ContractInvoicePage {
  items?: FinanceInvoice[]
}

function firstValue(value: unknown) {
  return Array.isArray(value) ? value[0] : value
}

function stringValue(value: unknown) {
  return String(firstValue(value) || '').trim()
}

async function callAltocRuntime<T>(
  event: H3Event,
  path: string,
  query: Record<string, unknown>
) {
  const runtime = await maybeCallTenantRuntime<RuntimeEnvelope<T>>(event, path, {
    appCode: 'altoc',
    scope: 'altoc.read altoc:contract:view',
    method: 'GET',
    query
  })
  if (!runtime.handled) {
    throw createError({ statusCode: 503, message: 'Altoc tenant-runtime is required for invoice file preview.' })
  }
  if (runtime.data.code !== undefined && runtime.data.code !== 0) {
    throw createError({ statusCode: 502, message: runtime.data.message || 'Altoc tenant-runtime returned an error.' })
  }
  return runtime.data.data as T
}

function invoiceCode(invoice: FinanceInvoice) {
  return stringValue(invoice.code)
}

function invoiceFileUrl(invoice: FinanceInvoice) {
  return stringValue(invoice.invoice_file_url || (invoice as { invoiceFileUrl?: unknown }).invoiceFileUrl)
}

function invoiceMatches(invoice: FinanceInvoice, input: { invoiceCode: string, url: string }) {
  if (input.invoiceCode && invoiceCode(invoice) !== input.invoiceCode) return false
  return invoiceFileUrl(invoice) === input.url
}

async function verifyInvoiceFileAccess(event: H3Event, input: {
  contractRef: string
  invoiceCode: string
  url: string
}) {
  if (!input.contractRef) {
    throw createError({ statusCode: 400, statusMessage: '请指定合同' })
  }

  await requirePermission(event, 'contract', 'view')
  const dataAccessQuery = await resolveCurrentAltocDataAccessQuery(event, 'contract', 'view')
  const page = await callAltocRuntime<ContractInvoicePage>(
    event,
    `/v1/altoc/contracts/${encodeURIComponent(input.contractRef)}/invoices`,
    {
      ...dataAccessQuery,
      pageSize: 100
    }
  )
  const invoices = Array.isArray(page?.items) ? page.items : []
  if (invoices.some(invoice => invoiceMatches(invoice, input))) return

  throw createError({ statusCode: 404, statusMessage: '发票文件未关联或无权预览' })
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const url = stringValue(query.url || query.fileUrl)
  const contractRef = stringValue(query.contract_id || query.contractId || query.contract_code || query.contractCode)
  const invoiceCodeValue = stringValue(query.invoice_code || query.invoiceCode || query.code)
  if (!url) {
    throw createError({ statusCode: 400, statusMessage: '缺少发票文件地址' })
  }

  await verifyInvoiceFileAccess(event, {
    contractRef,
    invoiceCode: invoiceCodeValue,
    url
  })

  const signedUrl = await createFinanceInvoiceFileViewUrl({
    url,
    name: stringValue(query.name || query.fileName),
    mimeType: stringValue(query.mimeType || query.mime_type)
  }, event)

  if (stringValue(query.format).toLowerCase() === 'json') {
    return {
      code: 0,
      message: 'ok',
      data: {
        url: signedUrl
      }
    }
  }

  return sendRedirect(event, signedUrl, 302)
})
