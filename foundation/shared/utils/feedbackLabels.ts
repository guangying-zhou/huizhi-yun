export const feedbackKinds: Record<string, string> = { bug: '问题', feature: '需求', suggestion: '建议' }
export const feedbackPriorities: Record<string, string> = { low: '低', mid: '中', high: '高', blocking: '紧急' }
export const feedbackStates: Record<string, string> = { draft: '尚未提交', pending: '等待建单', dispatching: '正在建单', submitted: '已建单', failed: '创建失败，等待管理员处理', unknown: '建单结果待管理员核对', cancelled: '已取消' }
