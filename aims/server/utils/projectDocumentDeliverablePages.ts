import { createError } from 'h3'

export const PROJECT_DOCUMENT_DELIVERABLE_PAGE_SIZE = 100
export const PROJECT_DOCUMENT_DELIVERABLE_MAX_PAGES = 100

/** Read the complete result before callers perform document ACL filtering. */
export async function loadProjectDocumentDeliverablePages<T>(
  readPage: (page: number, pageSize: number) => Promise<{ items?: T[], total?: number }>
): Promise<T[]> {
  const items: T[] = []
  for (let page = 1; page <= PROJECT_DOCUMENT_DELIVERABLE_MAX_PAGES; page++) {
    const result = await readPage(page, PROJECT_DOCUMENT_DELIVERABLE_PAGE_SIZE)
    if (!Array.isArray(result.items) || result.items.length > PROJECT_DOCUMENT_DELIVERABLE_PAGE_SIZE) {
      throw createError({ statusCode: 502, message: '项目成果分页响应无效', data: { code: 'project_document_deliverables_invalid_page' } })
    }
    items.push(...result.items)
    if (result.total !== undefined) {
      if (!Number.isSafeInteger(result.total) || result.total < 0 || result.total < items.length) {
        throw createError({ statusCode: 502, message: '项目成果分页总数无效', data: { code: 'project_document_deliverables_invalid_page' } })
      }
      if (items.length === result.total) return items
      if (result.items.length === 0) {
        throw createError({ statusCode: 503, message: '项目成果分页未完整读取，请重试', data: { code: 'project_document_deliverables_incomplete' } })
      }
    } else if (result.items.length < PROJECT_DOCUMENT_DELIVERABLE_PAGE_SIZE) return items
  }
  throw createError({ statusCode: 503, message: '项目成果数量超过读取上限，无法提供完整文档列表', data: { code: 'project_document_deliverables_page_limit' } })
}
