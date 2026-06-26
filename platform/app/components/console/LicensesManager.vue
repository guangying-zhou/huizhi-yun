<script setup lang="ts">
usePageTitle('授权风险')

type LicenseStatus = 'active' | 'grace' | 'expired' | 'suspended' | 'disabled'
type ConsoleScope = 'admin' | 'dashboard'

interface DeploymentOption {
  id: number
  tenantCode: string
  appCode: string
  deploymentCode: string
  deploymentName: string
  deploymentMode: string
  status: string
  licenseStatus: string
}

interface LicenseItem {
  id: number
  tenantCode: string
  deploymentId: number
  appCode: string
  deploymentCode: string
  licenseCode: string
  planCode: string
  status: LicenseStatus
  issuedAt: string
  expiresAt: string | null
  graceUntil: string | null
  payloadHash: string
  capabilities?: Array<{ capabilityCode: string, capabilityValue: string | null }>
  createdAt: string
  updatedAt: string
}

interface LicenseListResponse {
  items: LicenseItem[]
  total: number
  page: number
  pageSize: number
}

const statusOptions = [
  { value: '', label: '全部状态' },
  { value: 'active', label: 'Active' },
  { value: 'grace', label: 'Grace' },
  { value: 'expired', label: 'Expired' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'disabled', label: 'Disabled' }
]

const route = useRoute()
const router = useRouter()
const runtimeConfig = useRuntimeConfig()
const { currentTenantCode } = useTenantContext()

const props = withDefaults(defineProps<{
  scope?: ConsoleScope
}>(), {
  scope: 'admin'
})

const environmentOptions = [
  { code: 'prod', label: '生产环境' },
  { code: 'test', label: '测试环境' }
]

function defaultDeploymentEnvironment() {
  const stage = String(runtimeConfig.public.platformStage || '').trim().toLowerCase()
  return ['test', 'dev', 'development', 'integration'].includes(stage) ? 'test' : 'prod'
}

const isDashboardScope = computed(() => props.scope === 'dashboard')
const apiPrefix = computed(() => isDashboardScope.value ? '/api/platform/tenant-admin' : '/api/platform/ops')

const filters = reactive({
  tenantCode: props.scope === 'dashboard'
    ? currentTenantCode.value
    : typeof route.query.tenantCode === 'string'
      ? route.query.tenantCode
      : '',
  environment: typeof route.query.environment === 'string'
    ? route.query.environment
    : props.scope === 'dashboard'
      ? defaultDeploymentEnvironment()
      : '',
  deploymentCode: '',
  status: ''
})

const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0
})

const licenses = ref<LicenseItem[]>([])
const deployments = ref<DeploymentOption[]>([])
const selectedLicenseId = ref<number | null>(null)
const listPending = ref(false)
const deploymentsPending = ref(false)
const formPending = ref(false)
const formMode = ref<'create' | 'edit'>('create')
const notice = ref<{ type: 'success' | 'error', message: string } | null>(null)

const form = reactive({
  tenantCode: filters.tenantCode,
  deploymentId: '',
  licenseCode: '',
  planCode: '',
  status: 'active' as LicenseStatus,
  issuedAt: '',
  expiresAt: '',
  graceUntil: '',
  capabilitiesJson: '[\n  {\n    "capabilityCode": "platform.max_users",\n    "capabilityValue": "50"\n  }\n]\n'
})

const pageCount = computed(() => Math.max(1, Math.ceil((pagination.total || 0) / pagination.pageSize)))
const selectedLicense = computed(() => licenses.value.find(item => item.id === selectedLicenseId.value) || null)
const hasTenantContext = computed(() => !!filters.tenantCode.trim())

function resetNotice() {
  notice.value = null
}

