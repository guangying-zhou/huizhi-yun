/**
 * 获取当前用户有权限的部门列表
 *
 * 调用 Account API 获取，包含：
 * - 用户所在部门
 * - 用户作为 manager 的部门
 * - 用户作为 leader（分管领导）的部门
 * - 以上部门的所有下属部门
 */
import type { Department } from '@hzy/foundation/app/types/account'

export function useAccessibleDepartments() {
  const departments = ref<Department[]>([])
  const loading = ref(false)

  async function fetchAccessibleDepartments() {
    loading.value = true
    try {
      const res = await $fetch<{ code: number, data: Department[] }>(
        '/api/account/accessible-departments'
      )
      if (res.code === 0 && res.data) {
        departments.value = res.data
      }
    } catch (error) {
      console.error('Failed to fetch accessible departments:', error)
    } finally {
      loading.value = false
    }
  }

  onMounted(fetchAccessibleDepartments)

  const departmentOptions = computed(() =>
    departments.value.map(d => ({ label: d.name, value: d.deptCode }))
  )

  return {
    accessibleDepartments: departments,
    departmentOptions,
    loading,
    refresh: fetchAccessibleDepartments
  }
}
