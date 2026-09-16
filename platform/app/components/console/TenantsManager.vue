<script setup lang="ts">
usePageTitle('客户开通台')

type TenantStatus = 'active' | 'suspended' | 'disabled'
type TenantType = 'enterprise' | 'team' | 'trial'
type AuthMode = 'oidc' | 'gitlab_oidc' | 'cas' | 'wecom'
type DeploymentMode = 'managed-control-plane' | 'self-hosted-enterprise'

interface TenantItem {
  id: number
  tenantCode: string
  tenantName: string
  displayName: string | null
  tenantType: TenantType
  primaryDomain: string | null
  status: TenantStatus
  defaultAuthMode: AuthMode
  defaultDeploymentMode: DeploymentMode
  createdAt: string
  updatedAt: string
}

interface TenantListResponse {
  items: TenantItem[]
  total: number
  page: number
  pageSize: number
}

interface TenantSummary {
  tenantId: number
  tenantCode: string
  tenantName: string
  displayName: string | null
  primaryDomain: string | null
  status: TenantStatus
  defaultAuthMode: AuthMode
  defaultDeploymentMode: DeploymentMode
  onboardingStage: string
  summary: {
    userCount: number
    subjectCount: number
    roleCount: number
    templateCount: number
    applicationCount: number
    deploymentCount: number
    licenseCount: number
  }
}

const statusOptions = [
  { value: '', label: '全部状态' },
  { value: 'active', label: '启用' },
  { value: 'suspended', label: '暂停' },
  { value: 'disabled', label: '停用' }
]

const tenantTypeOptions = [
  { value: 'enterprise', label: '企业' },
  { value: 'team', label: '团队' },
  { value: 'trial', label: '试用' }
]

const authModeOptions = [
  { value: 'oidc', label: 'OIDC' },
  { value: 'gitlab_oidc', label: 'GitLab OIDC' },
  { value: 'cas', label: 'CAS' },
  { value: 'wecom', label: '企业微信' }
]

const deploymentModeOptions = [
  { value: 'managed-control-plane', label: 'Managed Control Plane' },
  { value: 'self-hosted-enterprise', label: 'Self-Hosted Enterprise' }
]

const filters = reactive({
  keyword: '',
  status: ''
})

const pagination = reactive({
  page: 1,
  pageSize: 20,
  total: 0
})

const tenants = ref<TenantItem[]>([])
const selectedTenantId = ref<number | null>(null)
const tenantSummary = ref<TenantSummary | null>(null)
const listPending = ref(false)
const summaryPending = ref(false)
const formPending = ref(false)
const formMode = ref<'create' | 'edit'>('create')
const notice = ref<{ type: 'success' | 'error', message: string } | null>(null)

const form = reactive({
  tenantCode: '',
  tenantName: '',
  displayName: '',
  tenantType: 'enterprise' as TenantType,
  primaryDomain: '',
  status: 'active' as TenantStatus,
  defaultAuthMode: 'oidc' as AuthMode,
  defaultDeploymentMode: 'managed-control-plane' as DeploymentMode
})

const selectedTenant = computed(() => tenants.value.find(item => item.id === selectedTenantId.value) || null)
const pageCount = computed(() => Math.max(1, Math.ceil((pagination.total || 0) / pagination.pageSize)))

function resetNotice() {
  notice.value = null
}

function resetForm() {
  formMode.value = 'create'
  selectedTenantId.value = null
  tenantSummary.value = null
  form.tenantCode = ''
  form.tenantName = ''
  form.displayName = ''
  form.tenantType = 'enterprise'
  form.primaryDomain = ''
  form.status = 'active'
  form.defaultAuthMode = 'oidc'
  form.defaultDeploymentMode = 'managed-control-plane'
}

function fillForm(tenant: TenantItem) {
  formMode.value = 'edit'
  selectedTenantId.value = tenant.id
  form.tenantCode = tenant.tenantCode
  form.tenantName = tenant.tenantName
  form.displayName = tenant.displayName || ''
  form.tenantType = tenant.tenantType
  form.primaryDomain = tenant.primaryDomain || ''
  form.status = tenant.status
  form.defaultAuthMode = tenant.defaultAuthMode
  form.defaultDeploymentMode = tenant.defaultDeploymentMode
}

