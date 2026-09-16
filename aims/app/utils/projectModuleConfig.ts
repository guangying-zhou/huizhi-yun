import type { ModuleConfig, ProjectCategory } from '~/types/aims'

export const projectModuleKeys = [
  'milestones',
  'workflows',
  'requirements',
  'releases',
  'environments',
  'service_desk',
  'decomposition'
] as const

export type ProjectModuleKey = typeof projectModuleKeys[number]

export type NormalizedProjectModuleConfig = Record<ProjectModuleKey, boolean>

export const projectModuleMeta: Record<ProjectModuleKey, { label: string, description: string, icon: string }> = {
  milestones: {
    label: '里程碑',
    description: 'PIVR 计划、里程碑详情和交付约束。',
    icon: 'i-lucide-flag'
  },
  workflows: {
    label: '流程审计',
    description: '审批、流程流转和关键状态留痕。',
    icon: 'i-lucide-route'
  },
  requirements: {
    label: '需求',
    description: '需求池、基线评审和需求变更。',
    icon: 'i-lucide-clipboard-list'
  },
  releases: {
    label: '产品版本',
    description: '产品关联、版本清单、特性和发布推进。',
    icon: 'i-lucide-git-branch'
  },
  environments: {
    label: '环境',
    description: '项目与正式环境的执行关系、上线和交接状态。',
    icon: 'i-lucide-server-cog'
  },
  service_desk: {
    label: '工单',
    description: '运维工单执行视图和服务处理统计。',
    icon: 'i-lucide-headset'
  },
  decomposition: {
    label: '需求分解',
    description: '从需求目标拆分实施任务的工作台。',
    icon: 'i-lucide-list-tree'
  }
}

export const projectModuleDefaultConfig: NormalizedProjectModuleConfig = {
  milestones: true,
  workflows: true,
  requirements: true,
  releases: false,
  environments: false,
  service_desk: false,
  decomposition: true
}

export const projectModuleCategoryDefaults: Record<ProjectCategory, NormalizedProjectModuleConfig> = {
  product_dev: {
    milestones: true,
    workflows: true,
    requirements: true,
    releases: true,
    environments: false,
    service_desk: false,
    decomposition: true
  },
  custom_dev: {
    milestones: true,
    workflows: true,
    requirements: true,
    releases: false,
    environments: true,
    service_desk: false,
    decomposition: true
  },
  delivery: {
    milestones: true,
    workflows: true,
    requirements: false,
    releases: false,
    environments: true,
    service_desk: false,
    decomposition: false
  },
  maintenance: {
    milestones: true,
    workflows: true,
    requirements: false,
    releases: false,
    environments: true,
    service_desk: true,
    decomposition: false
  },
  sales: {
    milestones: true,
    workflows: true,
    requirements: false,
    releases: false,
    environments: false,
    service_desk: false,
    decomposition: false
  },
  presales: {
    milestones: true,
    workflows: true,
    requirements: false,
    releases: false,
    environments: false,
    service_desk: false,
    decomposition: false
  },
  improvement: {
    milestones: true,
    workflows: true,
    requirements: false,
    releases: false,
    environments: false,
    service_desk: false,
    decomposition: false
  },
  compliance: {
    milestones: true,
    workflows: true,
    requirements: false,
    releases: false,
    environments: false,
    service_desk: false,
    decomposition: false
  },
  // 日常事务容器：不使用 PIVR 阶段与里程碑，只保留工作项与工时
  routine: {
    milestones: false,
    workflows: false,
    requirements: false,
    releases: false,
    environments: false,
    service_desk: false,
    decomposition: false
  }
}

function booleanValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  }
  return null
}

export function parseModuleConfig(value: unknown): Record<string, unknown> {
  if (!value) return {}
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return {}

  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function pickModuleConfig(value: unknown): Partial<NormalizedProjectModuleConfig> {
  const raw = parseModuleConfig(value)
  const result: Partial<NormalizedProjectModuleConfig> = {}

  for (const key of projectModuleKeys) {
    const parsed = booleanValue(raw[key])
    if (parsed !== null) result[key] = parsed
  }

  const legacyMilestones = booleanValue(raw.milestonesEnabled)
  if (legacyMilestones !== null && result.milestones == null) {
    result.milestones = legacyMilestones
  }

  const legacyWorkflows = booleanValue(raw.processAuditEnabled)
  if (legacyWorkflows !== null && result.workflows == null) {
    result.workflows = legacyWorkflows
  }

  return result
}

export function normalizeProjectModuleConfig(
  value: unknown,
  category: ProjectCategory = 'custom_dev',
  templateDefault?: unknown
): NormalizedProjectModuleConfig {
  return {
    ...projectModuleDefaultConfig,
    ...(projectModuleCategoryDefaults[category] || {}),
    ...pickModuleConfig(templateDefault),
    ...pickModuleConfig(value)
  }
}

export function toPersistedProjectModuleConfig(
  value: unknown,
  category: ProjectCategory = 'custom_dev',
  templateDefault?: unknown
): ModuleConfig {
  const normalized = normalizeProjectModuleConfig(value, category, templateDefault)
  return Object.fromEntries(
    projectModuleKeys.map(key => [key, normalized[key]])
  ) as ModuleConfig
}

export function projectModuleEnabled(
  value: unknown,
  category: ProjectCategory | undefined,
  key: ProjectModuleKey,
  templateDefault?: unknown
) {
  return normalizeProjectModuleConfig(value, category || 'custom_dev', templateDefault)[key]
}
