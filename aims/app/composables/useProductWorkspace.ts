import type { ComputedRef, Ref } from 'vue'

export interface ProductWorkspace {
  management_kind?: 'product' | 'product_line'
  revision: number
  product_code: string
  /** 产品目录名称，目录未刷新或产品不在当前目录代次时为 null */
  product_name: string | null
  product_line: string | null
  product_line_label: string | null
  positioning: string | null
  target_users: string | null
  value_statement: string | null
  status: 'active' | 'archived'
}

export interface ProductWorkspacePermissions {
  edit: boolean
  archive: boolean
  restore: boolean
  admin: boolean
}

/**
 * 产品空间基础信息与操作权限。
 * 产品工作台的导航栏、概览页和设置页共用同一份读取结果，按产品编码去重请求。
 */
export function useProductWorkspace(code: Ref<string> | ComputedRef<string>) {
  const workspaceRequest = useAsyncData(() => `product-workspace:${code.value}`, async () => {
    const product = code.value
    if (!product) return null
    const response = await $fetch<{ code: number, data: ProductWorkspace }, string>(`/api/v1/products/${encodeURIComponent(product)}`, { timeout: 30000 })
    const value = response.data
    if (response.code !== 0 || value?.product_code !== product || !Number.isSafeInteger(value.revision) || value.revision < 1 || !['active', 'archived'].includes(value.status)) {
      throw new Error('产品空间响应不完整')
    }
    return value
  }, { server: false, watch: [code] })

  const permissionRequest = useAsyncData(() => `product-workspace-permissions:${code.value}`, async () => {
    const product = code.value
    if (!product) return null
    const response = await $fetch<{ code: number, data: ProductWorkspacePermissions }, string>(`/api/v1/products/${encodeURIComponent(product)}/permissions`, { timeout: 30000 })
    if (response.code !== 0 || !response.data) throw new Error('产品操作权限响应不完整')
    return response.data
  }, { server: false, watch: [code] })

  /** 只有当前产品的成功读取结果才可用于渲染 */
  const product = computed(() => workspaceRequest.status.value === 'success' && workspaceRequest.data.value?.product_code === code.value ? workspaceRequest.data.value : null)
  const displayName = computed(() => product.value?.product_name || product.value?.product_code || code.value)
  const productLineLabel = computed(() => product.value?.product_line_label || product.value?.product_line || null)

  async function refreshAll() {
    await Promise.all([workspaceRequest.refresh(), permissionRequest.refresh()])
  }

  return {
    product,
    displayName,
    productLineLabel,
    workspaceStatus: workspaceRequest.status,
    workspaceError: workspaceRequest.error,
    refreshWorkspace: workspaceRequest.refresh,
    permissions: permissionRequest.data,
    permissionStatus: permissionRequest.status,
    permissionError: permissionRequest.error,
    refreshPermissions: permissionRequest.refresh,
    refreshAll
  }
}
