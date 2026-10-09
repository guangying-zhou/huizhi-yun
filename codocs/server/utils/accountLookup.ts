import { fetchDirectoryResponse } from './directoryCompat'
import type { AccountUser } from '~/types/account'

export async function getUserByEmail(email: string): Promise<AccountUser | null> {
  try {
    const response = await fetchDirectoryResponse<{
      items: AccountUser[]
      total: number
    }>(
      '/users',
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
    console.error('[Codocs.getUserByEmail] error:', message)
    return null
  }
}
