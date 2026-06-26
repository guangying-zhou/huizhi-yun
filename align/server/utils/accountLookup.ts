import { fetchAccountApi } from '@hzy/foundation/server/utils/accountApi'

interface AccountUser {
  id: number
  uid: string
  realName: string
  nickname: string | null
  email: string
  mobile?: string | null
  avatar: string | null
  gender?: number
  status: number
  deptCode?: string | null
  deptName?: string | null
  department?: {
    id: number
    name: string
    code: string
  }
}

interface ApiResponse<T> {
  code: number
  message: string
  data: T
}

export async function getUserByEmail(email: string): Promise<AccountUser | null> {
  try {
    const response = await fetchAccountApi<ApiResponse<{
      items: AccountUser[]
      total: number
    }>>(
      '/api/v1/users',
      { params: { search: email } }
    )

    if (response.code === 0 && response.data?.items?.length) {
      const matched = response.data.items.find(
        user => user.email?.toLowerCase() === email.toLowerCase()
      )
      return matched || null
    }

    return null
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[NuxtTemplate.getUserByEmail] error:', message)
    return null
  }
}
