export const productAdoptionRoles: Record<string, string> = {
  primary: '主环境', test: '测试', production: '生产', backup: '备份',
  disaster_recovery: '容灾', training: '培训', other: '其他'
}

export const productAdoptionStates: Record<string, { label: string, color: 'neutral' | 'info' | 'success' | 'warning' }> = {
  planned: { label: '规划中', color: 'neutral' },
  provisioning: { label: '准备中', color: 'info' },
  deployed: { label: '已部署', color: 'info' },
  online: { label: '已上线', color: 'success' },
  accepted: { label: '已验收', color: 'success' },
  suspended: { label: '已暂停', color: 'warning' },
  removed: { label: '已移除', color: 'neutral' }
}

export const productPlanningCycleStates = {
  draft: { label: '草案', color: 'neutral' },
  open: { label: '开放中', color: 'success' },
  closed: { label: '已关闭', color: 'warning' }
} as const
