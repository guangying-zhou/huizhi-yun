<script setup lang="ts">
usePageTitle('运行诊断')

type DeploymentMode = 'managed-control-plane' | 'self-hosted-enterprise' | 'customer-hosted'
type DeploymentStatus = 'active' | 'suspended' | 'disabled'
type LicenseStatus = 'active' | 'grace' | 'expired' | 'suspended' | 'disabled'

interface DeploymentItem {
  id: number
  tenantCode: string
  appCode: string
  deploymentCode: string
  deploymentName: string
  deploymentMode: DeploymentMode
  runtimeEndpoint: string | null
  status: DeploymentStatus
  licenseStatus: LicenseStatus
  lastHeartbeatAt: string | null
  createdAt: string
  updatedAt: string
}

interface DeploymentListResponse {
  items: DeploymentItem[]
  total: number
  page: number
  pageSize: number
}

interface ApplicationOption {
  appCode: string
  appName: string
}

const deploymentModeOptions = [
  { value: 'managed-control-plane', label: 'Managed Control Plane' },
  { value: 'self-hosted-enterprise', label: 'Self-Hosted Enterprise' },
  { value: 'customer-hosted', label: 'Customer Hosted' }
]

const statusOptions = [
  { value: '', label: '全部状态' },
  { value: 'active', label: '启用' },
  { value: 'suspended', label: '暂停' },
  { value: 'disabled', label: '停用' }
]

const licenseStatusOptions = [
  { value: 'active', label: 'Active' },
  { value: 'grace', label: 'Grace' },
  { value: 'expired', label: 'Expired' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'disabled', label: 'Disabled' }
]

const route = useRoute()
const router = useRouter()

const filters = reactive({
  tenantCode: typeof route.query.tenantCode === 'string' ? route.query.tenantCode : '',
  appCode: '',
  keyword: '',
  status: ''
})

const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0
})

const deployments = ref<DeploymentItem[]>([])
const applications = ref<ApplicationOption[]>([])
const selectedDeploymentId = ref<number | null>(null)
const listPending = ref(false)
const applicationsPending = ref(false)
const formPending = ref(false)
const formMode = ref<'create' | 'edit'>('create')
const notice = ref<{ type: 'success' | 'error', message: string } | null>(null)

const form = reactive({
  tenantCode: filters.tenantCode,
  appCode: '',
  deploymentCode: '',
  deploymentName: '',
  deploymentMode: 'managed-control-plane' as DeploymentMode,
  status: 'active' as DeploymentStatus,
  licenseStatus: 'active' as LicenseStatus,
  lastHeartbeatAt: ''
})

const pageCount = computed(() => Math.max(1, Math.ceil((pagination.total || 0) / pagination.pageSize)))
const selectedDeployment = computed(() => deployments.value.find(item => item.id === selectedDeploymentId.value) || null)
const hasTenantContext = computed(() => !!filters.tenantCode.trim())
const selectedApplication = computed(() => applications.value.find(item => item.appCode === form.appCode) || null)

function resetNotice() {
  notice.value = null
}

function syncTenantQuery() {
  router.replace({
    query: {
      ...route.query,
      tenantCode: filters.tenantCode || undefined
    }
  })
}

function toInputDateTime(value: string | null) {
  if (!value) return ''
  return String(value).replace(' ', 'T').slice(0, 16)
}

function fromInputDateTime(value: string) {
  const normalized = String(value || '').trim()
  if (!normalized) return null
  if (normalized.length === 16) {
    return `${normalized.replace('T', ' ')}:00`
  }
  return normalized.replace('T', ' ')
}

function resetForm() {
  formMode.value = 'create'
  selectedDeploymentId.value = null
  form.tenantCode = filters.tenantCode
  form.appCode = ''
  form.deploymentCode = ''
  form.deploymentName = ''
  form.deploymentMode = 'managed-control-plane'
  form.status = 'active'
  form.licenseStatus = 'active'
  form.lastHeartbeatAt = ''
}

function fillForm(deployment: DeploymentItem) {
  formMode.value = 'edit'
  selectedDeploymentId.value = deployment.id
  form.tenantCode = deployment.tenantCode
  form.appCode = deployment.appCode
  form.deploymentCode = deployment.deploymentCode
  form.deploymentName = deployment.deploymentName
  form.deploymentMode = deployment.deploymentMode
  form.status = deployment.status
  form.licenseStatus = deployment.licenseStatus
  form.lastHeartbeatAt = toInputDateTime(deployment.lastHeartbeatAt)
}

