import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  invoiceFileMimeType,
  invoiceFileName,
  invoiceFileUrl,
  invoicePreviewKind,
  previewFileExtension
} from '../app/utils/invoiceFiles.ts'

describe('Finance invoice file preview helpers', () => {
  test('reads snake_case and camelCase file metadata', () => {
    assert.equal(invoiceFileUrl({ invoice_file_url: ' https://example.test/a.pdf ' }), 'https://example.test/a.pdf')
    assert.equal(invoiceFileName({ invoiceFileName: 'invoice.pdf' }), 'invoice.pdf')
    assert.equal(invoiceFileMimeType({ invoice_file_mime_type: 'application/pdf' }), 'application/pdf')
  })

  test('falls back to invoice identity for preview titles', () => {
    assert.equal(invoiceFileName({ invoice_no: 'NO-001' }), 'NO-001')
    assert.equal(invoiceFileName({ code: 'INV-001' }), 'INV-001')
  })

  test('classifies supported inline preview types', () => {
    assert.equal(invoicePreviewKind('/file', 'invoice.png', ''), 'image')
    assert.equal(invoicePreviewKind('/file', '', 'application/pdf'), 'pdf')
    assert.equal(invoicePreviewKind('/file.ofd?token=1', '', ''), 'ofd')
    assert.equal(invoicePreviewKind('/file.docx', '', ''), 'other')
  })

  test('extracts normalized extensions without query strings', () => {
    assert.equal(previewFileExtension('https://example.test/A.PDF?token=1'), 'pdf')
  })
})
