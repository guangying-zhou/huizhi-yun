export function invoiceFileUrl(row: Record<string, unknown>) {
  return String(row.invoice_file_url || row.invoiceFileUrl || '').trim()
}

export function invoiceFileName(row: Record<string, unknown>) {
  return String(row.invoice_file_name || row.invoiceFileName || row.invoice_no || row.invoiceNo || row.code || '发票文件').trim()
}

export function invoiceFileMimeType(row: Record<string, unknown>) {
  return String(row.invoice_file_mime_type || row.invoiceFileMimeType || '').trim()
}

export function previewFileExtension(url: string, name = '') {
  const source = (name || url).split(/[?#]/)[0] || ''
  const index = source.lastIndexOf('.')
  return index >= 0 ? source.slice(index + 1).toLowerCase() : ''
}

export function invoicePreviewKind(url: string, name: string, mimeType: string) {
  const normalizedMimeType = mimeType.toLowerCase()
  const extension = previewFileExtension(url, name)
  if (normalizedMimeType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension)) return 'image'
  if (normalizedMimeType === 'application/pdf' || extension === 'pdf') return 'pdf'
  if (normalizedMimeType === 'application/ofd' || extension === 'ofd') return 'ofd'
  return 'other'
}