async function loadApplications() {
  if (!filters.tenantCode.trim()) {
    applications.value = []
    return
  }

  applicationsPending.value = true

  try {
    const response = await platformFetchJson<{ success: true, data: { items: Array<{ appCode: string, appName: string }> } }>('/api/platform/ops/applications', {
      query: {
        tenantCode: filters.tenantCode.trim(),
        status: 'active',
        page: 1,
        pageSize: 100
      }
    })

    applications.value = response.data.items.map(item => ({
      appCode: item.appCode,
      appName: item.appName
    }))
  } catch {
    applications.value = []
  } finally {
    applicationsPending.value = false
  }
}

async function loadDeployments() {
  if (!filters.tenantCode.trim()) {
    deployments.value = []
    pagination.total = 0
    selectedDeploymentId.value = null
    if (formMode.value === 'edit') {
      resetForm()
    }
    return
  }

  listPending.value = true
  resetNotice()

  try {
    const response = await platformFetchJson<{ success: true, data: DeploymentListResponse }>('/api/platform/ops/deployments', {
      query: {
        tenantCode: filters.tenantCode.trim(),
        appCode: filters.appCode || undefined,
        keyword: filters.keyword || undefined,
        status: filters.status || undefined,
        page: pagination.page,
        pageSize: pagination.pageSize
      }
    })

    deployments.value = response.data.items
    pagination.total = response.data.total

    if (selectedDeploymentId.value && !deployments.value.some(item => item.id === selectedDeploymentId.value)) {
      selectedDeploymentId.value = null
      if (formMode.value === 'edit') {
        resetForm()
      }
    }
  } catch (error) {
    notice.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '部署列表加载失败'
    }
  } finally {
    listPending.value = false
  }
}

const debouncedReload = useDebounceFn(() => {
  pagination.page = 1
  loadDeployments()
}, 250)

watch(() => filters.keyword, debouncedReload)
watch(() => filters.appCode, () => {
  pagination.page = 1
  loadDeployments()
})
watch(() => filters.status, () => {
  pagination.page = 1
  loadDeployments()
})
watch(() => pagination.page, () => {
  loadDeployments()
})
watch(() => filters.tenantCode, async (value) => {
  pagination.page = 1
  form.tenantCode = formMode.value === 'create' ? value : form.tenantCode
  syncTenantQuery()
  await loadApplications()
  await loadDeployments()
})

watch(() => form.appCode, (value) => {
  if (!value || formMode.value !== 'create') return
  if (!form.deploymentCode.trim()) {
    form.deploymentCode = `${form.tenantCode.trim()}-${value}`
  }
  if (!form.deploymentName.trim() && selectedApplication.value) {
    form.deploymentName = `${selectedApplication.value.appName} · ${form.tenantCode.trim()}`
  }
})

function validateForm() {
  if (!form.tenantCode.trim()) {
    throw new Error('tenantCode 不能为空')
  }
  if (!form.appCode.trim()) {
    throw new Error('appCode 不能为空')
  }
  if (!form.deploymentCode.trim()) {
    throw new Error('deploymentCode 不能为空')
  }
  if (!form.deploymentName.trim()) {
    throw new Error('deploymentName 不能为空')
  }
}

async function submitForm() {
  formPending.value = true
  resetNotice()

  try {
    validateForm()

    const payload = {
      tenantCode: form.tenantCode.trim(),
      appCode: form.appCode.trim(),
      deploymentCode: form.deploymentCode.trim(),
      deploymentName: form.deploymentName.trim(),
      deploymentMode: form.deploymentMode,
      status: form.status,
      licenseStatus: form.licenseStatus,
      lastHeartbeatAt: fromInputDateTime(form.lastHeartbeatAt)
    }

    const response = formMode.value === 'create'
      ? await platformFetchJson<{ success: true, data: DeploymentItem }>('/api/platform/ops/deployments', {
          method: 'POST',
          body: payload
        })
      : await platformFetchJson<{ success: true, data: DeploymentItem }>(`/api/platform/ops/deployments/${selectedDeploymentId.value}`, {
          method: 'PATCH',
          body: {
            deploymentName: payload.deploymentName,
            deploymentMode: payload.deploymentMode,
            status: payload.status,
            licenseStatus: payload.licenseStatus,
            lastHeartbeatAt: payload.lastHeartbeatAt
          }
        })

    notice.value = {
      type: 'success',
      message: formMode.value === 'create' ? '部署已创建。' : '部署已更新。'
    }

    filters.tenantCode = payload.tenantCode
    await loadDeployments()
    fillForm(response.data)
  } catch (error) {
    notice.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '部署保存失败'
    }
  } finally {
    formPending.value = false
  }
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

onMounted(() => {
  if (filters.tenantCode) {
    loadApplications()
    loadDeployments()
  }
})
</script>