async function loadTenantSummary(id: number) {
  summaryPending.value = true

  try {
    const response = await platformFetchJson<{ data: TenantSummary }>(`/api/platform/ops/tenants/${id}/summary`)
    tenantSummary.value = response.data
  } catch (error) {
    notice.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '租户台账摘要加载失败'
    }
    tenantSummary.value = null
  } finally {
    summaryPending.value = false
  }
}

async function selectTenant(tenant: TenantItem) {
  fillForm(tenant)
  await loadTenantSummary(tenant.id)
}

async function loadTenants() {
  listPending.value = true
  resetNotice()

  try {
    const response = await platformFetchJson<{ success: true, data: TenantListResponse }>('/api/platform/ops/tenants', {
      query: {
        keyword: filters.keyword || undefined,
        status: filters.status || undefined,
        page: pagination.page,
        pageSize: pagination.pageSize
      }
    })

    tenants.value = response.data.items
    pagination.total = response.data.total

    if (selectedTenantId.value && !tenants.value.some(item => item.id === selectedTenantId.value)) {
      selectedTenantId.value = null
      tenantSummary.value = null
      if (formMode.value === 'edit') {
        resetForm()
      }
    }
  } catch (error) {
    notice.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '租户列表加载失败'
    }
  } finally {
    listPending.value = false
  }
}

const debouncedReload = useDebounceFn(() => {
  pagination.page = 1
  loadTenants()
}, 250)

watch(() => filters.keyword, debouncedReload)
watch(() => filters.status, () => {
  pagination.page = 1
  loadTenants()
})
watch(() => pagination.page, () => {
  loadTenants()
})

function validateForm() {
  if (!form.tenantName.trim()) {
    throw new Error('tenantName 不能为空')
  }
}

async function submitForm() {
  formPending.value = true
  resetNotice()

  try {
    validateForm()

    const payload = {
      tenantName: form.tenantName.trim(),
      displayName: form.displayName.trim() || null,
      tenantType: form.tenantType,
      primaryDomain: form.primaryDomain.trim() || null,
      status: form.status,
      defaultAuthMode: form.defaultAuthMode,
      defaultDeploymentMode: form.defaultDeploymentMode
    }

    const response = formMode.value === 'create'
      ? await platformFetchJson<{ success: true, data: TenantItem }>('/api/platform/ops/tenants', {
          method: 'POST',
          body: payload
        })
      : await platformFetchJson<{ success: true, data: TenantItem }>(`/api/platform/ops/tenants/${selectedTenantId.value}`, {
          method: 'PATCH',
          body: {
            tenantName: payload.tenantName,
            displayName: payload.displayName,
            tenantType: payload.tenantType,
            primaryDomain: payload.primaryDomain,
            status: payload.status,
            defaultAuthMode: payload.defaultAuthMode,
            defaultDeploymentMode: payload.defaultDeploymentMode
          }
        })

    notice.value = {
      type: 'success',
      message: formMode.value === 'create' ? '租户已创建。' : '租户已更新。'
    }

    await loadTenants()
    await selectTenant(response.data)
  } catch (error) {
    notice.value = {
      type: 'error',
      message: error instanceof Error ? error.message : '租户保存失败'
    }
  } finally {
    formPending.value = false
  }
}

function formatDate(value: string | null) {
  if (!value) {
    return '—'
  }

  return new Date(value).toLocaleString('zh-CN', {
    hour12: false
  })
}

onMounted(() => {
  loadTenants()
})
</script>

