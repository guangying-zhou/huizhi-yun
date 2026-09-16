import type { PivrStage, WorkItemType } from '~/types/aims'

export interface WorkItemDocTemplate {
  key: string
  title: string
  docCategory: string
  description: string
}

const fallbackTemplates: WorkItemDocTemplate[] = [
  {
    key: 'general-brief',
    title: '工作目标说明',
    docCategory: 'general',
    description: '用于记录目标背景、范围、执行说明与关键约束。'
  }
]

const templateMap: Record<PivrStage, Partial<Record<WorkItemType, WorkItemDocTemplate[]>>> = {
  P: {
    requirement: [
      {
        key: 'p-requirement-spec',
        title: '需求澄清说明',
        docCategory: 'requirement_spec',
        description: '记录目标背景、业务目标、范围边界与输入约束。'
      }
    ],
    task: [
      {
        key: 'p-task-brief',
        title: '任务准备说明',
        docCategory: 'general',
        description: '记录目标拆解前的背景、资源、依赖和约束。'
      }
    ],
    bug: [
      {
        key: 'p-bug-analysis',
        title: '缺陷分析记录',
        docCategory: 'general',
        description: '记录问题现象、影响范围、复现前提与分析假设。'
      }
    ]
  },
  I: {
    requirement: [
      {
        key: 'i-design',
        title: '实施方案',
        docCategory: 'design',
        description: '沉淀实现路径、接口约束、关键决策与执行分工。'
      }
    ],
    task: [
      {
        key: 'i-task-plan',
        title: '执行计划',
        docCategory: 'design',
        description: '记录工作路径、步骤安排、分工和交付方式。'
      }
    ],
    bug: [
      {
        key: 'i-fix-plan',
        title: '修复方案',
        docCategory: 'design',
        description: '记录定位结论、修复策略、影响分析与验证思路。'
      }
    ]
  },
  V: {
    requirement: [
      {
        key: 'v-validation',
        title: '验证记录',
        docCategory: 'test_report',
        description: '记录验收步骤、验证结果、缺陷与回归结论。'
      }
    ],
    task: [
      {
        key: 'v-checklist',
        title: '交付检查清单',
        docCategory: 'test_report',
        description: '记录任务完成证明、检查项和验收结果。'
      }
    ],
    bug: [
      {
        key: 'v-bug-verify',
        title: '缺陷验证记录',
        docCategory: 'test_report',
        description: '记录修复验证、回归范围和残余风险。'
      }
    ]
  },
  R: {
    requirement: [
      {
        key: 'r-retro',
        title: '交付复盘',
        docCategory: 'meeting_notes',
        description: '沉淀目标完成情况、偏差、经验和后续建议。'
      }
    ],
    task: [
      {
        key: 'r-task-retro',
        title: '任务复盘记录',
        docCategory: 'meeting_notes',
        description: '记录执行偏差、经验总结、遗留问题和交接说明。'
      }
    ],
    bug: [
      {
        key: 'r-bug-retro',
        title: '问题复盘记录',
        docCategory: 'meeting_notes',
        description: '记录根因、预防措施与后续治理建议。'
      }
    ]
  }
}

export function getWorkItemDocTemplates(stage: PivrStage | null | undefined, type: WorkItemType): WorkItemDocTemplate[] {
  if (!stage) return fallbackTemplates
  return templateMap[stage]?.[type] || fallbackTemplates
}

export function recommendBreakdownMode(options: {
  estimatedHours?: number | null
  deliverableCount: number
  previousArtifactCount: number
  childCount: number
}) {
  if (options.childCount > 0) return 'decompose' as const
  if ((options.estimatedHours || 0) >= 16) return 'decompose' as const
  if (options.deliverableCount >= 2) return 'decompose' as const
  if (options.previousArtifactCount >= 4) return 'decompose' as const
  return 'direct' as const
}
