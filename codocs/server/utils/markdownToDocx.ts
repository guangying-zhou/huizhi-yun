/**
 * Markdown → DOCX 转换工具
 * 按照《公文格式说明》(GB/T 9704-2012) 排版规范生成 Word 文档
 */
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  AlignmentType,
  WidthType,
  BorderStyle,
  LineRuleType
} from 'docx'
import { lexer as mdLexer } from 'marked'

/** Minimal shape of a marked token for internal use */
interface MdToken {
  type: string
  text?: string
  raw?: string
  depth?: number
  tokens?: MdToken[]
  items?: MdToken[]
  header?: MdToken[]
  rows?: MdToken[][]
  [key: string]: unknown
}

// ===== 公文规范常量 =====
const FONT_SIMHEI = '黑体' // 一级标题
const FONT_KAITI = '楷体_GB2312' // 二级标题
const FONT_FANGSONG = '仿宋_GB2312' // 正文 & 三级以下标题
const FONT_XIAOBIAOSONG = '方正小标宋简体' // 文档主标题
const SIZE_TWO = 44 // 22pt（半磅单位：22 × 2 = 44）
const SIZE_THREE = 32 // 16pt（半磅单位：16 × 2 = 32）
const INDENT_2CHAR = 480 // 2 字符首行缩进（缇）
const MARGIN = 1440 // 页边距 1440 缇（约 2.54cm）

// 中文数字（供一/二级标题序号）
const CN_NUMS = [
  '一',
  '二',
  '三',
  '四',
  '五',
  '六',
  '七',
  '八',
  '九',
  '十',
  '十一',
  '十二',
  '十三',
  '十四',
  '十五',
  '十六',
  '十七',
  '十八',
  '十九',
  '二十',
  '二十一',
  '二十二',
  '二十三',
  '二十四',
  '二十五',
  '二十六',
  '二十七',
  '二十八',
  '二十九',
  '三十'
]
// 圆圈数字（五级标题）
const CIRCLES = [
  '①',
  '②',
  '③',
  '④',
  '⑤',
  '⑥',
  '⑦',
  '⑧',
  '⑨',
  '⑩',
  '⑪',
  '⑫',
  '⑬',
  '⑭',
  '⑮',
  '⑯',
  '⑰',
  '⑱',
  '⑲',
  '⑳'
]

const toCN = (n: number) => (n >= 1 && n <= 30 ? CN_NUMS[n - 1] : String(n))
const toCircle = (n: number) =>
  n >= 1 && n <= 20 ? CIRCLES[n - 1] : String(n)

/** 去除标题中已有的序号，防止重复 */
function stripPrefix(text: string, depth: number): string {
  if (depth === 2)
    return text
      .replace(/^第[一二三四五六七八九十百千万\d]+[章]\s*/, '')
      .replace(/^[一二三四五六七八九十百千万]+、\s*/, '')
  if (depth === 3)
    return text
      .replace(/^第[一二三四五六七八九十百千万\d]+[条节款项]\s*/, '')
      .replace(/^（[一二三四五六七八九十百千万]+）\s*/, '')
  if (depth === 4) return text.replace(/^\d+[.．]\s*/, '')
  if (depth === 5) return text.replace(/^（\d+）\s*/, '')
  if (depth === 6) return text.replace(/^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑲⑳]\s*/, '')
  return text
}

/** 提取 token 树的纯文本 */
function plainText(tokens: MdToken[]): string {
  return (tokens ?? [])
    .map((t) => {
      if (t.tokens) return plainText(t.tokens)
      return t.text ?? t.raw ?? ''
    })
    .join('')
}