<template>
  <UDashboardPanel
    id="platform-deployments"
    :ui="{ body: 'gap-4 sm:p-4' }"
  >
    <template #body>
      <section class="grid gap-4 xl:grid-cols-[0.95fr_1.15fr]">
        <UCard>
          <template #header>
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
                  Runtime Diagnostics
                </p>
                <h1 class="text-xl font-semibold text-slate-900">
                  运行诊断
                </h1>
                <p class="mt-1 text-sm text-slate-600">
                  这里是开通编排后的诊断支撑页，重点查看 deployment、heartbeat、bundle 和 license 的运行状态。
                </p>
              </div>
              <div class="flex items-center gap-2">
                <UButton
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-refresh-cw"
                  :loading="listPending"
                  @click="loadDeployments"
                >
                  刷新
                </UButton>
                <UButton
                  color="primary"
                  icon="i-lucide-plus"
                  @click="resetForm"
                >
                  新建诊断对象
                </UButton>
              </div>
            </div>
          </template>

          <div class="space-y-4">
            <div class="grid gap-3 md:grid-cols-2">
              <label class="tenant-field md:col-span-2">
                <span class="tenant-field__label">客户 / tenantCode</span>
                <UInput
                  v-model="filters.tenantCode"
                  placeholder="先输入 tenantCode，例如 C000001"
                />
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">appCode</span>
                <select
                  v-model="filters.appCode"
                  class="tenant-native-field"
                  :disabled="applicationsPending || !hasTenantContext"
                >
                  <option value="">全部应用</option>
                  <option
                    v-for="application in applications"
                    :key="application.appCode"
                    :value="application.appCode"
                  >
                    {{ application.appName }}（{{ application.appCode }}）
                  </option>
                </select>
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">关键字</span>
                <UInput
                  v-model="filters.keyword"
                  placeholder="搜索 deploymentCode / deploymentName"
                  icon="i-lucide-search"
                />
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">status</span>
                <select
                  v-model="filters.status"
                  class="tenant-native-field"
                >
                  <option
                    v-for="option in statusOptions"
                    :key="option.value || 'all'"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </label>
            </div>

            <div
              v-if="notice"
              class="tenant-notice"
              :data-tone="notice.type"
            >
              {{ notice.message }}
            </div>

            <div
              v-if="!hasTenantContext"
              class="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500"
            >
              先输入客户 tenantCode，再加载该租户下的运行对象。
            </div>

            <div
              v-else
              class="space-y-3"
            >
              <button
                v-for="deployment in deployments"
                :key="deployment.id"
                type="button"
                class="tenant-list-card"
                :data-active="deployment.id === selectedDeploymentId"
                @click="fillForm(deployment)"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="truncate text-sm font-semibold text-slate-900">{{ deployment.deploymentName }}</span>
                      <UBadge
                        variant="soft"
                        color="neutral"
                      >
                        {{ deployment.deploymentCode }}
                      </UBadge>
                      <UBadge
                        variant="soft"
                        color="primary"
                      >
                        {{ deployment.appCode }}
                      </UBadge>
                    </div>
                    <p class="mt-1 truncate text-sm text-slate-600">
                      {{ deployment.deploymentMode }}
                    </p>
                  </div>
                  <UBadge
                    :color="deployment.status === 'active' ? 'success' : deployment.status === 'suspended' ? 'warning' : 'neutral'"
                    variant="soft"
                  >
                    {{ deployment.status }}
                  </UBadge>
                </div>

                <dl class="mt-3 grid gap-1 text-xs text-slate-500 sm:grid-cols-2">
                  <div
                    v-if="deployment.runtimeEndpoint"
                    class="sm:col-span-2"
                  >
                    <dt class="inline font-medium text-slate-700">
                      Agent
                    </dt>
                    <dd class="ml-1 inline break-all">
                      {{ deployment.runtimeEndpoint }}
                    </dd>
                  </div>
                  <div>
                    <dt class="inline font-medium text-slate-700">
                      license
                    </dt>
                    <dd class="ml-1 inline">
                      {{ deployment.licenseStatus }}
                    </dd>
                  </div>
                  <div>
                    <dt class="inline font-medium text-slate-700">
                      heartbeat
                    </dt>
                    <dd class="ml-1 inline">
                      {{ formatDate(deployment.lastHeartbeatAt) }}
                    </dd>
                  </div>
                </dl>
              </button>

              <div
                v-if="!listPending && deployments.length === 0"
                class="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500"
              >
                当前租户下还没有部署。
              </div>
            </div>

            <div
              v-if="hasTenantContext"
              class="flex items-center justify-between gap-3 border-t border-slate-200 pt-3 text-sm text-slate-500"
            >
              <span>共 {{ pagination.total }} 条</span>
              <div class="flex items-center gap-2">
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  :disabled="pagination.page <= 1"
                  @click="pagination.page -= 1"
                >
                  上一页
                </UButton>
                <span>{{ pagination.page }} / {{ pageCount }}</span>
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  :disabled="pagination.page >= pageCount"
                  @click="pagination.page += 1"
                >
                  下一页
                </UButton>
              </div>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-xs font-semibold uppercase tracking-[0.24em] text-lime-700">
                  Editor
                </p>
                <h2 class="text-xl font-semibold text-slate-900">
                  {{ formMode === 'create' ? '新建运行对象' : '编辑运行对象' }}
                </h2>
              </div>
              <UBadge
                :color="formMode === 'create' ? 'primary' : 'warning'"
                variant="soft"
              >
                {{ formMode }}
              </UBadge>
            </div>
          </template>

          <form
            class="space-y-4"
            @submit.prevent="submitForm"
          >
            <div class="grid gap-4 md:grid-cols-2">
              <label class="tenant-field">
                <span class="tenant-field__label">tenantCode</span>
                <UInput
                  v-model="form.tenantCode"
                  :disabled="formMode === 'edit'"
                  placeholder="C000001"
                />
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">appCode</span>
                <select
                  v-model="form.appCode"
                  class="tenant-native-field"
                  :disabled="formMode === 'edit' || applicationsPending"
                >
                  <option value="">请选择应用</option>
                  <option
                    v-for="application in applications"
                    :key="application.appCode"
                    :value="application.appCode"
                  >
                    {{ application.appName }}（{{ application.appCode }}）
                  </option>
                </select>
              </label>
            </div>

            <div class="grid gap-4 md:grid-cols-2">
              <label class="tenant-field">
                <span class="tenant-field__label">deploymentCode</span>
                <UInput
                  v-model="form.deploymentCode"
                  :disabled="formMode === 'edit'"
                  placeholder="aims-prod"
                />
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">deploymentName</span>
                <UInput
                  v-model="form.deploymentName"
                  placeholder="AIMS 生产环境"
                />
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">deploymentMode</span>
                <select
                  v-model="form.deploymentMode"
                  class="tenant-native-field"
                >
                  <option
                    v-for="option in deploymentModeOptions"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </label>

              <div class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 md:col-span-2">
                <p class="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Data Runtime Agent Endpoint
                </p>
                <p class="mt-2 break-all text-sm font-semibold text-slate-900">
                  {{ selectedDeployment?.runtimeEndpoint || '租户未配置' }}
                </p>
                <p class="mt-1 text-xs text-slate-600">
                  由企业侧 Dashboard 维护，平台运维侧只查看状态。
                </p>
              </div>
            </div>

            <div class="grid gap-4 md:grid-cols-2">
              <label class="tenant-field">
                <span class="tenant-field__label">status</span>
                <select
                  v-model="form.status"
                  class="tenant-native-field"
                >
                  <option
                    v-for="option in statusOptions.slice(1)"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">licenseStatus</span>
                <select
                  v-model="form.licenseStatus"
                  class="tenant-native-field"
                >
                  <option
                    v-for="option in licenseStatusOptions"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </option>
                </select>
              </label>
            </div>

            <label class="tenant-field">
              <span class="tenant-field__label">lastHeartbeatAt</span>
              <input
                v-model="form.lastHeartbeatAt"
                type="datetime-local"
                class="tenant-native-field"
              >
            </label>

            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <p class="font-medium text-slate-900">
                当前说明
              </p>
              <p class="mt-1">
                deployment 是 runtime 控制面的稳定锚点。应用纳管后，要继续配置 deployment 才能对接 bundle、heartbeat 和 license。
              </p>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
              <div class="text-xs text-slate-500">
                <span v-if="selectedDeployment">当前选中：{{ selectedDeployment.deploymentCode }}</span>
                <span v-else>创建后会自动回填列表并切到编辑模式。</span>
              </div>

              <div class="flex items-center gap-2">
                <UButton
                  color="neutral"
                  variant="ghost"
                  type="button"
                  @click="resetForm"
                >
                  {{ formMode === 'create' ? '清空' : '切换为新建' }}
                </UButton>
                <UButton
                  color="primary"
                  type="submit"
                  :loading="formPending"
                >
                  {{ formMode === 'create' ? '创建部署' : '保存变更' }}
                </UButton>
              </div>
            </div>
          </form>
        </UCard>
      </section>
    </template>
  </UDashboardPanel>
</template>
