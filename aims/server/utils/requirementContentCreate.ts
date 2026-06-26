import { marked } from 'marked'
import type { PoolConnection, ResultSetHeader, RowDataPacket } from '~~/server/utils/db'
import type { Token, Tokens } from 'marked'

type TitlePrefixStyle = 'chinese' | 'decimal'

interface ContentRow extends RowDataPacket {
  id: number
  parent_id: number | null
  heading_depth: number
  title: string
  sort_order: number
}

export interface CreateRequirementContentInput {
  projectId: number
  uid: string
  kind: 'module' | 'item'
  title: string
  contentMd?: string | null
  headingDepth: number
  parentId?: number | null
}

export interface CreateRequirementContentResult {
  id: number
  title: string
  childContentIds: number[]
}

function stripTitlePrefix(title: string) {
  return title
    .replace(/^[一二三四五六七八九十百千万零〇两]+、\s*/u, '')
    .replace(/^\d+(?:\.\d+)*(?:[、.]\s*|\s+)/u, '')
    .trim()
}

function parseChineseNumeral(text: string) {
  const normalized = text.replace(/两/gu, '二').replace(/〇/gu, '零')
  const digitMap = new Map([
    ['零', 0], ['一', 1], ['二', 2], ['三', 3], ['四', 4],
    ['五', 5], ['六', 6], ['七', 7], ['八', 8], ['九', 9]
  ])
  const unitMap = new Map([
    ['十', 10], ['百', 100], ['千', 1000]
  ])
  let total = 0
  let current = 0
  for (const char of normalized) {
    if (digitMap.has(char)) {
      current = digitMap.get(char)!
      continue
    }
    if (unitMap.has(char)) {
      const unit = unitMap.get(char)!
      total += (current || 1) * unit
      current = 0
    }
  }
  return total + current
}

function toChineseNumeral(num: number): string {
  if (num <= 0) return String(num)
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  if (num < 10) return digits[num]!
  if (num < 100) {
    const tens = Math.floor(num / 10)
    const ones = num % 10
    if (tens === 1) return `十${ones ? digits[ones] : ''}`
    return `${digits[tens]}十${ones ? digits[ones] : ''}`
  }
  if (num < 1000) {
    const hundreds = Math.floor(num / 100)
    const remainder = num % 100
    if (remainder === 0) return `${digits[hundreds]}百`
    if (remainder < 10) return `${digits[hundreds]}百零${digits[remainder]}`
    return `${digits[hundreds]}百${toChineseNumeral(remainder)}`
  }
  return String(num)
}

function parseTitlePrefix(title: string): { style: TitlePrefixStyle, value: number, segments?: number[] } | null {
  const chineseMatch = title.match(/^([一二三四五六七八九十百千万零〇两]+)、/u)
  if (chineseMatch?.[1]) {
    return {
      style: 'chinese',
      value: parseChineseNumeral(chineseMatch[1])
    }
  }

  const decimalMatch = title.match(/^(\d+(?:\.\d+)*)(?:[、.]\s*|\s+)/u)
  if (decimalMatch?.[1]) {
    const segments = decimalMatch[1].split('.').map(v => Number(v))
    return {
      style: 'decimal',
      value: segments[segments.length - 1] || 1,
      segments
    }
  }

  return null
}

function buildPrefixedTitle(prefix: string, title: string, style: TitlePrefixStyle) {
  const plainTitle = stripTitlePrefix(title)
  return style === 'chinese' ? `${prefix}${plainTitle}` : `${prefix} ${plainTitle}`
}

function deriveDecimalBaseFromParent(title: string): number[] | null {
  const parsed = parseTitlePrefix(title)
  if (parsed?.style === 'decimal' && parsed.segments) return parsed.segments
  if (parsed?.style === 'chinese') return [parsed.value]
  return null
}

async function resolveSiblingRows(
  connection: PoolConnection,
  projectId: number,
  parentId: number | null,
  headingDepth: number
) {
  const params: unknown[] = [projectId, headingDepth]
  let sql = `SELECT id, parent_id, heading_depth, title, sort_order
             FROM requirement_contents
             WHERE project_id = ? AND heading_depth = ?`
  if (parentId == null) {
    sql += ' AND parent_id IS NULL'
  } else {
    sql += ' AND parent_id = ?'
    params.push(parentId)
  }
  sql += ' ORDER BY sort_order, id'
  const [rows] = await connection.query<ContentRow[]>(sql, params)
  return rows
}

async function resolveTitleStyleAndPrefix(
  connection: PoolConnection,
  projectId: number,
  parentId: number | null,
  headingDepth: number
) {
  const siblings = await resolveSiblingRows(connection, projectId, parentId, headingDepth)
  const parsedSiblings = siblings
    .map(row => parseTitlePrefix(row.title))
    .filter((item): item is NonNullable<ReturnType<typeof parseTitlePrefix>> => !!item)

  if (parsedSiblings.length > 0) {
    const style = parsedSiblings[0]!.style
    if (style === 'chinese') {
      const maxValue = Math.max(...parsedSiblings.filter(item => item.style === 'chinese').map(item => item.value))
      return {
        style,
        prefix: `${toChineseNumeral(maxValue + 1)}、`
      }
    }

    const decimalSiblings = parsedSiblings.filter(item => item.style === 'decimal' && item.segments?.length)
    const firstSegments = decimalSiblings[0]!.segments!
    const baseSegments = firstSegments.slice(0, -1)
    const maxLast = Math.max(...decimalSiblings.map(item => item.segments![item.segments!.length - 1]!))
    return {
      style,
      prefix: [...baseSegments, maxLast + 1].join('.')
    }
  }

  if (parentId) {
    const [parentRows] = await connection.query<(RowDataPacket & { title: string })[]>(
      'SELECT title FROM requirement_contents WHERE id = ? LIMIT 1',
      [parentId]
    )
    const parentTitle = parentRows[0]?.title || ''
    const baseSegments = deriveDecimalBaseFromParent(parentTitle)
    if (baseSegments) {
      return {
        style: 'decimal' as const,
        prefix: [...baseSegments, 1].join('.')
      }
    }
  }

  return {
    style: 'chinese' as const,
    prefix: '一、'
  }
}

