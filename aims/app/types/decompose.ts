/**
 * 需求分解功能的前端共享类型
 */

export type DecomposeMode = 'category' | 'flat'
export type RequirementCategory = 'functional' | 'non_functional'
export type DeliverableType = 'code' | 'document' | 'artifact'
export type DecomposePriority = 'P0' | 'P1' | 'P2' | 'P3'
export type TargetMode = 'split' | 'direct'

/**
 * 大纲节点的 UI 状态
 * 继承解析出的 OutlineNode 并加上交互态
 */
export interface UiNode {
  key: string
  depth: 1 | 2 | 3 | 4 | 5 | 6
  title: string
  anchor: string
  bodyMarkdown: string
  children: UiNode[]

  // 锁定（已分解）
  locked: boolean
  lockedWorkItemKey?: string

  // 勾选
  selected: boolean

  // target 形态
  targetMode: TargetMode

  // 任务配置
  deliverableType: DeliverableType
  priority: DecomposePriority
  packBundleId: string | null

  // 分类模式下 H2 作为分类
  categoryLabel: RequirementCategory | undefined
  categoryEnabled: boolean
}
