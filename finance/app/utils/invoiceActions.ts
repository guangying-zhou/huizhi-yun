export function numericMoney(value: unknown) {
  const numberValue = Number(String(value || '').replace(/,/g, ''))
  return Number.isFinite(numberValue) ? numberValue : 0
}

export function invoiceCode(row: Record<string, unknown>) {
  return String(row.code || row.invoice_code || row.invoiceCode || '').trim()
}

export function invoiceUnreconciledAmount(row: Record<string, unknown>) {
  const explicit = row.unreconciled_amount ?? row.unreconciledAmount
  if (explicit !== undefined && explicit !== null && String(explicit).trim() !== '') {
    return Math.max(numericMoney(explicit), 0)
  }
  return Math.max(
    numericMoney(row.invoice_amount ?? row.invoiceAmount)
    - numericMoney(row.reconciled_amount ?? row.reconciledAmount),
    0
  )
}

export function invoiceReceiptReconcileDefaultAmount(row: Record<string, unknown>) {
  const amount = invoiceUnreconciledAmount(row)
  return amount > 0 ? amount.toFixed(2) : ''
}

export function isInvoiceReceiptReconcileDisabled(row: Record<string, unknown>) {
  const status = String(row.status || '').trim()
  return status !== 'issued' || invoiceUnreconciledAmount(row) <= 0
}
