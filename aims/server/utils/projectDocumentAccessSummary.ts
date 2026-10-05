export function buildAccessSummary(input: {
  lifecycleStage: string
  confidentialityLevel: string
  allowInternalAccess: boolean
  allowCrossProject: boolean
  grantCount: number
}) {
  if (input.lifecycleStage === 'draft') return '草稿，仅项目成员'
  if (input.confidentialityLevel === 'L3') return `机密，白名单 ${input.grantCount} 项`
  if (input.allowInternalAccess && (input.confidentialityLevel === 'L0' || input.confidentialityLevel === 'L1')) {
    return '企业内部可查看'
  }
  if (input.allowCrossProject) return `已授权 ${input.grantCount} 项`
  return '仅项目成员'
}
