export interface RequirementReviewMilestone {
  id: number
  name: string
}

export interface RequirementReviewMilestoneRequirement {
  id: number
  reqCode: string
  milestoneId?: number | null
  milestoneName?: string | null
}

export type RequirementReviewMilestoneValidationContext = 'batch' | 'selection'

interface RequirementReviewMilestoneValidationInput {
  context: RequirementReviewMilestoneValidationContext
  currentMilestone: RequirementReviewMilestone | null
  requirementIds: readonly number[]
  requirements: readonly RequirementReviewMilestoneRequirement[]
}

const messages = {
  batch: {
    noActiveMilestone: '当前没有活动里程碑，暂不可提交需求评审',
    noRequirements: '该评审批次没有关联需求项',
    incomplete: '部分批次需求未加载完成，请刷新后重试',
    missingMilestone: (sample: string, suffix: string) => `批次中有需求未绑定里程碑（${sample}${suffix}），无法提交审批`,
    multipleMilestones: (names: string) => `当前批次包含多个里程碑的需求（${names}），仅允许提交当前活动里程碑的评审批次`,
    inactiveMilestone: (currentName: string, milestoneName: string) =>
      `仅当前活动里程碑「${currentName}」的需求评审批次允许提交，当前批次属于「${milestoneName}」`
  },
  selection: {
    noActiveMilestone: '当前没有活动里程碑，暂不可创建需求评审批次',
    incomplete: '部分已选需求未加载完成，请刷新后重试',
    missingMilestone: (sample: string, suffix: string) => `所选需求中有未绑定里程碑的项（${sample}${suffix}），无法创建评审批次`,
    multipleMilestones: (names: string) => `所选需求包含多个里程碑（${names}），仅允许创建当前活动里程碑的评审批次`,
    inactiveMilestone: (currentName: string, milestoneName: string) =>
      `仅当前活动里程碑「${currentName}」的需求可创建评审批次，当前选择属于「${milestoneName}」`
  }
} as const

/**
 * Keeps the requirement review boundary fail-closed: a batch or selection can
 * proceed only when every requirement is loaded and belongs to the one active
 * milestone. The page retains data loading, toast, and workflow submission.
 */
export function requirementReviewMilestoneIssues({
  context,
  currentMilestone,
  requirementIds,
  requirements
}: RequirementReviewMilestoneValidationInput): string[] {
  if (!currentMilestone) return [messages[context].noActiveMilestone]

  if (context === 'batch' && requirementIds.length === 0) {
    return [messages.batch.noRequirements]
  }

  const message = messages[context]

  if (requirements.length !== requirementIds.length) {
    return [message.incomplete]
  }

  const issues: string[] = []
  const missingMilestoneRequirements = requirements.filter(requirement => requirement.milestoneId == null)
  if (missingMilestoneRequirements.length > 0) {
    const sample = missingMilestoneRequirements.slice(0, 3).map(requirement => requirement.reqCode).join('、')
    const suffix = missingMilestoneRequirements.length > 3 ? ` 等 ${missingMilestoneRequirements.length} 条` : ''
    issues.push(message.missingMilestone(sample, suffix))
  }

  const milestones = new Map<number, string>()
  for (const requirement of requirements) {
    if (requirement.milestoneId == null || milestones.has(requirement.milestoneId)) continue
    milestones.set(requirement.milestoneId, requirement.milestoneName || `里程碑#${requirement.milestoneId}`)
  }

  if (milestones.size > 1) {
    issues.push(message.multipleMilestones(Array.from(milestones.values()).join('、')))
  } else if (milestones.size === 1) {
    const [milestoneId, milestoneName] = Array.from(milestones.entries())[0]!
    if (milestoneId !== currentMilestone.id) {
      issues.push(message.inactiveMilestone(currentMilestone.name, milestoneName))
    }
  }

  return issues
}
