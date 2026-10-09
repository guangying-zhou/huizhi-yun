import type {
  ProjectCategory,
  MilestoneMode,
  PivrStage,
  ProjectTemplateDefinition,
  ProjectTemplateDeliverableType,
  ProjectTemplateMilestoneDefinition,
  ProjectTemplateWorkItemDefinition
} from '~/types/aims'
import { getMilestoneDeliverables } from '~/config/deliverable-templates'
import { projectModuleCategoryDefaults } from '~/utils/projectModuleConfig'
import { pivrTypeMapping, pivrMilestoneModes, pivrStageOrder } from '~/config/milestone'

type DefaultMilestoneSeed = {
  name: string
  description?: string | null
  mode: MilestoneMode
  pivrStage: PivrStage
  sortOrder: number
}

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

/**
 * 按分类生成 PIVR 里程碑种子。
 *
 * 名称与 mode 的唯一来源是 `~/config/milestone` 的 `pivrTypeMapping` 与
 * `pivrMilestoneModes`，规范见《汇智PIVR项目管理生命周期模型说明书V1.1》§3。
 *
 * 返回空数组的两种情况：
 *   - maintenance：走 buildDefaultProjectTemplateDefinition 的专用分支
 *     （周期单元 monthly_cycle + 常驻工单容器 service_ops），四阶段仅作节奏标签
 *   - routine：日常事务容器不使用 PIVR，不生成里程碑
 */
export function getDefaultMilestoneSeeds(category: ProjectCategory): DefaultMilestoneSeed[] {
  const stages = pivrTypeMapping[category]
  const modes = pivrMilestoneModes[category]

  if (!stages || !modes) {
    // maintenance 与 routine 为已知的空结果，不告警
    if (category !== 'maintenance' && category !== 'routine') {
      console.warn(
        `[project-template] 分类 ${category} 未在 pivrTypeMapping / pivrMilestoneModes 中登记，`
        + '不会生成默认里程碑。新增分类需同步 config/milestone.ts 与 data-runtime 的 defaultProjectMilestoneSeeds。'
      )
    }
    return []
  }

  return pivrStageOrder.map((stage, index) => ({
    name: stages[stage].title,
    mode: modes[stage],
    pivrStage: stage,
    sortOrder: index + 1
  }))
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
  if (category === 'maintenance') {
    const serviceOpsItems: ProjectTemplateWorkItemDefinition[] = [
      {
        key: 'service-ticket-triage',
        title: '工单分诊与处理',
        type: 'task',
        tier: 'target',
        description: '承接 Altoc 回流服务工单，完成分诊、处理和结果回写。',
        required: true,
        reviewLevel: 1,
        priority: 'P1',
        sortOrder: 0,
        deliverables: []
      }
    ]

    const monthlyDeliverables = getMilestoneDeliverables(category, 'R')
    const monthlyItems: ProjectTemplateWorkItemDefinition[] = monthlyDeliverables.map((deliverable, index) => {
      const itemKey = `monthly-item-${index + 1}-${slugify(deliverable.name)}`
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

    return {
      schemaVersion: 2,
      schema_version: 2,
      defaultModuleConfig: { ...projectModuleCategoryDefaults[category] },
      default_module_config: { ...projectModuleCategoryDefaults[category] },
      milestones: [
        {
          key: 'service_ops',
          name: '工单处理',
          description: '常驻服务工单执行容器；Altoc 未指定里程碑时回流工单进入此容器。',
          mode: 'rolling_plan',
          pivrStage: 'I',
          sortOrder: 1,
          workItems: serviceOpsItems
        },
        {
          key: 'monthly_cycle',
          name: '月度运维周期',
          description: '按月滚动的运维复盘周期，用于沉淀本期统计、巡检和复盘交付物。',
          mode: 'periodic',
          pivrStage: 'R',
          sortOrder: 2,
          workItems: monthlyItems,
          recurrenceRule: 'monthly',
          recurrence_rule: 'monthly',
          carryover: 'auto',
          recurringWorkItems: [
            {
              key: 'patrol-db',
              title: '数据库巡检',
              type: 'task',
              tier: 'matter',
              description: '每周期自动生成的数据库巡检任务。',
              required: false,
              reviewLevel: 1,
              priority: 'P2',
              sortOrder: 0,
              deliverables: []
            }
          ],
          recurring_work_items: [
            {
              key: 'patrol-db',
              title: '数据库巡检',
              type: 'task',
              tier: 'matter',
              description: '每周期自动生成的数据库巡检任务。',
              required: false,
              reviewLevel: 1,
              priority: 'P2',
              sortOrder: 0,
              deliverables: []
            }
          ]
        }
      ]
    }
  }

  const milestones: ProjectTemplateMilestoneDefinition[] = getDefaultMilestoneSeeds(category).map((seed) => {
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

  return {
    schemaVersion: 2,
    schema_version: 2,
    defaultModuleConfig: { ...projectModuleCategoryDefaults[category] },
    default_module_config: { ...projectModuleCategoryDefaults[category] },
    milestones
  }
}
