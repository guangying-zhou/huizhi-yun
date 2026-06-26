/**
 * Office 文件转换工具
 *
 * 支持 docx → HTML/Markdown, pptx → HTML/Markdown
 */

import mammoth from 'mammoth'
import TurndownService from 'turndown'

// ============================================================
// DOCX
// ============================================================

/**
 * 将 docx Buffer 转换为 HTML
 */
export async function docxToHtml(buffer: Buffer): Promise<string> {
  const result = await mammoth.convertToHtml({ buffer })
  if (result.messages.length > 0) {
    console.warn('[docxToHtml] warnings:', result.messages)
  }
  return wrapHtml(result.value, 'Word 文档预览')
}

/**
 * 将 docx Buffer 转换为 Markdown
 */
export async function docxToMarkdown(buffer: Buffer): Promise<string> {
  const result = await mammoth.convertToHtml({ buffer })
  const td = createTurndown()
  return td.turndown(result.value)
}

// ============================================================
// PPTX
// ============================================================

/**
 * 将 pptx Buffer 转换为 HTML
 * 使用 JSZip 解析 pptx (本质是 ZIP 包含 XML)
 */
export async function pptxToHtml(buffer: Buffer): Promise<string> {
  const slides = await extractPptxSlides(buffer)
  const parts: string[] = []

  for (let i = 0; i < slides.length; i++) {
    parts.push(`
      <div style="border: 1px solid #e0e0e0; border-radius: 8px; padding: 24px; margin-bottom: 20px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">
        <div style="color: #999; font-size: 12px; margin-bottom: 12px;">幻灯片 ${i + 1}</div>
        <div style="font-size: 15px; line-height: 1.8; white-space: pre-wrap;">${escapeHtml(slides[i] || '')}</div>
      </div>
    `)
  }

  return wrapHtml(parts.join('\n'), 'PPT 演示文稿预览')
}

/**
 * 将 pptx Buffer 转换为 Markdown
 */
export async function pptxToMarkdown(buffer: Buffer): Promise<string> {
  const slides = await extractPptxSlides(buffer)
  const parts: string[] = []

  for (let i = 0; i < slides.length; i++) {
    parts.push(`## 幻灯片 ${i + 1}\n`)
    parts.push(slides[i] || '')
    parts.push('\n---\n')
  }

  return parts.join('\n')
}

/**
 * 从 pptx 中提取每张幻灯片的文本内容
 */
async function extractPptxSlides(buffer: Buffer): Promise<string[]> {
  // pptx 是 ZIP 格式，使用动态 import 避免顶层依赖
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buffer)
  const slides: string[] = []

  // 找到所有 slide 文件
  const slideFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/)?.[1] || '0')
      const numB = parseInt(b.match(/slide(\d+)/)?.[1] || '0')
      return numA - numB
    })

  for (const slidePath of slideFiles) {
    const xml = await zip.files[slidePath]!.async('string')
    const text = extractTextFromXml(xml)
    slides.push(text)
  }

  return slides
}

/**
 * 从 OOXML 中提取纯文本
 * 解析 <a:t> 标签中的文本，按 <a:p> 分段
 */
function extractTextFromXml(xml: string): string {
  const paragraphs: string[] = []

  // 匹配所有 <a:p>...</a:p> 段落
  const pRegex = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g
  let pMatch

  while ((pMatch = pRegex.exec(xml)) !== null) {
    const pContent = pMatch[1] || ''
    // 提取段落中所有 <a:t> 文本
    const texts: string[] = []
    const tRegex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g
    let tMatch
    while ((tMatch = tRegex.exec(pContent)) !== null) {
      texts.push(tMatch[1] || '')
    }
    if (texts.length > 0) {
      paragraphs.push(texts.join(''))
    }
  }

  return paragraphs.join('\n')
}

// ============================================================
// 工具函数
// ============================================================

function createTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-'
  })
  // 保留表格（turndown 默认不处理表格，添加规则）
  td.addRule('table', {
    filter: ['table'],
    replacement: (_content, node) => {
      // 在 Node 端使用 innerHTML 提取表格内容
      const tableHtml = (node as unknown as { outerHTML: string }).outerHTML || ''
      return htmlTableToMarkdown(tableHtml) + '\n\n'
    }
  })
  return td
}

/**
 * 将 HTML table 字符串转为 Markdown 表格（使用正则解析）
 */
function htmlTableToMarkdown(tableHtml: string): string {
  const rows: string[][] = []

  // 匹配所有 <tr>...</tr>
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let trMatch
  while ((trMatch = trRegex.exec(tableHtml)) !== null) {
    const trContent = trMatch[1] || ''
    const cells: string[] = []
    // 匹配 <td> 或 <th>
    const cellRegex = /<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi
    let cellMatch
    while ((cellMatch = cellRegex.exec(trContent)) !== null) {
      // 去除内部 HTML 标签，保留文本
      const text = (cellMatch[1] || '')
        .replace(/<[^>]*>/g, '')
        .trim()
        .replace(/\|/g, '\\|')
      cells.push(text)
    }
    if (cells.length > 0) {
      rows.push(cells)
    }
  }

  if (rows.length === 0) return ''

  const header = rows[0] || []
  const lines: string[] = []
  lines.push('| ' + header.join(' | ') + ' |')
  lines.push('| ' + header.map(() => '---').join(' | ') + ' |')
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || []
    const cells = header.map((_, j) => row[j] || '')
    lines.push('| ' + cells.join(' | ') + ' |')
  }
  return lines.join('\n')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function wrapHtml(body: string, title: string, extraStyles: string = ''): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.7;
      color: #333;
      max-width: 900px;
      margin: 0 auto;
      padding: 24px;
      background: #fff;
    }
    h1 { font-size: 24px; margin: 28px 0 16px; }
    h2 { font-size: 20px; margin: 24px 0 12px; }
    h3 { font-size: 17px; margin: 20px 0 10px; }
    p { margin: 8px 0; }
    img { max-width: 100%; height: auto; }
    ul, ol { padding-left: 24px; }
    blockquote { border-left: 3px solid #ddd; margin: 12px 0; padding: 4px 16px; color: #666; }
    pre { background: #f5f5f5; padding: 12px; border-radius: 6px; overflow-x: auto; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
    ${extraStyles}
  </style>
</head>
<body>
${body}
</body>
</html>`
}
