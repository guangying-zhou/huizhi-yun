import { createError, defineEventHandler, getQuery, sendRedirect } from 'h3'
import { createFinanceInvoiceFileViewUrl } from '~~/server/utils/financeApi'
import { requirePermission } from '~~/server/utils/checkPermission'

function firstValue(value: unknown) {
  return Array.isArray(value) ? value[0] : value
}

function stringValue(value: unknown) {
  return String(firstValue(value) || '').trim()
}

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'contract', 'view')

  const query = getQuery(event)
  const url = stringValue(query.url || query.fileUrl)
  if (!url) {
    throw createError({ statusCode: 400, statusMessage: '缺少发票文件地址' })
  }

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