/** 行内 token → TextRun[] */
function inlineRuns(
  tokens: MdToken[],
  opts: {
    bold?: boolean
    italic?: boolean
    strike?: boolean
    size?: number
  } = {}
): TextRun[] {
  const fontSize = opts.size ?? SIZE_THREE
  const out: TextRun[] = []
  for (const t of tokens ?? []) {
    if (t.type === 'text' || t.type === 'escape') {
      // text token 本身可能还有子 tokens（如加粗内嵌文字）
      if (t.tokens && t.tokens.length > 0) {
        out.push(...inlineRuns(t.tokens, opts))
      } else {
        const text = t.text ?? t.raw ?? ''
        if (text)
          out.push(
            new TextRun({
              text,
              font: FONT_FANGSONG,
              size: fontSize,
              bold: opts.bold,
              italics: opts.italic,
              strike: opts.strike
            })
          )
      }
    } else if (t.type === 'strong') {
      out.push(...inlineRuns(t.tokens ?? [], { ...opts, bold: true }))
    } else if (t.type === 'em') {
      out.push(...inlineRuns(t.tokens ?? [], { ...opts, italic: true }))
    } else if (t.type === 'del') {
      out.push(...inlineRuns(t.tokens ?? [], { ...opts, strike: true }))
    } else if (t.type === 'codespan') {
      out.push(
        new TextRun({
          text: t.text,
          font: 'Courier New',
          size: fontSize,
          bold: opts.bold
        })
      )
    } else if (t.type === 'link') {
      const linkText = t.tokens ? plainText(t.tokens) : t.text || (t.href as string)
      out.push(
        new TextRun({
          text: linkText,
          font: FONT_FANGSONG,
          size: fontSize,
          color: '0563C1'
        })
      )
    } else if (t.type === 'image') {
      out.push(
        new TextRun({
          text: `[图片: ${t.text || t.title || t.href}]`,
          font: FONT_FANGSONG,
          size: fontSize
        })
      )
    } else if (t.type === 'br') {
      out.push(new TextRun({ break: 1 }))
    }
  }
  return out
}

/** 构建带基础公文格式的正文段落 */
function bodyParagraph(
  runs: TextRun[],
  opts: {
    before?: number
    after?: number
    firstLine?: number
    left?: number
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType]
  } = {}
): Paragraph {
  const indent: Record<string, number> = {}
  if (opts.firstLine) indent.firstLine = opts.firstLine
  if (opts.left) indent.left = opts.left
  return new Paragraph({
    children: runs,
    spacing: {
      before: opts.before ?? 0,
      after: opts.after ?? 100,
      line: 240,
      lineRule: LineRuleType.AUTO
    },
    indent: Object.keys(indent).length ? indent : undefined,
    alignment: opts.alignment ?? AlignmentType.LEFT
  })
}

/** 构建表格边框配置 */
function cellBorder() {
  return {
    top: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
    left: { style: BorderStyle.SINGLE, size: 4, color: '000000' },
    right: { style: BorderStyle.SINGLE, size: 4, color: '000000' }
  }
}

