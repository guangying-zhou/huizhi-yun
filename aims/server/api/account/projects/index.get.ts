/**
 * 获取项目列表
 * 路由: GET /api/account/git-projects
 */

import { listGitGroupProjects } from '@hzy/foundation/server/utils/gitIntegration'

interface DirectoryProjectItem {
  projectCode?: string | null
  parentId?: string | null
}

interface DirectoryProjectListResponse {
  code?: number
  data?: {
    items?: DirectoryProjectItem[]
    managed?: DirectoryProjectItem[]
    joined?: DirectoryProjectItem[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

function queryText(value: unknown) {
  const first = Array.isArray(value) ? value[0] : value
  return String(first || '').trim()
}

export default defineEventHandler(async (event) => {
  const uid = await requireAimsSessionUid(event)
  const query = getQuery(event)
  const parentId = queryText(query.parent_id ?? query.parentId)
  if (!parentId) {
    return await fetchDirectoryApi<DirectoryProjectListResponse>(
      `/api/v1/users/${encodeURIComponent(uid)}/projects`,
      {
        params: query,
        event
      }
    )
  }

  // The Directory relationship is the authorization gate; GitLab is the
  // live repository catalog so a stale Directory sync cannot truncate the picker.
  const response = await fetchDirectoryApi<DirectoryProjectListResponse>(
    `/api/v1/users/${encodeURIComponent(uid)}/projects`,
    {
      params: {
        only_group: 'true',
        include_template: 'false'
      },
      event
    }
  )
  const groupItems = [
    ...(response.data?.items || []),
    ...(response.data?.managed || []),
    ...(response.data?.joined || [])
  ]
  if (!groupItems.some(item => queryText(item.projectCode) === parentId)) {
    throw createError({ statusCode: 403, message: '当前用户无权访问该 Git 群组' })
  }

  const repositories = await listGitGroupProjects({
    groupPath: parentId,
    includeArchived: false
  })
  return {
    ...response,
    data: {
      ...response.data,
      items: repositories.items,
      managed: [],
      joined: [],
      total: repositories.total
    }
  }
})
