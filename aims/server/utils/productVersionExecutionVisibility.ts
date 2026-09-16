import { createError } from 'h3'
import type { ProductVersionAcceptancePreview } from '../../app/types/productVersionAcceptance'

// Keep aggregate product facts and the server review hash unchanged. Never
// replace denied project rows with identifiers or titles in a placeholder.
export async function filterProductVersionExecution(
  preview: ProductVersionAcceptancePreview,
  canViewProject: (projectID: number) => Promise<boolean>
): Promise<ProductVersionAcceptancePreview> {
  const rows = [...preview.execution.targets, ...preview.execution.open_defects]
  const ids = [...new Set(rows.map(row => row.project_id))]
  if (ids.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error('项目明细标识无效')
  const allowed = new Set<number>()
  // Sequential calls reuse the request authorization cache without flooding
  // Console for a cross-project version. Errors propagate, never become grants.
  for (const id of ids) if (await canViewProject(id)) allowed.add(id)
  const targets = preview.execution.targets.filter(row => allowed.has(row.project_id))
  const defects = preview.execution.open_defects.filter(row => allowed.has(row.project_id))
  return { ...preview, execution: { ...preview.execution, targets, open_defects: defects, target_count: preview.execution.targets.length, open_defect_count: preview.execution.open_defects.length, restricted_item_count: rows.length - targets.length - defects.length } }
}

export async function requireCompleteProductExecutionVisibility(preview: ProductVersionAcceptancePreview, canViewProject: (projectID: number) => Promise<boolean>) {
  const visible = await filterProductVersionExecution(preview, canViewProject)
  if (visible.execution.restricted_item_count) throw createError({ statusCode: 403, message: '须具备全部关联执行项目的查看权限才能核验验收或发布' })
}