/** Markdown 转公文格式 Document */
export async function markdownToDocx(
  markdown: string,
  docTitle: string
): Promise<Buffer> {
  const tokens = mdLexer(markdown) as unknown as MdToken[]

  // 标题计数器：[h2, h3, h4, h5, h6]（对应公文一至五级标题）
  const counters = [0, 0, 0, 0, 0]
  const children: (Paragraph | Table)[] = []
  let hasH1 = false

  for (const token of tokens) {
    if (token.type === 'heading') {
      const depth = token.depth!

      if (depth === 1) {
        // 主标题：方正小标宋简体，二号，居中，段前/后 400 缇
        hasH1 = true
        counters.fill(0)
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: plainText(token.tokens ?? []),
                font: FONT_XIAOBIAOSONG,
                size: SIZE_TWO,
                bold: true
              })
            ],
            spacing: {
              before: 400,
              after: 400,
              line: 240,
              lineRule: LineRuleType.AUTO
            },
            alignment: AlignmentType.CENTER
          })
        )
      } else {
        // 二至六级标题
        const idx = depth - 2
        counters[idx] = (counters[idx] ?? 0) + 1
        for (let i = idx + 1; i < 5; i++) counters[i] = 0

        const rawText = plainText(token.tokens ?? [])

        // 检测是否使用了"第X章/节/条/款"等正式编号格式，如果是则保留原样
        const hasFormalPrefix
          = (depth === 2
            && /^第[一二三四五六七八九十百千万\d]+[章]/.test(rawText))
          || (depth === 3
            && /^第[一二三四五六七八九十百千万\d]+[条节款项]/.test(rawText))

        let prefix = ''
        let stripped = rawText

        if (hasFormalPrefix) {
          // 保留原始编号，不做替换
          prefix = ''
          stripped = rawText
        } else {
          stripped = stripPrefix(rawText, depth)
          if (depth === 2) prefix = `${toCN(counters[0] ?? 0)}、`
          else if (depth === 3) prefix = `（${toCN(counters[1] ?? 0)}）`
          else if (depth === 4) prefix = `${counters[2] ?? 0}.`
          else if (depth === 5) prefix = `（${counters[3] ?? 0}）`
          else if (depth === 6) prefix = `${toCircle(counters[4] ?? 0)} `
        }

        let font = FONT_FANGSONG
        let bold = false
        if (depth === 2) {
          font = FONT_SIMHEI
          bold = true
        } else if (depth === 3) {
          font = FONT_KAITI
          bold = true
        } else if (depth === 4) {
          font = FONT_FANGSONG
          bold = true
        }

        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: prefix + stripped,
                font,
                size: SIZE_THREE,
                bold
              })
            ],
            spacing: {
              before: 100,
              after: 200,
              line: 240,
              lineRule: LineRuleType.AUTO
            },
            indent: { firstLine: INDENT_2CHAR },
            alignment: AlignmentType.LEFT
          })
        )
      }
    } else if (token.type === 'paragraph') {
      // 检查段落中是否包含换行符（markdown 中单换行在同一段落内）
      // 将包含 \n 的段落拆分为多个独立段落
      const rawText = token.raw || ''
      if (rawText.includes('\n') && !rawText.includes('\n\n')) {
        // 单换行分隔的内容，拆分为多个段落
        const lines = rawText.replace(/\n$/, '').split('\n')
        for (const line of lines) {
          if (!line.trim()) continue
          const lineTokens = mdLexer(line) as Array<{ type: string, tokens?: MdToken[] }>
          // mdLexer 会返回 paragraph token，取其 inline tokens
          const pToken = lineTokens.find(t => t.type === 'paragraph')
          if (pToken) {
            const runs = inlineRuns(pToken.tokens ?? [])
            if (runs.length > 0) {
              children.push(
                bodyParagraph(runs, { after: 100, firstLine: INDENT_2CHAR })
              )
            }
          }
        }
      } else {
        const runs = inlineRuns(token.tokens ?? [])
        if (runs.length > 0) {
          children.push(
            bodyParagraph(runs, { after: 100, firstLine: INDENT_2CHAR })
          )
        }
      }
    } else if (token.type === 'blockquote') {
      for (const inner of (token.tokens ?? []) as MdToken[]) {
        if (inner.type === 'paragraph') {
          const runs = inlineRuns(inner.tokens ?? [], { italic: true })
          if (runs.length > 0) {
            children.push(
              bodyParagraph(runs, {
                before: 50,
                after: 100,
                left: INDENT_2CHAR
              })
            )
          }
        }
      }
    } else if (token.type === 'list') {
      const processListItems = (items: MdToken[], indentLevel: number) => {
        for (const item of items) {
          // 列表项 tokens 第一个通常是 text 块（含行内 tokens）或 paragraph
          const blockToken = ((item.tokens as MdToken[]) ?? []).find(
            (t: MdToken) => t.type === 'text' || t.type === 'paragraph'
          )
          const inlineTokens = blockToken?.tokens ?? [
            { type: 'text', text: item.text }
          ]
          const runs = inlineRuns(inlineTokens)
          if (runs.length > 0) {
            children.push(
              bodyParagraph(runs, {
                before: 50,
                after: 100,
                firstLine: INDENT_2CHAR,
                left: indentLevel > 0 ? INDENT_2CHAR * indentLevel : undefined
              })
            )
          }
          // 处理嵌套列表
          for (const subToken of (item.tokens as MdToken[]) ?? []) {
            if (subToken.type === 'list') {
              processListItems(subToken.items ?? [], indentLevel + 1)
            }
          }
        }
      }
      processListItems((token as MdToken).items ?? [], 0)
    } else if (token.type === 'table') {
      const tbl = token as MdToken
      const rows: TableRow[] = []
      const TABLE_FONT_SIZE = 24 // 12pt 小四号

      // 表头行
      const headerCells = (tbl.header ?? []).map((cell: MdToken) => {
        const txt = cell.tokens ? plainText(cell.tokens) : (cell.text ?? '')
        return new TableCell({
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: txt,
                  font: FONT_FANGSONG,
                  size: TABLE_FONT_SIZE,
                  bold: true
                })
              ],
              alignment: AlignmentType.CENTER,
              spacing: {
                before: 40,
                after: 40,
                line: 240,
                lineRule: LineRuleType.AUTO
              }
            })
          ],
          borders: cellBorder(),
          shading: { fill: 'F0F0F0' },
          margins: { top: 40, bottom: 40, left: 80, right: 80 }
        })
      })
      if (headerCells.length > 0)
        rows.push(new TableRow({ children: headerCells, tableHeader: true }))

      // 数据行
      for (const row of tbl.rows ?? []) {
        const cells = (row as MdToken[]).map((cell: MdToken) => {
          const runs = inlineRuns(
            cell.tokens ?? [{ type: 'text', text: cell.text ?? '' }],
            { size: TABLE_FONT_SIZE }
          )
          return new TableCell({
            children: [
              new Paragraph({
                children:
                  runs.length > 0
                    ? runs
                    : [
                        new TextRun({
                          text: cell.text ?? '',
                          font: FONT_FANGSONG,
                          size: TABLE_FONT_SIZE
                        })
                      ],
                alignment: AlignmentType.LEFT,
                spacing: {
                  before: 20,
                  after: 20,
                  line: 240,
                  lineRule: LineRuleType.AUTO
                }
              })
            ],
            borders: cellBorder(),
            margins: { top: 40, bottom: 40, left: 80, right: 80 }
          })
        })
        rows.push(new TableRow({ children: cells }))
      }

      if (rows.length > 0) {
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows
          })
        )
        // 表格后空段落
        children.push(
          new Paragraph({ children: [], spacing: { before: 100, after: 100 } })
        )
      }
    } else if (token.type === 'code') {
      const codeToken = token as MdToken
      // 代码块：用带浅灰边框的单格表格包裹，保持等宽字体对齐
      const codeLines = (codeToken.text || '').split('\n')
      const codeRuns: TextRun[] = []
      for (let i = 0; i < codeLines.length; i++) {
        if (i > 0) codeRuns.push(new TextRun({ break: 1 }))
        // 将前导空格替换为不间断空格，防止 Word 吞掉缩进
        const line = codeLines[i]!.replace(/^ +/, (m: string) =>
          '\u00A0'.repeat(m.length)
        )
        codeRuns.push(
          new TextRun({
            text: line || ' ',
            font: 'Courier New',
            size: 21 // 10.5pt 小五号
          })
        )
      }
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  children: [
                    new Paragraph({
                      children: codeRuns,
                      spacing: {
                        before: 60,
                        after: 60,
                        line: 276,
                        lineRule: LineRuleType.AUTO
                      }
                    })
                  ],
                  borders: {
                    top: {
                      style: BorderStyle.SINGLE,
                      size: 4,
                      color: 'CCCCCC'
                    },
                    bottom: {
                      style: BorderStyle.SINGLE,
                      size: 4,
                      color: 'CCCCCC'
                    },
                    left: {
                      style: BorderStyle.SINGLE,
                      size: 4,
                      color: 'CCCCCC'
                    },
                    right: {
                      style: BorderStyle.SINGLE,
                      size: 4,
                      color: 'CCCCCC'
                    }
                  },
                  shading: { fill: 'F5F5F5' }
                })
              ]
            })
          ]
        })
      )
      // 代码块后空行
      children.push(
        new Paragraph({ children: [], spacing: { before: 50, after: 100 } })
      )
    } else if (token.type === 'hr') {
      // 水平分割线
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: '————————————————————————————————',
              font: FONT_FANGSONG,
              size: SIZE_THREE
            })
          ],
          spacing: { before: 100, after: 100 },
          alignment: AlignmentType.CENTER
        })
      )
    }
    // space 跳过
  }

  // 若 Markdown 无 # 一级标题，则自动以文件名作为主标题插入文首
  if (!hasH1 && docTitle) {
    children.unshift(
      new Paragraph({
        children: [
          new TextRun({
            text: docTitle,
            font: FONT_XIAOBIAOSONG,
            size: SIZE_TWO,
            bold: true
          })
        ],
        spacing: {
          before: 400,
          after: 400,
          line: 240,
          lineRule: LineRuleType.AUTO
        },
        alignment: AlignmentType.CENTER
      })
    )
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4（缇）
            margin: {
              top: MARGIN,
              right: MARGIN,
              bottom: MARGIN,
              left: MARGIN
            }
          }
        },
        children
      }
    ]
  })

  return Packer.toBuffer(doc)
}