<template>
  <UDashboardPanel
    id="platform-tenants"
    :ui="{ body: 'gap-4 sm:p-4' }"
  >
    <template #body>
      <section class="grid gap-4 xl:grid-cols-[0.9fr_1.2fr]">
        <UCard>
          <template #header>
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
                  Customer Onboarding
                </p>
                <h1 class="text-xl font-semibold text-slate-900">
                  客户开通台
                </h1>
                <p class="mt-1 text-sm text-slate-600">
                  先确认客户主档和登录模式，再把应用选择、授权、deployment 与 release gate 串成一条开通链路。
                </p>
              </div>

              <div class="flex items-center gap-2">
                <UButton
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-refresh-cw"
                  :loading="listPending"
                  @click="loadTenants"
                >
                  刷新
                </UButton>
                <UButton
                  color="primary"
                  icon="i-lucide-plus"
                  @click="resetForm"
                >
                  新建租户
                </UButton>
              </div>
            </div>
          </template>

          <div class="space-y-4">
            <div class="grid gap-3 md:grid-cols-[1fr_180px]">
              <label class="tenant-field">
                <span class="tenant-field__label">关键字</span>
                <UInput
                  v-model="filters.keyword"
                  placeholder="搜索 tenantCode / tenantName / 域名"
                  icon="i-lucide-search"
                />
              </label>

              <label class="tenant-field">
                <span class="tenant-field__label">状态</span>
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

            <div class="space-y-3">
              <button
                v-for="tenant in tenants"
                :key="tenant.id"
                type="button"
                class="tenant-list-card"
                :data-active="tenant.id === selectedTenantId"
                @click="selectTenant(tenant)"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="truncate text-sm font-semibold text-slate-900">{{ tenant.tenantName }}</span>
                      <UBadge
                        variant="soft"
                        color="neutral"
                      >
                        {{ tenant.tenantCode }}
                      </UBadge>
                    </div>
                    <p class="mt-1 truncate text-sm text-slate-600">
                      {{ tenant.displayName || '未设置 displayName' }}
                    </p>
                  </div>

                  <UBadge
                    :color="tenant.status === 'active' ? 'success' : tenant.status === 'suspended' ? 'warning' : 'neutral'"
                    variant="soft"
                  >
                    {{ tenant.status }}
                  </UBadge>
                </div>

                <dl class="mt-3 grid gap-1 text-xs text-slate-500 sm:grid-cols-2">
                  <div>
                    <dt class="inline font-medium text-slate-700">
                      认证
                    </dt>
                    <dd class="ml-1 inline">
                      {{ tenant.defaultAuthMode }}
                    </dd>
                  </div>
                  <div>
                    <dt class="inline font-medium text-slate-700">
                      部署
                    </dt>
                    <dd class="ml-1 inline">
                      {{ tenant.defaultDeploymentMode }}
                    </dd>
                  </div>
                  <div>
                    <dt class="inline font-medium text-slate-700">
                      域名
                    </dt>
                    <dd class="ml-1 inline">
                      {{ tenant.primaryDomain || '—' }}
                    </dd>
                  </div>
                  <div>
                    <dt class="inline font-medium text-slate-700">
                      更新时间
                    </dt>
                    <dd class="ml-1 inline">
                      {{ formatDate(tenant.updatedAt) }}
                    </dd>
                  </div>
                </dl>
              </button>

              <div
                v-if="!listPending && tenants.length === 0"
                class="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500"
              >
                当前没有符合条件的租户。
              </div>
            </div>

            <div class="flex items-center justify-between gap-3 border-t border-slate-200 pt-3 text-sm text-slate-500">
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

        <div class="grid gap-4">
          <UCard>
            <template #header>
              <div class="space-y-1">
                <p class="text-xs font-semibold uppercase tracking-[0.24em] text-lime-700">
                  Onboarding Summary
                </p>
                <h2 class="text-xl font-semibold text-slate-900">
                  {{ selectedTenant?.tenantName || '客户开通概况' }}
                </h2>
              </div>
            </template>

            <div
              v-if="!selectedTenant"
              class="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500"
            >
              先从左侧选择一个客户，再查看开通阻塞点和下一步动作。
            </div>

            <div
              v-else
              class="space-y-4"
            >
              <div class="grid gap-3 md:grid-cols-4">
                <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p class="text-xs uppercase tracking-[0.2em] text-slate-500">
                    Stage
                  </p>
                  <p class="mt-2 text-lg font-semibold text-slate-900">
                    {{ tenantSummary?.onboardingStage || '—' }}
                  </p>
                </div>
                <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p class="text-xs uppercase tracking-[0.2em] text-slate-500">
                    Users
                  </p>
                  <p class="mt-2 text-lg font-semibold text-slate-900">
                    {{ tenantSummary?.summary.userCount || 0 }}
                  </p>
                </div>
                <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p class="text-xs uppercase tracking-[0.2em] text-slate-500">
                    Applications
                  </p>
                  <p class="mt-2 text-lg font-semibold text-slate-900">
                    {{ tenantSummary?.summary.applicationCount || 0 }}
                  </p>
                </div>
                <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p class="text-xs uppercase tracking-[0.2em] text-slate-500">
                    Deployments
                  </p>
                  <p class="mt-2 text-lg font-semibold text-slate-900">
                    {{ tenantSummary?.summary.deploymentCount || 0 }}
                  </p>
                </div>
              </div>

              <div class="grid gap-3 md:grid-cols-3">
                <div class="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <p class="text-sm font-medium text-slate-900">
                    身份与组织
                  </p>
                  <p class="mt-2 text-sm text-slate-600">
                    主体 {{ tenantSummary?.summary.subjectCount || 0 }} / 用户 {{ tenantSummary?.summary.userCount || 0 }}
                  </p>
                </div>
                <div class="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <p class="text-sm font-medium text-slate-900">
                    授权模型
                  </p>
                  <p class="mt-2 text-sm text-slate-600">
                    角色 {{ tenantSummary?.summary.roleCount || 0 }} / 模板 {{ tenantSummary?.summary.templateCount || 0 }}
                  </p>
                </div>
                <div class="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <p class="text-sm font-medium text-slate-900">
                    开通与运行
                  </p>
                  <p class="mt-2 text-sm text-slate-600">
                    License {{ tenantSummary?.summary.licenseCount || 0 }} / Deployment {{ tenantSummary?.summary.deploymentCount || 0 }}
                  </p>
                </div>
              </div>

              <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <p class="font-medium text-slate-900">
                  下一步建议
                </p>
                <p class="mt-1">
                  客户资料只解决“谁要开通”。应用选择、授权签发和 deployment 验收应进入开通编排页处理，
                  避免在客户主档里继续堆字段。
                </p>
              </div>
            </div>
          </UCard>

          <UCard>
            <template #header>
              <div class="flex items-start justify-between gap-3">
                <div>
                  <p class="text-xs font-semibold uppercase tracking-[0.24em] text-violet-700">
                    Profile Editor
                  </p>
                  <h2 class="text-xl font-semibold text-slate-900">
                    {{ formMode === 'create' ? '创建客户主档' : '维护客户主档' }}
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
                    :placeholder="formMode === 'create' ? '创建后自动生成，如 C000001' : ''"
                  />
                </label>

                <label class="tenant-field">
                  <span class="tenant-field__label">tenantName</span>
                  <UInput
                    v-model="form.tenantName"
                    placeholder="Acme Corporation"
                  />
                </label>
              </div>

              <div class="grid gap-4 md:grid-cols-2">
                <label class="tenant-field">
                  <span class="tenant-field__label">displayName</span>
                  <UInput
                    v-model="form.displayName"
                    placeholder="Acme"
                  />
                </label>

                <label class="tenant-field">
                  <span class="tenant-field__label">primaryDomain</span>
                  <UInput
                    v-model="form.primaryDomain"
                    placeholder="acme.example.com"
                  />
                </label>
              </div>

              <div class="grid gap-4 md:grid-cols-2">
                <label class="tenant-field">
                  <span class="tenant-field__label">tenantType</span>
                  <select
                    v-model="form.tenantType"
                    class="tenant-native-field"
                  >
                    <option
                      v-for="option in tenantTypeOptions"
                      :key="option.value"
                      :value="option.value"
                    >
                      {{ option.label }}
                    </option>
                  </select>
                </label>

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
              </div>

              <div class="grid gap-4 md:grid-cols-2">
                <label class="tenant-field">
                  <span class="tenant-field__label">defaultAuthMode</span>
                  <select
                    v-model="form.defaultAuthMode"
                    class="tenant-native-field"
                  >
                    <option
                      v-for="option in authModeOptions"
                      :key="option.value"
                      :value="option.value"
                    >
                      {{ option.label }}
                    </option>
                  </select>
                </label>

                <label class="tenant-field">
                  <span class="tenant-field__label">defaultDeploymentMode</span>
                  <select
                    v-model="form.defaultDeploymentMode"
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
              </div>

              <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                <p class="font-medium text-slate-900">
                  边界说明
                </p>
                <p class="mt-1">
                  租户创建后系统会自动按顺序分配 `tenantCode`；本页只承接客户主档、登录模式和默认部署偏好。
                  应用开通、license 和 deployment 不在这里编辑。
                </p>
              </div>

              <div class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
                <div class="text-xs text-slate-500">
                  <span v-if="selectedTenant">最后更新：{{ formatDate(selectedTenant.updatedAt) }}</span>
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
                    {{ formMode === 'create' ? '创建租户' : '保存变更' }}
                  </UButton>
                </div>
              </div>
            </form>
          </UCard>
        </div>
      </section>
    </template>
  </UDashboardPanel>
</template>
