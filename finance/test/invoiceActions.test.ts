import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  invoiceCode,
  invoiceReceiptReconcileDefaultAmount,
  invoiceUnreconciledAmount,
  isInvoiceReceiptReconcileDisabled,
  numericMoney
} from '../app/utils/invoiceActions.ts'

describe('Finance invoice action helpers', () => {
  test('normalizes formatted money and invoice codes', () => {
    assert.equal(numericMoney('12,345.67'), 12345.67)
    assert.equal(invoiceCode({ invoice_code: ' INV-001 ' }), 'INV-001')
  })

  test('prefers explicit unreconciled amount', () => {
    const row = {
      status: 'issued',
      invoice_amount: '1000.00',
      reconciled_amount: '200.00',
      unreconciled_amount: '350.50'
    }
    assert.equal(invoiceUnreconciledAmount(row), 350.5)
    assert.equal(invoiceReceiptReconcileDefaultAmount(row), '350.50')
    assert.equal(isInvoiceReceiptReconcileDisabled(row), false)
  })

  test('derives remaining amount when runtime omits the explicit field', () => {
    const row = { status: 'issued', invoiceAmount: '1000', reconciledAmount: '250' }
    assert.equal(invoiceUnreconciledAmount(row), 750)
    assert.equal(invoiceReceiptReconcileDefaultAmount(row), '750.00')
  })

  test('disables reconciliation for non-issued or fully reconciled invoices', () => {
    assert.equal(isInvoiceReceiptReconcileDisabled({ status: 'draft', invoice_amount: 100 }), true)
    assert.equal(isInvoiceReceiptReconcileDisabled({ status: 'issued', invoice_amount: 100, reconciled_amount: 100 }), true)
  })
})