function splitMarkdownByHeadingDepth(markdown: string, headingDepth: number) {
  const tokens = marked.lexer(markdown || '')
  const targetHeadings: Array<{ index: number, title: string }> = []

  tokens.forEach((token, index) => {
    if (token.type !== 'heading') return
    const heading = token as Tokens.Heading
    if (heading.depth === headingDepth) {
      targetHeadings.push({ index, title: heading.text.trim() })
    }
  })

  if (targetHeadings.length === 0) {
    return {
      introMarkdown: markdown.trim(),
      sections: [] as Array<{ title: string, markdown: string }>
    }
  }

  const firstHeadingIndex = targetHeadings[0]!.index
  const introMarkdown = tokens
    .slice(0, firstHeadingIndex)
    .map(token => (token as Token & { raw?: string }).raw || '')
    .join('')
    .trim()

  const sections = targetHeadings.map((heading) => {
    let endIndex = tokens.length
    for (let i = heading.index + 1; i < tokens.length; i++) {
      const nextToken = tokens[i]
      if (nextToken?.type !== 'heading') continue
      const nextHeading = nextToken as Tokens.Heading
      if (nextHeading.depth <= headingDepth) {
        endIndex = i
        break
      }
    }
    const bodyMarkdown = tokens
      .slice(heading.index + 1, endIndex)
      .map(token => (token as Token & { raw?: string }).raw || '')
      .join('')
      .trim()

    return {
      title: heading.title,
      markdown: bodyMarkdown
    }
  })

  return { introMarkdown, sections }
}

async function nextSortOrder(connection: PoolConnection, projectId: number, parentId: number | null) {
  const params: unknown[] = [projectId]
  let sql = 'SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM requirement_contents WHERE project_id = ?'
  if (parentId == null) {
    sql += ' AND parent_id IS NULL'
  } else {
    sql += ' AND parent_id = ?'
    params.push(parentId)
  }
  const [rows] = await connection.query<(RowDataPacket & { max_sort: number })[]>(sql, params)
  return Number(rows[0]?.max_sort ?? -1) + 1
}

async function insertRequirementContent(
  connection: PoolConnection,
  projectId: number,
  uid: string,
  parentId: number | null,
  headingDepth: number,
  title: string,
  contentMd: string | null,
  sortOrder: number
) {
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO requirement_contents
     (content_original_id, version_no, version_status, project_id, parent_id, heading_depth,
      title, content_md, sort_order, status, created_by, updated_by)
     VALUES (NULL, 1, 'draft', ?, ?, ?, ?, ?, ?, 'modified', ?, ?)`,
    [projectId, parentId, headingDepth, title, contentMd, sortOrder, uid, uid]
  )
  await connection.execute(
    'UPDATE requirement_contents SET content_original_id = ? WHERE id = ?',
    [result.insertId, result.insertId]
  )
  return result.insertId
}

export async function createRequirementContent(
  connection: PoolConnection,
  input: CreateRequirementContentInput
): Promise<CreateRequirementContentResult> {
  const {
    projectId,
    uid,
    kind,
    title,
    contentMd,
    headingDepth,
    parentId = null
  } = input

  const { style, prefix } = await resolveTitleStyleAndPrefix(connection, projectId, parentId, headingDepth)
  const prefixedTitle = buildPrefixedTitle(prefix, title, style)
  const sortOrder = await nextSortOrder(connection, projectId, parentId)

  if (kind === 'item') {
    const id = await insertRequirementContent(connection, projectId, uid, parentId, headingDepth, prefixedTitle, (contentMd || '').trim() || null, sortOrder)
    return { id, title: prefixedTitle, childContentIds: [] }
  }

  const childHeadingDepth = headingDepth + 1
  const { introMarkdown, sections } = splitMarkdownByHeadingDepth(contentMd || '', childHeadingDepth)
  const moduleId = await insertRequirementContent(
    connection,
    projectId,
    uid,
    parentId,
    headingDepth,
    prefixedTitle,
    introMarkdown || null,
    sortOrder
  )

  const childContentIds: number[] = []
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i]!
    const childStyleInfo = await resolveTitleStyleAndPrefix(connection, projectId, moduleId, childHeadingDepth)
    const childTitle = buildPrefixedTitle(childStyleInfo.prefix, section.title, childStyleInfo.style)
    const childId = await insertRequirementContent(
      connection,
      projectId,
      uid,
      moduleId,
      childHeadingDepth,
      childTitle,
      section.markdown || null,
      i
    )
    childContentIds.push(childId)
  }

  return { id: moduleId, title: prefixedTitle, childContentIds }
}
