/**
 * 审批引擎 - 处理审批流程逻辑
 */

interface FlowNode {
  index: number
  name: string
  role: string
  pass_type: 'all' | 'any' | 'ratio'
  pass_count: number
  pass_total?: number
  reviewers: string[]
}

interface ReviewAction {
  node_index: number
  actor_uid: string
  action: 'approve' | 'reject' | 'remind'
}

/**
 * 检查当前节点是否满足通过条件
 * @param node 当前节点配置
 * @param actions 该节点的所有操作记录
 * @returns 是否满足通过条件
 */
export function checkNodePassCondition(
  node: FlowNode,
  actions: ReviewAction[]
): boolean {
  // 筛选出当前节点的通过操作
  const approveActions = actions.filter(
    a => a.node_index === node.index && a.action === 'approve'
  )
  const approveCount = approveActions.length

  switch (node.pass_type) {
    case 'all':
      // 会签: 需要 pass_count 人通过
      return approveCount >= node.pass_count
    case 'any':
      // 或签: 任一人通过即可
      return approveCount >= 1
    case 'ratio':
      // 按比例: pass_count / pass_total
      if (!node.pass_total) return false
      return approveCount >= node.pass_count
    default:
      return false
  }
}

/**
 * 获取当前节点的审阅人列表
 * @param flowSnapshot 流程快照
 * @param currentNode 当前节点序号
 * @returns 审阅人UID数组
 */
export function getCurrentNodeReviewers(
  flowSnapshot: FlowNode[],
  currentNode: number
): string[] {
  const node = flowSnapshot.find(n => n.index === currentNode)
  return node?.reviewers || []
}

/**
 * 检查用户是否是当前节点的审阅人
 * @param uid 用户UID
 * @param flowSnapshot 流程快照
 * @param currentNode 当前节点序号
 * @returns 是否是审阅人
 */
export function isCurrentNodeReviewer(
  uid: string,
  flowSnapshot: FlowNode[],
  currentNode: number
): boolean {
  const reviewers = getCurrentNodeReviewers(flowSnapshot, currentNode)
  return reviewers.includes(uid)
}

/**
 * 检查用户是否已经在当前节点操作过
 * @param uid 用户UID
 * @param actions 所有操作记录
 * @param currentNode 当前节点序号
 * @returns 是否已操作
 */
export function hasUserActedOnNode(
  uid: string,
  actions: ReviewAction[],
  currentNode: number
): boolean {
  return actions.some(
    a =>
      a.node_index === currentNode
      && a.actor_uid === uid
      && (a.action === 'approve' || a.action === 'reject')
  )
}

/**
 * 计算下一个节点序号
 * @param flowSnapshot 流程快照
 * @param currentNode 当前节点序号
 * @returns 下一个节点序号，如果没有则返回 null
 */
export function getNextNode(
  flowSnapshot: FlowNode[],
  currentNode: number
): number | null {
  const nextNode = flowSnapshot.find(n => n.index === currentNode + 1)
  return nextNode ? nextNode.index : null
}
