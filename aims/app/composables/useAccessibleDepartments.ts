/**
 * 获取当前用户有权限的部门列表
 *
 * 独立应用经 Console 目录读取，企业宿主经 directory-self 固定操作读取，范围一致：
 * - 用户所在部门
 * - 用户作为 manager 的部门
 * - 用户作为 leader（分管领导）的部门
 * - 以上部门的所有下属部门
 *
 * 读取失败不静默：暴露 error / errorMessage 供表单展示，并以固定 id 的 toast 提示
 * （同页多个调用方只出现一条）。
 */
import type { Department } from '@hzy/foundation/app/types/account'
import { useAimsModule } from '../../layer/useAimsModule'

export type AccessibleDepartmentsError = 'forbidden' | 'unavailable'

const toastId = 'aims-accessible-departments-error'

export function accessibleDepartmentsErrorKind(error: unknown): AccessibleDepartmentsError {
  const candidate = error as { statusCode?: unknown, status?: unknown, response?: { status?: unknown } } | null
  const status = Number(candidate?.statusCode ?? candidate?.status ?? candidate?.response?.status)
  return status === 403 ? 'forbidden' : 'unavailable'
}

export function accessibleDepartmentsErrorMessage(kind: AccessibleDepartmentsError | null) {
  if (kind === 'forbidden') return '你没有读取可选部门的权限，请联系管理员开通后再选择部门。'
  if (kind === 'unavailable') return '可选部门暂时无法加载，请稍后重试。'
  return ''
}

export function useAccessibleDepartments() {
  // 同一份 composable 供独立应用与企业宿主使用。
  const { moduleUrl } = useAimsModule()
  const toast = useToast()
  const departments = ref<Department[]>([])
  const loading = ref(false)
  const error = ref<AccessibleDepartmentsError | null>(null)
  const errorMessage = computed(() => accessibleDepartmentsErrorMessage(error.value))

  async function fetchAccessibleDepartments() {
    loading.value = true
    error.value = null
    try {
      const res = await $fetch<{ code: number, data: Department[] }>(
        moduleUrl('/api/account/accessible-departments')
      )
      if (res.code !== 0 || !Array.isArray(res.data)) throw Object.assign(new Error('invalid accessible departments response'), { statusCode: 503 })
      departments.value = res.data
    } catch (cause) {
      departments.value = []
      error.value = accessibleDepartmentsErrorKind(cause)
      toast.add({
        id: toastId,
        title: error.value === 'forbidden' ? '无权读取可选部门' : '可选部门加载失败',
        description: errorMessage.value,
        color: error.value === 'forbidden' ? 'warning' : 'error',
        icon: error.value === 'forbidden' ? 'i-lucide-shield-alert' : 'i-lucide-cloud-off'
      })
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
    error,
    errorMessage,
    refresh: fetchAccessibleDepartments
  }
}
