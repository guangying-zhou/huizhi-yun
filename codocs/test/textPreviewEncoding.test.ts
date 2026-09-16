import assert from 'node:assert/strict'
import { test } from 'node:test'
import iconv from 'iconv-lite'
import { decodeTextPreviewBuffer } from '../server/utils/textPreviewEncoding.ts'

test('decodes utf-8 text preview content', () => {
  const decoded = decodeTextPreviewBuffer(Buffer.from('中文预览正常\nCodocs', 'utf8'))
  assert.equal(decoded.encoding, 'utf-8')
  assert.equal(decoded.content, '中文预览正常\nCodocs')
})

test('decodes gb18030 text preview content', () => {
  const decoded = decodeTextPreviewBuffer(iconv.encode('中文预览正常\nCodocs', 'gb18030'))
  assert.equal(decoded.encoding, 'gb18030')
  assert.equal(decoded.content, '中文预览正常\nCodocs')
})

test('strips utf-8 bom before preview decoding', () => {
  const decoded = decodeTextPreviewBuffer(Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from('中文预览正常', 'utf8')
  ]))
  assert.equal(decoded.encoding, 'utf-8')
  assert.equal(decoded.content, '中文预览正常')
})

test('decodes utf-16le bom text preview content', () => {
  const decoded = decodeTextPreviewBuffer(Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    iconv.encode('中文预览正常', 'utf16-le')
  ]))
  assert.equal(decoded.encoding, 'utf-16le')
  assert.equal(decoded.content, '中文预览正常')
})
