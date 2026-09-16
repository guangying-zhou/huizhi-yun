/**
 * Markdown 大纲解析工具
 *
 * 用于需求分解功能：从 Markdown 正文解析 H1–H6 标题树，
 * 并按锚点截取指定章节的正文段（从该 heading 到下一个同级/更高级 heading 之间的所有 token）。
 *
 * 锚点策略：直接使用 heading 原文作为锚点（保留编号前缀）。
 * 同文档内若出现重复标题，调用方需自行降级到全路径锚点。
 */
import { marked } from 'marked'
import type { Token, Tokens } from 'marked'

export interface OutlineNode {
  depth: 1 | 2 | 3 | 4 | 5 | 6
  title: string
  anchor: string
  startIndex: number
  endIndex: number
  children: OutlineNode[]
}

/**
 * 从 Markdown 原文提取大纲树
 * - 只保留 H1–H6
 * - 按 depth 构建父子关系
 * - startIndex/endIndex 指向 tokens 数组的切片范围（含本 heading，不含下一个同级 heading）
 */
export function parseOutline(markdown: string): { tokens: Token[], outline: OutlineNode[] } {
  const tokens = marked.lexer(markdown)

  const flat: OutlineNode[] = []
  tokens.forEach((token, index) => {
    if (token.type === 'heading') {
      const heading = token as Tokens.Heading
      const depth = heading.depth as OutlineNode['depth']
      if (depth < 1 || depth > 6) return
      const title = heading.text.trim()
      flat.push({
        depth,
        title,
        anchor: title,
        startIndex: index,
        endIndex: tokens.length,
        children: []
      })
    }
  })

  // 确定每个 heading 的 endIndex：下一个同级或更高级 heading 出现的位置
  for (let i = 0; i < flat.length; i++) {
    const current = flat[i]!
    for (let j = i + 1; j < flat.length; j++) {
      const next = flat[j]!
      if (next.depth <= current.depth) {
        current.endIndex = next.startIndex
        break
      }
    }
  }

  // 构建树形结构
  const roots: OutlineNode[] = []
  const stack: OutlineNode[] = []
  for (const node of flat) {
    while (stack.length > 0 && stack[stack.length - 1]!.depth >= node.depth) {
      stack.pop()
    }
    if (stack.length === 0) {
      roots.push(node)
    } else {
      stack[stack.length - 1]!.children.push(node)
    }
    stack.push(node)
  }

  return { tokens, outline: roots }
}

/**
 * 按锚点从 Markdown 原文截取对应的章节原文（含本 heading）
 * 返回 null 表示未命中（断链）
 */
export function extractSection(markdown: string, anchor: string): {
  markdown: string
  title: string
  depth: number
} | null {
  const { tokens, outline } = parseOutline(markdown)
  const target = findNodeByAnchor(outline, anchor)
  if (!target) return null

  const sliceTokens = tokens.slice(target.startIndex, target.endIndex)
  const sectionMd = sliceTokens
    .map(t => t.raw || '')
    .join('')
    .replace(/\s+$/u, '')

  return {
    markdown: sectionMd,
    title: target.title,
    depth: target.depth
  }
}

/**
 * 递归查找匹配锚点的节点
 */
export function findNodeByAnchor(outline: OutlineNode[], anchor: string): OutlineNode | null {
  for (const node of outline) {
    if (node.anchor === anchor) return node
    const child = findNodeByAnchor(node.children, anchor)
    if (child) return child
  }
  return null
}

/**
 * 将大纲树展平为简化的 JSON（供前端和增量 diff 使用）
 */
export function flattenOutline(outline: OutlineNode[]): Array<{
  depth: number
  title: string
  anchor: string
}> {
  const result: Array<{ depth: number, title: string, anchor: string }> = []
  const walk = (nodes: OutlineNode[]) => {
    for (const node of nodes) {
      result.push({ depth: node.depth, title: node.title, anchor: node.anchor })
      walk(node.children)
    }
  }
  walk(outline)
  return result
}
