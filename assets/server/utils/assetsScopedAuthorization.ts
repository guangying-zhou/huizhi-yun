import type { H3Event } from 'h3'
import { loadScopedAuthorizationFromConsoleRuntime } from '@hzy/foundation/server/utils/platformBundleAuthorization'
import { fetchDirectoryApi } from '@hzy/foundation/server/utils/directoryApi'
import { appCode } from '~~/app/config/permissions'
import {
  assetsObjectScopeFromScopedAuthorization,
  assetsObjectScopeQuery,
  type AssetsDepartmentTreeCodeIndex,
  type AssetsScopedAction
} from './assetsScopedAuthorizationCore'

let treeCache: { expiresAt: number, value: AssetsDepartmentTreeCodeIndex } | null = null
interface DirectoryResponse { data?: Array<Record<string, unknown>> | { tree?: Array<Record<string, unknown>> }, tree?: Array<Record<string, unknown>> }
interface ConsoleAuth { deptCodes?: unknown, deptCode?: unknown, claims?: { dept_codes?: unknown, dept_code?: unknown } }
const text = (value: unknown) => String(value || '').trim()
const split = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(split) : text(value).split(/[\s,;]+/).filter(Boolean)

function treeIndex(nodes: Array<Record<string, unknown>> = []) {
  const index: AssetsDepartmentTreeCodeIndex = {}
  const collect = (node: Record<string, unknown>): string[] => {
    const code = text(node.deptCode || node.dept_code || node.code)
    const children = Array.isArray(node.children) ? node.children as Array<Record<string, unknown>> : []
    const values = Array.from(new Set([code, ...children.flatMap(collect)].filter(Boolean)))
    if (code) index[code] = values
    return values
  }
  nodes.forEach(collect)
  return index
}

async function loadTreeIndex() {
  if (treeCache && treeCache.expiresAt > Date.now()) return treeCache.value
  try {
    const response = await fetchDirectoryApi<DirectoryResponse>('/api/v1/directory/departments')
    const nodes = Array.isArray(response.data) ? response.data : (response.data?.tree || response.tree || [])
    const value = treeIndex(nodes)
    treeCache = { expiresAt: Date.now() + 60_000, value }
    return value
  } catch { return {} }
}

export async function resolveAssetsObjectScopeQuery(event: H3Event, uid: string, resourceCode: string, action: AssetsScopedAction) {
  const scoped = await loadScopedAuthorizationFromConsoleRuntime(event, uid, appCode, { resourceCode, action })
  const auth = event.context.consoleAuth as ConsoleAuth | undefined
  const currentDeptCodes = Array.from(new Set([
    ...split(auth?.deptCodes), ...split(auth?.deptCode), ...split(auth?.claims?.dept_codes), ...split(auth?.claims?.dept_code)
  ]))
  return assetsObjectScopeQuery(assetsObjectScopeFromScopedAuthorization(
    scoped, resourceCode, action, currentDeptCodes, await loadTreeIndex()
  ))
}
