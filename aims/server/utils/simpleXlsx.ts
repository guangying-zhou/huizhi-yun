interface XlsxSheet {
  name: string
  rows: Array<Array<string | number | null | undefined>>
}

interface ZipEntry {
  name: string
  data: Uint8Array
  crc32: number
  localHeaderOffset: number
}

const encoder = new TextEncoder()
const crc32Table = createCrc32Table()

export function createXlsxWorkbook(sheets: XlsxSheet[]): Uint8Array {
  const normalizedSheets = sheets
    .filter(sheet => sheet.rows.length > 0)
    .map((sheet, index) => ({
      name: sanitizeSheetName(sheet.name || `Sheet${index + 1}`, index),
      rows: sheet.rows
    }))

  if (normalizedSheets.length === 0) {
    normalizedSheets.push({ name: 'Sheet1', rows: [[]] })
  }

  const files: Array<{ name: string, content: string }> = [
    { name: '[Content_Types].xml', content: contentTypesXml(normalizedSheets.length) },
    { name: '_rels/.rels', content: rootRelsXml() },
    { name: 'xl/workbook.xml', content: workbookXml(normalizedSheets) },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRelsXml(normalizedSheets.length) },
    { name: 'xl/styles.xml', content: stylesXml() },
    ...normalizedSheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      content: worksheetXml(sheet.rows)
    }))
  ]

  return zipStore(files.map(file => ({ name: file.name, data: encoder.encode(file.content) })))
}

function contentTypesXml(sheetCount: number) {
  const sheetOverrides = Array.from({ length: sheetCount }, (_, index) =>
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  ).join('')
  return xmlDecl()
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + sheetOverrides
    + '</Types>'
}

function rootRelsXml() {
  return xmlDecl()
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>'
}

function workbookXml(sheets: Array<{ name: string }>) {
  const sheetNodes = sheets.map((sheet, index) =>
    `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  ).join('')
  return xmlDecl()
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<sheets>${sheetNodes}</sheets>`
    + '</workbook>'
}

function workbookRelsXml(sheetCount: number) {
  const sheetRels = Array.from({ length: sheetCount }, (_, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  ).join('')
  return xmlDecl()
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + sheetRels
    + `<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    + '</Relationships>'
}

function stylesXml() {
  return xmlDecl()
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts>'
    + '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
    + '</styleSheet>'
}

function worksheetXml(rows: XlsxSheet['rows']) {
  const rowNodes = rows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 1
    const cellNodes = row.map((cell, columnIndex) => cellXml(cell, `${columnName(columnIndex + 1)}${rowNumber}`)).join('')
    return `<row r="${rowNumber}">${cellNodes}</row>`
  }).join('')
  return xmlDecl()
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + `<sheetData>${rowNodes}</sheetData>`
    + '</worksheet>'
}

function cellXml(value: string | number | null | undefined, ref: string) {
  if (value === null || value === undefined || value === '') {
    return `<c r="${ref}"/>`
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`
  }
  return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(String(value))}</t></is></c>`
}

function sanitizeSheetName(name: string, index: number) {
  const sanitized = name.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31)
  return sanitized || `Sheet${index + 1}`
}

function columnName(index: number) {
  let result = ''
  let value = index
  while (value > 0) {
    value--
    result = String.fromCharCode(65 + (value % 26)) + result
    value = Math.floor(value / 26)
  }
  return result
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function xmlDecl() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
}

function zipStore(files: Array<{ name: string, data: Uint8Array }>) {
  const chunks: Uint8Array[] = []
  const entries: ZipEntry[] = []
  let offset = 0

  for (const file of files) {
    const nameBytes = encoder.encode(file.name)
    const crc32 = crc32Bytes(file.data)
    const localHeader = new Uint8Array(30 + nameBytes.length)
    const view = new DataView(localHeader.buffer)
    view.setUint32(0, 0x04034b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, 0, true)
    view.setUint16(8, 0, true)
    view.setUint16(10, 0, true)
    view.setUint16(12, 0, true)
    view.setUint32(14, crc32, true)
    view.setUint32(18, file.data.length, true)
    view.setUint32(22, file.data.length, true)
    view.setUint16(26, nameBytes.length, true)
    view.setUint16(28, 0, true)
    localHeader.set(nameBytes, 30)
    chunks.push(localHeader, file.data)
    entries.push({ name: file.name, data: file.data, crc32, localHeaderOffset: offset })
    offset += localHeader.length + file.data.length
  }

  const centralStart = offset
  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const centralHeader = new Uint8Array(46 + nameBytes.length)
    const view = new DataView(centralHeader.buffer)
    view.setUint32(0, 0x02014b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, 20, true)
    view.setUint16(8, 0, true)
    view.setUint16(10, 0, true)
    view.setUint16(12, 0, true)
    view.setUint16(14, 0, true)
    view.setUint32(16, entry.crc32, true)
    view.setUint32(20, entry.data.length, true)
    view.setUint32(24, entry.data.length, true)
    view.setUint16(28, nameBytes.length, true)
    view.setUint16(30, 0, true)
    view.setUint16(32, 0, true)
    view.setUint16(34, 0, true)
    view.setUint16(36, 0, true)
    view.setUint32(38, 0, true)
    view.setUint32(42, entry.localHeaderOffset, true)
    centralHeader.set(nameBytes, 46)
    chunks.push(centralHeader)
    offset += centralHeader.length
  }

  const centralSize = offset - centralStart
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, centralStart, true)
  chunks.push(end)

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const output = new Uint8Array(totalLength)
  let cursor = 0
  for (const chunk of chunks) {
    output.set(chunk, cursor)
    cursor += chunk.length
  }
  return output
}

function createCrc32Table() {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let crc = i
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1)
    }
    table[i] = crc >>> 0
  }
  return table
}

function crc32Bytes(data: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of data) {
    crc = crc32Table[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}
