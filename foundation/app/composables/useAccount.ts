/**
 * Legacy Account composable names backed by Console Directory Runtime.
 */
import {
  useDirectoryBusinessDomains,
  useDirectoryDepartments,
  useDirectoryGitGroups,
  useDirectoryProjects,
  useDirectoryUser,
  useDirectoryUserProjects,
  useDirectoryUsers
} from './useDirectory'

export function useBusinessDomains() {
  return useDirectoryBusinessDomains()
}

export function useAccountUsers(params?: { search?: string, dept_code?: string, pageSize?: number }) {
  return useDirectoryUsers(params)
}

export function useAccountUser(uid: Ref<string | null | undefined> | string) {
  return useDirectoryUser(uid)
}

export function useAccountDepartments() {
  return useDirectoryDepartments()
}

export function useAccountProjects(params?: { dept_code?: string, search?: string, only_group?: string }) {
  return useDirectoryProjects(params)
}

export function useAccountGitGroups() {
  return useDirectoryGitGroups()
}

export function useAccountUserProjects(uid: Ref<string | null | undefined> | string) {
  return useDirectoryUserProjects(uid)
}
