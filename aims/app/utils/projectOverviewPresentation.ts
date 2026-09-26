import { getProjectCategoryLabel, projectCategoryConfig, projectStatusConfig } from '../config/project'

type BadgeColor = 'neutral' | 'primary' | 'success' | 'info' | 'warning' | 'error' | 'secondary'

function codeOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Host 和 Aims 共用 config/project.ts 的中文项目状态与分类词汇。 */
export function projectStatusPresentation(value: unknown): { label: string, color: BadgeColor } {
  const code = codeOf(value)
  const config = projectStatusConfig[code as keyof typeof projectStatusConfig]
  return { label: config?.label || code || '-', color: (config?.color as BadgeColor | undefined) || 'neutral' }
}

export function projectCategoryPresentation(value: unknown): { label: string, color: BadgeColor } {
  const code = codeOf(value)
  return {
    label: getProjectCategoryLabel(code) || '-',
    color: Object.hasOwn(projectCategoryConfig, code) ? 'info' : 'neutral'
  }
}
