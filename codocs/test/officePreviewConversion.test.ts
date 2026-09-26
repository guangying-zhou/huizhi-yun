import assert from 'node:assert/strict'
import test from 'node:test'
import JSZip from 'jszip'
import { docxToHtml, docxToMarkdown } from '../server/utils/officeConverter.ts'

test('Office preview converts an actual in-memory DOCX without remote dependencies', async () => {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>文件柜预览 &amp; 文档转换</w:t></w:r></w:p></w:body></w:document>')
  const buffer = await zip.generateAsync({ type: 'nodebuffer' })
  const html = await docxToHtml(buffer)
  assert.match(html, /文件柜预览 &amp; 文档转换/)
  assert.match(html, /<!DOCTYPE html>/i)
  assert.match(await docxToMarkdown(buffer), /文件柜预览 & 文档转换/)
  await assert.rejects(docxToHtml(Buffer.from('not an Office ZIP')))
})
