import type { WorkflowByBizResult } from '@hzy/foundation/app/types/workflow'
import type { LifecycleStatus } from '~/types/aims'

export type ProjectWorkflowActionCode = 'initiation' | 'pause' | 'resume' | 'finish'

export interface ProjectWorkflowActionConfig {
  name: string
  actionLabel: string
  submitLabel: string
  successLabel: string
  description: string
  approvalLevel: '二级审批' | '三级审批'
  reasonLabel: string
  reasonPlaceholder: string
}

export type ProjectWorkflowInstanceMap = Partial<Record<ProjectWorkflowActionCode, WorkflowByBizResult | null>>

export const projectWorkflowActionOrder: ProjectWorkflowActionCode[] = [
  'initiation',
  'pause',
  'resume',
  'finish'
]

export const projectWorkflowActionConfigs: Record<ProjectWorkflowActionCode, ProjectWorkflowActionConfig> = {
  initiation: {
    name: '项目立项审批',
    actionLabel: '立项审批',
    submitLabel: '发起立项审批',
    successLabel: '立项审批',
    description: '新项目立项审批，审核项目可行性、资源匹配和预算',
    approvalLevel: '二级审批',
    reasonLabel: '立项说明',
    reasonPlaceholder: '请输入项目立项说明'
  },
  pause: {
    name: '项目暂停审批',
    actionLabel: '申请暂停',
    submitLabel: '发起暂停审批',
    successLabel: '暂停审批',
    description: '项目暂停审批，审核暂停原因、影响范围和恢复条件',
    approvalLevel: '二级审批',
    reasonLabel: '暂停理由',
    reasonPlaceholder: '请输入项目暂停原因、影响范围和预计恢复条件'
  },
  resume: {
    name: '项目恢复审批',
    actionLabel: '申请恢复',
    submitLabel: '发起恢复审批',
    successLabel: '恢复审批',
    description: '项目恢复审批，审核恢复依据、资源准备和后续计划',
    approvalLevel: '二级审批',
    reasonLabel: '恢复理由',
    reasonPlaceholder: '请输入项目恢复原因、当前准备情况和后续推进安排'
  },
  finish: {
    name: '项目结项审批',
    actionLabel: '申请结项',
    submitLabel: '发起结项审批',
    successLabel: '结项审批',
    description: '项目结项审批，确认交付物完整性、验收结果和收尾安排',
    approvalLevel: '三级审批',
    reasonLabel: '结项说明',
    reasonPlaceholder: '请输入项目结项原因、交付情况和收尾说明'
  }
}

function toWorkflowTimestamp(instance: WorkflowByBizResult | null | undefined) {
  if (!instance) return 0
  const value = instance.completed_at || instance.created_at
  const timestamp = value ? new Date(value).getTime() : 0
  return Number.isNaN(timestamp) ? 0 : timestamp
}

export function pickLatestProjectWorkflowInstance(
  instances: ProjectWorkflowInstanceMap,
  actionCodes: ProjectWorkflowActionCode[]
) {
  let latest: { actionCode: ProjectWorkflowActionCode, instance: WorkflowByBizResult } | null = null

  for (const actionCode of actionCodes) {
    const instance = instances[actionCode]
    if (!instance) continue

    if (!latest || toWorkflowTimestamp(instance) > toWorkflowTimestamp(latest.instance)) {
      latest = { actionCode, instance }
    }
  }

  return latest
}

export function getProjectWorkflowDisplayActions(status: LifecycleStatus): ProjectWorkflowActionCode[] {
  switch (status) {
    case 'approval_pending':
    case 'draft':
      return ['initiation']
    case 'active':
      return ['finish', 'pause', 'resume', 'initiation']
    case 'paused':
      return ['resume', 'pause', 'finish', 'initiation']
    case 'completed':
      return ['finish', 'resume', 'pause', 'initiation']
    default:
      return []
  }
}

export function deriveProjectLifecycleFromWorkflow(
  currentStatus: LifecycleStatus,
  instances: ProjectWorkflowInstanceMap
): LifecycleStatus | null {
  const initiation = instances.initiation
  const pause = instances.pause
  const resume = instances.resume
  const finish = instances.finish

  if (currentStatus === 'approval_pending') {
    if (initiation?.status === 'approved') return 'active'
    if (initiation && ['rejected', 'cancelled'].includes(initiation.status)) return 'draft'
    return null
  }

  if (currentStatus === 'active') {
    if (finish?.status === 'approved') return 'completed'

    const pauseApprovedAt = pause?.status === 'approved' ? toWorkflowTimestamp(pause) : 0
    const resumeApprovedAt = resume?.status === 'approved' ? toWorkflowTimestamp(resume) : 0
    if (pauseApprovedAt > resumeApprovedAt) {
      return 'paused'
    }
    return null
  }

  if (currentStatus === 'paused') {
    const pauseApprovedAt = pause?.status === 'approved' ? toWorkflowTimestamp(pause) : 0
    const resumeApprovedAt = resume?.status === 'approved' ? toWorkflowTimestamp(resume) : 0
    if (resumeApprovedAt > pauseApprovedAt) {
      return 'active'
    }
    return null
  }

  return null
}
