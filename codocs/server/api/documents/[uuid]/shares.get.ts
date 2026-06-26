import { callCodocsTenantRuntime } from '~~/server/utils/codocsRuntime'
import { fetchDirectoryResponse } from '~~/server/utils/directoryCompat'

interface ShareRow {
  id: number
  document_id: number
  shared_to_uid: string
  permission: string
  is_opened: number
  opened_at: string | null
  message: string | null
  created_at: string
}

interface AccountUser {
  uid: string
  realName: string
  deptName?: string
}

interface ShareWithUserInfo extends ShareRow {
  real_name: string
  department_name: string
}

export default defineEventHandler(async (event) => {
  const documentId = getRouterParam(event, 'uuid')

  if (!documentId) {
    throw createError({ statusCode: 400, message: 'Missing document ID' })
  }

  const page = await callCodocsTenantRuntime<{ items?: ShareRow[] }>(event, `/v1/codocs/documents/${encodeURIComponent(documentId)}/shares`, {
    scope: 'codocs.read'
  })
  const shares = page.items || []

  if (shares.length === 0) {
    return { code: 0, message: 'success', data: [] }
  }

  // 2. Fetch user details from Console Directory
  const userIds = shares.map(s => s.shared_to_uid)
  // Deduplicate
  const uniqueUserIds = [...new Set(userIds)]

  const userMap: Record<string, AccountUser> = {}

  try {
    const response = await fetchDirectoryResponse<AccountUser[]>('/users/batch', {
      method: 'POST',
      body: {
        uids: uniqueUserIds
      }
    })

    const users = response.data || []
    users.forEach((u) => {
      userMap[u.uid] = u
    })
  } catch (error) {
    console.error('Failed to fetch users from Console Directory:', error)
  }

  // 3. Merge data
  const result: ShareWithUserInfo[] = shares.map((share) => {
    const user = userMap[share.shared_to_uid]
    return {
      ...share,
      real_name: user?.realName || share.shared_to_uid, // Fallback to uid
      department_name: user?.deptName || ''
    }
  })

  return {
    code: 0,
    message: 'success',
    data: result
  }
})