function syncTenantQuery() {
  if (isDashboardScope.value) {
    return
  }

  router.replace({
    query: {
      ...route.query,
      tenantCode: filters.tenantCode || undefined,
      environment: filters.environment || undefined
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
  selectedLicenseId.value = null
  form.tenantCode = filters.tenantCode
  form.deploymentId = ''
  form.licenseCode = ''
  form.planCode = ''
  form.status = 'active'
  form.issuedAt = ''
  form.expiresAt = ''
  form.graceUntil = ''
  form.capabilitiesJson = '[\n  {\n    "capabilityCode": "platform.max_users",\n    "capabilityValue": "50"\n  }\n]\n'
}

function fillForm(license: LicenseItem) {
  formMode.value = 'edit'
  selectedLicenseId.value = license.id
  form.tenantCode = license.tenantCode
  form.deploymentId = String(license.deploymentId)
  form.licenseCode = license.licenseCode
  form.planCode = license.planCode
  form.status = license.status
  form.issuedAt = toInputDateTime(license.issuedAt)
  form.expiresAt = toInputDateTime(license.expiresAt)
  form.graceUntil = toInputDateTime(license.graceUntil)
  form.capabilitiesJson = `${JSON.stringify(license.capabilities || [], null, 2)}\n`
}

async function loadLicenseDetail(id: number) {
  const response = await platformFetchJson<{ success: true, data: LicenseItem }>(`${apiPrefix.value}/licenses/${id}`)
  return response.data
}

async function selectLicense(license: LicenseItem) {
  resetNotice()

  try {
    const detail = await loadLicenseDetail(license.id)
    fillForm(detail)
  } catch (error) {
    notice.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '许可证详情加载失败'
    }
  }
}

async function loadDeployments() {
  if (!filters.tenantCode.trim()) {
    deployments.value = []
    return
  }

  deploymentsPending.value = true

  try {
    const response = await platformFetchJson<{ success: true, data: { items: DeploymentOption[] } }>(`${apiPrefix.value}/deployments`, {
      query: {
        tenantCode: filters.tenantCode.trim(),
        environment: filters.environment || undefined,
        page: 1,
        pageSize: 100
      }
    })

    deployments.value = response.data.items
  } catch {
    deployments.value = []
  } finally {
    deploymentsPending.value = false
  }
}

async function loadLicenses() {
  if (!filters.tenantCode.trim()) {
    licenses.value = []
    pagination.total = 0
    selectedLicenseId.value = null
    if (formMode.value === 'edit') {
      resetForm()
    }
    return
  }

  listPending.value = true
  resetNotice()

  try {
    const response = await platformFetchJson<{ success: true, data: LicenseListResponse }>(`${apiPrefix.value}/licenses`, {
      query: {
        tenantCode: filters.tenantCode.trim(),
        environment: filters.environment || undefined,
        deploymentCode: filters.deploymentCode || undefined,
        status: filters.status || undefined,
        page: pagination.page,
        pageSize: pagination.pageSize
      }
    })

    licenses.value = response.data.items
    pagination.total = response.data.total

    if (selectedLicenseId.value && !licenses.value.some(item => item.id === selectedLicenseId.value)) {
      selectedLicenseId.value = null
      if (formMode.value === 'edit') {
        resetForm()
      }
    }
  } catch (error) {
    notice.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '许可证列表加载失败'
    }
  } finally {
    listPending.value = false
  }
}

watch(() => filters.deploymentCode, () => {
  pagination.page = 1
  loadLicenses()
})
watch(() => filters.environment, async () => {
  pagination.page = 1
  filters.deploymentCode = ''
  resetForm()
  syncTenantQuery()
  await loadDeployments()
  await loadLicenses()
})
watch(() => filters.status, () => {
  pagination.page = 1
  loadLicenses()
})
watch(() => pagination.page, () => {
  loadLicenses()
})
watch(() => filters.tenantCode, async (value) => {
  pagination.page = 1
  form.tenantCode = formMode.value === 'create' ? value : form.tenantCode
  syncTenantQuery()
  await loadDeployments()
  await loadLicenses()
})

watch(() => currentTenantCode.value, (value) => {
  if (!isDashboardScope.value) return
  filters.tenantCode = value
})

function validateForm() {
  if (!form.tenantCode.trim()) {
    throw new Error('tenantCode 不能为空')
  }
  if (!form.deploymentId.trim()) {
    throw new Error('deploymentId 不能为空')
  }
  if (!form.licenseCode.trim()) {
    throw new Error('licenseCode 不能为空')
  }
  if (!form.planCode.trim()) {
    throw new Error('planCode 不能为空')
  }
  if (!form.issuedAt.trim()) {
    throw new Error('issuedAt 不能为空')
  }
}

async function submitForm() {
  formPending.value = true
  resetNotice()

  try {
    validateForm()

    const capabilities = JSON.parse(form.capabilitiesJson)
    if (!Array.isArray(capabilities)) {
      throw new Error('capabilities 必须是数组')
    }

    await platformFetchJson<{ success: true, data: LicenseItem }>(`${apiPrefix.value}/licenses`, {
      method: 'POST',
      body: {
        tenantCode: form.tenantCode.trim(),
        deploymentId: Number(form.deploymentId),
        licenseCode: form.licenseCode.trim(),
        planCode: form.planCode.trim(),
        status: form.status,
        issuedAt: fromInputDateTime(form.issuedAt),
        expiresAt: fromInputDateTime(form.expiresAt),
        graceUntil: fromInputDateTime(form.graceUntil),
        capabilities
      }
    })

    notice.value = {
      type: 'success',
      message: formMode.value === 'create' ? '许可证已创建。' : '许可证已更新。'
    }

    await loadLicenses()
    const latest = licenses.value.find(item => item.licenseCode === form.licenseCode.trim())
    if (latest) {
      const detail = await loadLicenseDetail(latest.id)
      fillForm(detail)
    }
  } catch (error) {
    notice.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '许可证保存失败'
    }
  } finally {
    formPending.value = false
  }
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

onMounted(async () => {
  if (filters.tenantCode) {
    await loadDeployments()
    await loadLicenses()
  }
})
</script>

<template>
  <UDashboardPanel
    id="platform-licenses"
    :ui="{ body: 'gap-4 sm:p-4' }"
  >
    <template #body>
      <section class="grid gap-4 xl:grid-cols-[0.95fr_1.15fr]">
        <UCard>
          <template #header>
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
                  Authorization Risk
                </p>
                <h1 class="text-xl font-semibold text-slate-900">
                  授权风险
                </h1>
                <p class="mt-1 text-sm text-slate-600">
                  这里是开通编排后的授权支撑页，重点处理 license、capability、到期、宽限和吊销风险。
                </p>
              </div>
              <div class="flex items-center gap-2">
                <UButton
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-refresh-cw"
                  :loading="listPending"
                  @click="loadLicenses"
                >
                  刷新
                </UButton>
                <UButton
                  color="primary"
                  icon="i-lucide-plus"
                  @click="resetForm"
                >
                  新建授权记录
                </UButton>
              </div>
            </div>
          </template>

          <div class="space-y-4">
            <div class="grid gap-3 md:grid-cols-3">
              <label
                v-if="!isDashboardScope"
                class="tenant-field md:col-span-3"
              >
                <span class="tenant-field__label">客户 / tenantCode</span>
                <UInput
                  v-model="filters.tenantCode"
                  placeholder="先输入 tenantCode，例如 C000001"
                />
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">environment</span>
                <select
                  v-model="filters.environment"
                  class="tenant-native-field"
                >
                  <option
                    v-if="!isDashboardScope"
                    value=""
                  >
                    全部环境
                  </option>
                  <option
                    v-for="environment in environmentOptions"
                    :key="environment.code"
                    :value="environment.code"
                  >
                    {{ environment.label }}
                  </option>
                </select>
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">deployment</span>
                <select
                  v-model="filters.deploymentCode"
                  class="tenant-native-field"
                >
                  <option value="">全部部署</option>
                  <option
                    v-for="deployment in deployments"
                    :key="deployment.id"
                    :value="deployment.deploymentCode"
                  >
                    {{ deployment.deploymentCode }}
                  </option>
                </select>
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
              {{ isDashboardScope ? '先在顶部选择企业，再加载该租户下的授权记录。' : '先输入客户 tenantCode，再加载该租户下的授权记录。' }}
            </div>

            <div
              v-else
              class="space-y-3"
            >
              <button
                v-for="license in licenses"
                :key="license.id"
                type="button"
                class="tenant-list-card"
                :data-active="license.id === selectedLicenseId"
                @click="selectLicense(license)"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="truncate text-sm font-semibold text-slate-900">{{ license.licenseCode }}</span>
                      <UBadge
                        variant="soft"
                        color="neutral"
                      >
                        {{ license.planCode }}
                      </UBadge>
                      <UBadge
                        variant="soft"
                        color="primary"
                      >
                        {{ license.appCode }}
                      </UBadge>
                    </div>
                    <p class="mt-1 truncate text-sm text-slate-600">
                      {{ license.deploymentCode }}
                    </p>
                  </div>
                  <UBadge
                    :color="license.status === 'active' ? 'success' : license.status === 'grace' ? 'warning' : 'neutral'"
                    variant="soft"
                  >
                    {{ license.status }}
                  </UBadge>
                </div>

                <dl class="mt-3 grid gap-1 text-xs text-slate-500 sm:grid-cols-2">
                  <div>
                    <dt class="inline font-medium text-slate-700">
                      issued
                    </dt>
                    <dd class="ml-1 inline">
                      {{ formatDate(license.issuedAt) }}
                    </dd>
                  </div>
                  <div>
                    <dt class="inline font-medium text-slate-700">
                      expires
                    </dt>
                    <dd class="ml-1 inline">
                      {{ formatDate(license.expiresAt) }}
                    </dd>
                  </div>
                </dl>
              </button>

              <div
                v-if="!listPending && licenses.length === 0"
                class="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500"
              >
                当前租户下还没有许可证。
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
                  {{ formMode === 'create' ? '新建授权记录' : '编辑授权记录' }}
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
                  :disabled="true"
                  placeholder="C000001"
                />
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">deployment</span>
                <select
                  v-model="form.deploymentId"
                  class="tenant-native-field"
                  :disabled="deploymentsPending"
                >
                  <option value="">请选择 deployment</option>
                  <option
                    v-for="deployment in deployments"
                    :key="deployment.id"
                    :value="String(deployment.id)"
                  >
                    {{ deployment.deploymentName }}（{{ deployment.appCode }} / {{ deployment.deploymentCode }}）
                  </option>
                </select>
              </label>
            </div>

            <div class="grid gap-4 md:grid-cols-2">
              <label class="tenant-field">
                <span class="tenant-field__label">licenseCode</span>
                <UInput
                  v-model="form.licenseCode"
                  :disabled="formMode === 'edit'"
                  placeholder="lic_aims_prod"
                />
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">planCode</span>
                <UInput
                  v-model="form.planCode"
                  placeholder="pro"
                />
              </label>
            </div>

            <div class="grid gap-4 md:grid-cols-3">
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
                <span class="tenant-field__label">issuedAt</span>
                <input
                  v-model="form.issuedAt"
                  type="datetime-local"
                  class="tenant-native-field"
                >
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">expiresAt</span>
                <input
                  v-model="form.expiresAt"
                  type="datetime-local"
                  class="tenant-native-field"
                >
              </label>
            </div>

            <label class="tenant-field">
              <span class="tenant-field__label">graceUntil</span>
              <input
                v-model="form.graceUntil"
                type="datetime-local"
                class="tenant-native-field"
              >
            </label>

            <label class="tenant-field">
              <span class="tenant-field__label">capabilitiesJson</span>
              <textarea
                v-model="form.capabilitiesJson"
                class="tenant-native-field min-h-72 resize-y font-mono text-xs"
                placeholder="输入 capability JSON 数组"
              />
            </label>

            <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              <p class="font-medium text-slate-900">
                当前说明
              </p>
              <p class="mt-1">
                license 目前通过 `licenseCode` 做 upsert。编辑模式下会保留原 `licenseCode`，重新提交会覆盖对应 license 与 capability。
              </p>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
              <div class="text-xs text-slate-500">
                <span v-if="selectedLicense">当前选中：{{ selectedLicense.licenseCode }}</span>
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
                  {{ formMode === 'create' ? '创建许可证' : '保存变更' }}
                </UButton>
              </div>
            </div>
          </form>
        </UCard>
      </section>
    </template>
  </UDashboardPanel>
</template>
