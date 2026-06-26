import type {
  ProjectCategory,
  ProjectTemplateDefinition,
  ProjectTemplateVersionDetail
} from '~/types/aims'

export type RawProjectTemplateVersion = Partial<ProjectTemplateVersionDetail> & {
  template_set_id?: number
  template_set_code?: string | null
  template_set_name?: string | null
  version_no?: number
  version_label?: string
  usage_count?: number
  is_system?: boolean | number
  published_at?: string | null
  archived_at?: string | null
  created_by?: string
  created_at?: string
  updated_at?: string
  definition_json?: string | ProjectTemplateDefinition | null
}

export function normalizeListPayload<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (payload && typeof payload === 'object') {
    const data = payload as { items?: unknown }
    if (Array.isArray(data.items)) return data.items as T[]
  }
  return []
}

export function normalizeProjectTemplateVersion(raw: RawProjectTemplateVersion): ProjectTemplateVersionDetail {
  return {
    id: Number(raw.id || 0),
    templateSetId: Number(raw.templateSetId ?? raw.template_set_id ?? 0),
    templateSetCode: raw.templateSetCode ?? raw.template_set_code ?? '',
    templateSetName: raw.templateSetName ?? raw.template_set_name ?? getFallbackTemplateSetName(raw),
    category: raw.category ?? 'product_dev',
    versionNo: Number(raw.versionNo ?? raw.version_no ?? 1),
    versionLabel: raw.versionLabel ?? raw.version_label ?? '',
    status: raw.status ?? 'draft',
    usageCount: Number(raw.usageCount ?? raw.usage_count ?? 0),
    isSystem: Boolean(raw.isSystem ?? raw.is_system),
    notes: raw.notes ?? null,
    publishedAt: raw.publishedAt ?? raw.published_at ?? null,
    archivedAt: raw.archivedAt ?? raw.archived_at ?? null,
    createdBy: raw.createdBy ?? raw.created_by ?? '',
    createdAt: raw.createdAt ?? raw.created_at ?? '',
    updatedAt: raw.updatedAt ?? raw.updated_at ?? '',
    definition: normalizeTemplateDefinition(raw.definition ?? raw.definition_json)
  }
}

function getFallbackTemplateSetName(raw: RawProjectTemplateVersion) {
  const category = raw.category || 'product_dev'
  return `${getCategoryLabel(category)} 默认模板`
}

function getCategoryLabel(category: ProjectCategory) {
  const labels: Record<ProjectCategory, string> = {
    product_dev: '产品研发',
    custom_dev: '定制开发',
    delivery: '交付实施',
    maintenance: '运维保障',
    sales: '销售',
    presales: '售前',
    improvement: '改进',
    compliance: '合规'
  }
  return labels[category] || category
}

function normalizeTemplateDefinition(value: unknown): ProjectTemplateDefinition {
  if (value && typeof value === 'object') {
    return normalizeDefinitionObject(value)
  }

  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      return normalizeDefinitionObject(parsed)
    } catch {
      return { milestones: [] }
    }
  }

  return { milestones: [] }
}

function normalizeDefinitionObject(value: unknown): ProjectTemplateDefinition {
  const definition = value as { milestones?: unknown }
  return {
    milestones: Array.isArray(definition.milestones) ? definition.milestones as ProjectTemplateDefinition['milestones'] : []
  }
}
