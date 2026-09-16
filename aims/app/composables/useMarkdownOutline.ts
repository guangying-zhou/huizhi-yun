/**
 * Markdown 大纲解析 composable
 *
 * 从 Markdown 原文解析 H1–H6 标题树，为需求分解页提供数据。
 *
 * - 保留标题编号前缀（设计决策：便于开发者定位原文）
 * - 锚点 = 标题原文（同文档内重复时自动降级到全路径）
 * - bodyMarkdown = 从本 heading 的下一行到下一个同级/更高级 heading 之前的所有内容
 */
import { marked } from 'marked'
import type { Token, Tokens } from 'marked'

export interface OutlineNode {
  id: string
  depth: 1 | 2 | 3 | 4 | 5 | 6
  title: string
  anchor: string
  bodyMarkdown: string
  children: OutlineNode[]
}

let uidCounter = 0
function genId(): string {
  uidCounter += 1
  return `outline-${Date.now()}-${uidCounter}`
}

function collectTextOfSlice(tokens: Token[], start: number, end: number): string {
  // 跳过起始 heading 本身，从下一个 token 开始
  const slice = tokens.slice(start + 1, end)
  return slice.map(t => (t as Token & { raw?: string }).raw || '').join('').replace(/\s+$/u, '')
}

export function useMarkdownOutline() {
  /**
   * 解析 Markdown 返回大纲树
   */
  const parse = (markdown: string): OutlineNode[] => {
    if (!markdown) return []
    const tokens = marked.lexer(markdown)

    // 收集所有 heading 节点（展平带索引）
    // 忽略 H1：视为文档标题，不参与需求分解
    interface FlatHeading {
      index: number
      depth: 2 | 3 | 4 | 5 | 6
      title: string
      endIndex: number
    }
    const flat: FlatHeading[] = []
    tokens.forEach((token, i) => {
      if (token.type === 'heading') {
        const heading = token as Tokens.Heading
        const depth = heading.depth as 1 | 2 | 3 | 4 | 5 | 6
        if (depth >= 2 && depth <= 6) {
          flat.push({
            index: i,
            depth: depth as FlatHeading['depth'],
            title: heading.text.trim(),
            endIndex: tokens.length
          })
        }
      }
    })

    // 计算每个 heading 的 endIndex（下一个同级或更高级 heading）
    for (let i = 0; i < flat.length; i++) {
      for (let j = i + 1; j < flat.length; j++) {
        if (flat[j]!.depth <= flat[i]!.depth) {
          flat[i]!.endIndex = flat[j]!.index
          break
        }
      }
    }

    // 检测重复标题 → 后面会降级到全路径锚点
    const titleCount = new Map<string, number>()
    for (const h of flat) {
      titleCount.set(h.title, (titleCount.get(h.title) || 0) + 1)
    }

    // 构建扁平的 OutlineNode 数组，带 depth path
    const pathStack: string[] = []
    const prevDepths: number[] = []
    const nodes: OutlineNode[] = []

    for (const h of flat) {
      // 维护 path stack：弹出比当前 depth 更深或相等的
      while (pathStack.length > 0 && prevDepths.length > 0 && prevDepths[prevDepths.length - 1]! >= h.depth) {
        pathStack.pop()
        prevDepths.pop()
      }
      const isDuplicate = (titleCount.get(h.title) || 0) > 1
      const anchor = isDuplicate && pathStack.length > 0
        ? `${pathStack.join(' > ')} > ${h.title}`
        : h.title

      pathStack.push(h.title)
      prevDepths.push(h.depth)

      nodes.push({
        id: genId(),
        depth: h.depth,
        title: h.title,
        anchor,
        bodyMarkdown: collectTextOfSlice(tokens, h.index, h.endIndex),
        children: []
      })
    }

    // 构建树形结构
    const roots: OutlineNode[] = []
    const treeStack: OutlineNode[] = []
    for (const node of nodes) {
      while (treeStack.length > 0 && treeStack[treeStack.length - 1]!.depth >= node.depth) {
        treeStack.pop()
      }
      if (treeStack.length === 0) {
        roots.push(node)
      } else {
        treeStack[treeStack.length - 1]!.children.push(node)
      }
      treeStack.push(node)
    }

    return roots
  }

  /**
   * 启发式检测默认模式：
   *   - H2 ≤ 6 且至少有一个 H2 命中"功能需求/非功能需求/性能/安全..." → category 模式
   *   - 否则 → flat 模式
   */
  const detectDefaultMode = (outline: OutlineNode[]): 'category' | 'flat' => {
    const categoryKeywords = /功能需求|非功能需求|性能|安全|可用性|可维护性|可靠性|易用性|兼容性/
    const h2s = outline.filter(n => n.depth === 2)
    if (h2s.length === 0 || h2s.length > 6) return 'flat'
    const hit = h2s.some(h => categoryKeywords.test(h.title))
    return hit ? 'category' : 'flat'
  }

  /**
   * 展平树，用于查找与 diff
   */
  const flatten = (outline: OutlineNode[]): OutlineNode[] => {
    const result: OutlineNode[] = []
    const walk = (nodes: OutlineNode[]) => {
      for (const node of nodes) {
        result.push(node)
        walk(node.children)
      }
    }
    walk(outline)
    return result
  }

  return { parse, detectDefaultMode, flatten }
}
