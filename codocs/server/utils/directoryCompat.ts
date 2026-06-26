import {
  fetchConsoleDirectoryApi,
  fetchDirectoryApi
} from '@hzy/foundation/server/utils/directoryApi'
import type { AccountUser } from '~/types/account'

export interface DirectoryApiResponse<T> {
  code: number
  message?: string
  data: T
}

export async function fetchDirectoryResponse<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    params?: Record<string, unknown>
    body?: unknown
    timeout?: number
  } = {}
) {
  return fetchConsoleDirectoryApi<DirectoryApiResponse<T>>(path, options)
}

export async function fetchDirectoryData<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    params?: Record<string, unknown>
    body?: unknown
    timeout?: number
  } = {}
) {
  const response = await fetchDirectoryResponse<T>(path, options)
  return response.data
}

export async function fetchDirectoryUser<T = AccountUser>(uid: string, options: { timeout?: number } = {}) {
  return fetchDirectoryData<T>(`/users/${encodeURIComponent(uid)}`, {
    timeout: options.timeout
  })
}

export async function fetchConsoleRuntimeResponse<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
    params?: Record<string, unknown>
    body?: unknown
    timeout?: number
  } = {}
) {
  return fetchDirectoryApi<T>(path, options)
}
