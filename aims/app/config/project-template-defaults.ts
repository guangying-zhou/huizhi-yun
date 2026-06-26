import type {
  ProjectCategory,
  PivrStage,
  ProjectTemplateDefinition,
  ProjectTemplateDeliverableType,
  ProjectTemplateMilestoneDefinition,
  ProjectTemplateWorkItemDefinition
} from '~/types/aims'
import { getMilestoneDeliverables } from '~/config/deliverable-templates'

type DefaultMilestoneSeed = Omit<ProjectTemplateMilestoneDefinition, 'workItems' | 'key'>

export const projectTemplateDeliverableActionPrefix: Record<ProjectTemplateDeliverableType, string> = {
  document: '编制',
  code: '提交',
  artifact: '完成',
  task: '完成'
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function buildDefaultTemplateWorkItemTitle(name: string, deliverableType: ProjectTemplateDeliverableType) {
  const prefix = projectTemplateDeliverableActionPrefix[deliverableType] || '完成'
  return `${prefix}${name}`
}

export function getDefaultMilestoneSeeds(category: ProjectCategory): DefaultMilestoneSeed[] {
  switch (category) {
    case 'product_dev':
      return [
        { name: '规划POC', mode: 'strong_constraint', pivrStage: 'P', sortOrder: 1 },
        { name: '核心MVP', mode: 'strong_constraint', pivrStage: 'I', sortOrder: 2 },
        { name: '商用MMP', mode: 'strong_constraint', pivrStage: 'V', sortOrder: 3 },
        { name: '市场PMF', mode: 'rolling_plan', pivrStage: 'R', sortOrder: 4 }
      ]
    case 'custom_dev':
      return [
        { name: '需求确认', mode: 'strong_constraint', pivrStage: 'P', sortOrder: 1 },
        { name: '系统构建', mode: 'strong_constraint', pivrStage: 'I', sortOrder: 2 },
        { name: '验收 UAT', mode: 'strong_constraint', pivrStage: 'V', sortOrder: 3 },
        { name: '维保移交', mode: 'rolling_plan', pivrStage: 'R', sortOrder: 4 }
      ]
    case 'delivery':
      return [
        { name: '进场交底', mode: 'strong_constraint', pivrStage: 'P', sortOrder: 1 },
        { name: '部署配置', mode: 'strong_constraint', pivrStage: 'I', sortOrder: 2 },
        { name: '试运行', mode: 'strong_constraint', pivrStage: 'V', sortOrder: 3 },
        { name: '项目结项', mode: 'rolling_plan', pivrStage: 'R', sortOrder: 4 }
      ]
    case 'maintenance':
      return [
        { name: '周期规划', mode: 'periodic', pivrStage: 'P', sortOrder: 1 },
        { name: '任务处理', mode: 'periodic', pivrStage: 'I', sortOrder: 2 },
        { name: '质量抽检', mode: 'periodic', pivrStage: 'V', sortOrder: 3 },
        { name: '复盘优化', mode: 'periodic', pivrStage: 'R', sortOrder: 4 }
      ]
    case 'sales':
      return [
        { name: '线索获取', mode: 'rolling_plan', pivrStage: 'P', sortOrder: 1 },
        { name: '方案沟通', mode: 'rolling_plan', pivrStage: 'I', sortOrder: 2 },
        { name: '商务谈判', mode: 'strong_constraint', pivrStage: 'V', sortOrder: 3 },
        { name: '客户成功', mode: 'rolling_plan', pivrStage: 'R', sortOrder: 4 }
      ]
    case 'presales':
      return [
        { name: '商机分析', mode: 'rolling_plan', pivrStage: 'P', sortOrder: 1 },
        { name: '标书制作', mode: 'strong_constraint', pivrStage: 'I', sortOrder: 2 },
        { name: '投标演示', mode: 'strong_constraint', pivrStage: 'V', sortOrder: 3 },
        { name: '经验复盘', mode: 'rolling_plan', pivrStage: 'R', sortOrder: 4 }
      ]
    case 'improvement':
      return [
        { name: '缺陷分析', mode: 'rolling_plan', pivrStage: 'P', sortOrder: 1 },
        { name: '方案执行', mode: 'rolling_plan', pivrStage: 'I', sortOrder: 2 },
        { name: '效果回归', mode: 'strong_constraint', pivrStage: 'V', sortOrder: 3 },
        { name: '标准固化', mode: 'rolling_plan', pivrStage: 'R', sortOrder: 4 }
      ]
    case 'compliance':
      return [
        { name: '规章梳理', mode: 'strong_constraint', pivrStage: 'P', sortOrder: 1 },
        { name: '自查整改', mode: 'strong_constraint', pivrStage: 'I', sortOrder: 2 },
        { name: '模拟审计', mode: 'strong_constraint', pivrStage: 'V', sortOrder: 3 },
        { name: '合规加固', mode: 'rolling_plan', pivrStage: 'R', sortOrder: 4 }
      ]
    default:
      return [
        { name: '准备', mode: 'rolling_plan', pivrStage: 'P', sortOrder: 1 },
        { name: '实施', mode: 'rolling_plan', pivrStage: 'I', sortOrder: 2 },
        { name: '验证', mode: 'strong_constraint', pivrStage: 'V', sortOrder: 3 },
        { name: '改进', mode: 'rolling_plan', pivrStage: 'R', sortOrder: 4 }
      ]
  }
}

const REQUIREMENT_BASELINE_KEY = 'requirement_baseline'
const REQUIREMENT_CATEGORIES: ProjectCategory[] = ['product_dev', 'custom_dev']

function buildRequirementBaselineWorkItem(): ProjectTemplateWorkItemDefinition {
  return {
    key: REQUIREMENT_BASELINE_KEY,
    title: '需求分解',
    type: 'requirement',
    tier: 'target',
    description: '本项目的需求分解工作项，挂载所有基线评审通过的需求项，聚合由需求分解出的实施任务。',
    required: true,
    reviewLevel: 1,
    priority: 'P1',
    sortOrder: -1,
    deliverables: []
  }
}

export function buildDefaultProjectTemplateDefinition(category: ProjectCategory): ProjectTemplateDefinition {
  const milestones = getDefaultMilestoneSeeds(category).map((seed) => {
    const workItems: ProjectTemplateWorkItemDefinition[] = getMilestoneDeliverables(category, seed.pivrStage as PivrStage)
      .map((deliverable, index) => {
        const itemKey = `${seed.pivrStage.toLowerCase()}-item-${index + 1}-${slugify(deliverable.name)}`
        return {
          key: itemKey,
          title: buildDefaultTemplateWorkItemTitle(deliverable.name, deliverable.deliverableType as ProjectTemplateDeliverableType),
          type: 'task',
          tier: 'target',
          description: deliverable.acceptanceCriteria || null,
          required: deliverable.required,
          reviewLevel: deliverable.reviewLevel ?? 1,
          priority: 'P2',
          sortOrder: index,
          deliverables: [
            {
              key: `${itemKey}-deliverable-1`,
              name: deliverable.name,
              description: deliverable.description || null,
              acceptanceCriteria: deliverable.acceptanceCriteria,
              deliverableType: deliverable.deliverableType as ProjectTemplateDeliverableType,
              required: deliverable.required,
              sortOrder: 0
            }
          ]
        }
      })

    // 研发类项目(product_dev/custom_dev)在 Implementation 阶段预置"需求基线"工作项
    if (REQUIREMENT_CATEGORIES.includes(category) && seed.pivrStage === 'I') {
      workItems.unshift(buildRequirementBaselineWorkItem())
    }

    return {
      key: `${seed.pivrStage.toLowerCase()}-${slugify(seed.name)}`,
      ...seed,
      workItems
    }
  })

  return { milestones }
}
