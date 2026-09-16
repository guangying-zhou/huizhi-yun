<script setup lang="ts">
definePageMeta({
  layout: 'console'
})

usePageTitle('企业工作台')

type TenantType = 'enterprise' | 'team' | 'trial'
type AuthMode = 'oidc' | 'gitlab_oidc' | 'cas' | 'wecom'
type DeploymentMode = 'managed-control-plane' | 'self-hosted-enterprise'

interface DashboardTenantItem {
  id: number
  tenantCode: string
  tenantName: string
  displayName: string | null
  tenantType: TenantType
  primaryDomain: string | null
  industryCategory: string | null
  companySize: string | null
  province: string | null
  city: string | null
  status: string
  defaultAuthMode: AuthMode
  defaultDeploymentMode: DeploymentMode
  onboardingStage: string
  membershipStatus: string
  isOwner: boolean
  roleCodes: string[]
  joinedAt: string | null
  lastAccessedAt: string | null
  createdAt: string
  updatedAt: string
}

interface DashboardOverviewTenant {
  tenantCode: string
  tenantName: string
  displayName: string | null
  tenantType: TenantType
  primaryDomain: string | null
  industryCategory: string | null
  companySize: string | null
  province: string | null
  city: string | null
  status: string
  defaultDeploymentMode: DeploymentMode
  deploymentPublicUrl: string | null
  deploymentRootAppCode: string | null
  planCode: string | null
  planName: string | null
  subscriptionStartedAt: string | null
  subscriptionEndedAt: string | null
}

interface DashboardOverviewStats {
  enabledAppCount: number
  subscribedAppCount: number
  departmentCount: number
  userCount: number
  subscriptionRemainingDays: number | null
  nextExpiryAt: string | null
}

interface DashboardOverviewResponse {
  tenant: DashboardOverviewTenant
  stats: DashboardOverviewStats
}

interface TenantsResponse {
  data: {
    items: DashboardTenantItem[]
  }
}

interface FetchLikeError {
  data?: {
    message?: string
    statusMessage?: string
  }
  message?: string
}

const route = useRoute()
const router = useRouter()
const { currentTenantCode, setCurrentTenantCode, clearCurrentTenantCode } = useTenantContext()
const { clearAuthorizationCache, loadAuthorization } = usePlatformPermission()

const industryCategoryItems = [
  { value: 'A', label: 'A 农、林、牧、渔业' },
  { value: 'B', label: 'B 采矿业' },
  { value: 'C', label: 'C 制造业' },
  { value: 'D', label: 'D 电力、热力、燃气及水生产和供应业' },
  { value: 'E', label: 'E 建筑业' },
  { value: 'F', label: 'F 批发和零售业' },
  { value: 'G', label: 'G 交通运输、仓储和邮政业' },
  { value: 'H', label: 'H 住宿和餐饮业' },
  { value: 'I', label: 'I 信息传输、软件和信息技术服务业' },
  { value: 'J', label: 'J 金融业' },
  { value: 'K', label: 'K 房地产业' },
  { value: 'L', label: 'L 租赁和商务服务业' },
  { value: 'M', label: 'M 科学研究和技术服务业' },
  { value: 'N', label: 'N 水利、环境和公共设施管理业' },
  { value: 'O', label: 'O 居民服务、修理和其他服务业' },
  { value: 'P', label: 'P 教育' },
  { value: 'Q', label: 'Q 卫生和社会工作' },
  { value: 'R', label: 'R 文化、体育和娱乐业' },
  { value: 'S', label: 'S 公共管理、社会保障和社会组织' },
  { value: 'T', label: 'T 国际组织' }
]

const companySizeItems = [
  { value: 'micro', label: '微型（1-20人）' },
  { value: 'small', label: '小型（21-300人）' },
  { value: 'medium', label: '中型（301-1000人）' },
  { value: 'large', label: '大型（1000人以上）' }
]

const myTenants = ref<DashboardTenantItem[]>([])
const tenantsPending = ref(false)
const tenantsError = ref<string | null>(null)
const selectedTenantCode = ref(tenantCodeValue())
const overviewPending = ref(false)
const overviewError = ref<string | null>(null)
const overview = ref<DashboardOverviewResponse | null>(null)
const createOpen = ref(false)
const createPending = ref(false)
const createError = ref<string | null>(null)
const profileOpen = ref(false)
const profilePending = ref(false)
const profileError = ref<string | null>(null)

const createForm = reactive({
  tenantName: '',
  displayName: '',
  industryCategory: '',
  companySize: '',
  province: '',
  city: '',
  defaultDeploymentMode: 'managed-control-plane' as DeploymentMode
})

const profileForm = reactive({
  tenantName: '',
  displayName: '',
  primaryDomain: '',
  industryCategory: '',
  companySize: '',
  province: '',
  city: '',
  deploymentPublicUrl: ''
})

const activeTenantCode = computed(() => tenantCodeValue())
const activeTenant = computed(() => myTenants.value.find(item => item.tenantCode === activeTenantCode.value) || null)

const subscriptionRemainingDays = computed(() => overview.value?.stats.subscriptionRemainingDays ?? null)

const subscriptionAlert = computed(() => {
  const days = subscriptionRemainingDays.value
  if (days == null) return null
  if (days <= 0) {
    return { color: 'error' as const, icon: 'i-lucide-alert-triangle', title: '订阅已到期', description: '部分功能可能已停用，请尽快续订以恢复服务。' }
  }
  if (days <= 7) {
    return { color: 'error' as const, icon: 'i-lucide-alert-triangle', title: `订阅将在 ${days} 天后到期`, description: '请尽快续订，避免影响企业正常使用。' }
  }
  if (days <= 30) {
    return { color: 'warning' as const, icon: 'i-lucide-clock', title: `订阅将在 ${days} 天后到期`, description: '建议提前安排续订。' }
  }
  return null
})

const TENANT_STATUS_LABEL: Record<string, string> = {
  active: '正常',
  suspended: '已暂停',
  disabled: '已停用'
}

const ONBOARDING_STAGE_LABEL: Record<string, string> = {
  draft: '筹备中',
  provisioning: '开通中',
  awaiting_subject_sync: '等待成员同步',
  active: '已就绪',
  completed: '已就绪'
}

function tenantStatusLabel(status: string) {
  return TENANT_STATUS_LABEL[status] || status || '未知'
}

function onboardingStageLabel(stage: string) {
  return ONBOARDING_STAGE_LABEL[stage] || stage || '筹备中'
}

const healthItems = computed(() => [
  {
    title: '企业归属',
    description: myTenants.value.length ? `当前账号已加入 ${myTenants.value.length} 个企业。` : '当前账号还没有加入任何企业。',
    completed: myTenants.value.length > 0,
    action: null as null | { label: string, onClick: () => void }
  },
  {
    title: '当前企业',
    description: activeTenantCode.value ? `已进入 ${tenantDisplayName(activeTenant.value)}（${activeTenantCode.value}）。` : '尚未选择企业，请从顶部切换。',
    completed: Boolean(activeTenantCode.value),
    action: null as null | { label: string, onClick: () => void }
  },
  {
    title: '管理权限',
    description: activeTenant.value?.isOwner ? '当前账号是企业所有者。' : '当前账号具备企业管理权限。',
    completed: Boolean(activeTenantCode.value),
    action: null as null | { label: string, onClick: () => void }
  },
  {
    title: '访问域名',
    description: overview.value?.tenant.deploymentPublicUrl
      ? `企业统一访问地址：${overview.value.tenant.deploymentPublicUrl}`
      : '尚未配置统一访问地址，员工可能无法访问企业入口。',
    completed: Boolean(overview.value?.tenant.deploymentPublicUrl),
    action: (overview.value?.tenant.deploymentPublicUrl || !activeTenant.value?.isOwner)
      ? null
      : { label: '去配置', onClick: openProfile }
  }
])

const statsCards = computed(() => {
  const data = overview.value?.stats
  if (!data) {
    return [
      { label: '开通/订阅应用', value: '—' },
      { label: '部门数', value: '—' },
      { label: '员工数', value: '—' },
      { label: '订阅剩余天数', value: '—' }
    ]
  }

  return [
    { label: '开通/订阅应用', value: `${data.enabledAppCount}/${data.subscribedAppCount}` },
    { label: '部门数', value: String(data.departmentCount) },
    { label: '员工数', value: String(data.userCount) },
    { label: '订阅剩余天数', value: data.subscriptionRemainingDays == null ? '—' : String(data.subscriptionRemainingDays) }
  ]
})

function tenantCodeValue() {
  return String(toValue(currentTenantCode) || '').trim()
}

function routeTenantCode() {
  return typeof route.query.tenantCode === 'string' ? route.query.tenantCode.trim() : ''
}

function tenantDisplayName(tenant: DashboardTenantItem | null | undefined) {
  if (!tenant) return activeTenantCode.value || '未选择企业'
  return tenant.displayName || tenant.tenantName || tenant.tenantCode
}

function tenantStatusColor(status: string) {
  if (status === 'active') return 'success'
  if (status === 'suspended') return 'warning'
  if (status === 'disabled') return 'neutral'
  return 'info'
}

function extractErrorMessage(error: unknown, fallback: string) {
  const fetchError = error as FetchLikeError
  return fetchError?.data?.message || fetchError?.data?.statusMessage || fetchError?.message || fallback
}

function replaceTenantQuery(tenantCode: string) {
  router.replace({
    query: {
      ...route.query,
      tenantCode: tenantCode || undefined
    }
  })
}

function chooseTenantCode(preferredTenantCode = '') {
  const preferred = preferredTenantCode.trim()
  if (preferred && myTenants.value.some(item => item.tenantCode === preferred)) {
    return preferred
  }

  if (activeTenantCode.value && myTenants.value.some(item => item.tenantCode === activeTenantCode.value)) {
    return activeTenantCode.value
  }

  return myTenants.value[0]?.tenantCode || ''
}

function applyTenantContext(tenantCode: string) {
  const normalized = tenantCode.trim()
  selectedTenantCode.value = normalized

  if (normalized) {
    setCurrentTenantCode(normalized)
  } else {
    clearCurrentTenantCode()
  }

  clearAuthorizationCache()
  replaceTenantQuery(normalized)
  void loadAuthorization()
}

async function loadMyTenants() {
  tenantsPending.value = true
  tenantsError.value = null

  try {
    const response: TenantsResponse = await $fetch(
      '/api/platform/console/tenants'
    )
    myTenants.value = response.data.items

    const nextTenantCode = chooseTenantCode(routeTenantCode())
    if (nextTenantCode !== activeTenantCode.value || nextTenantCode !== routeTenantCode()) {
      applyTenantContext(nextTenantCode)
    } else {
      selectedTenantCode.value = nextTenantCode
    }
  } catch (error) {
    myTenants.value = []
    tenantsError.value = extractErrorMessage(error, '我的企业列表加载失败')
  } finally {
    tenantsPending.value = false
  }
}

function openCreateTenant() {
  createError.value = null
  createOpen.value = true
}

function resetCreateForm() {
  createForm.tenantName = ''
  createForm.displayName = ''
  createForm.industryCategory = ''
  createForm.companySize = ''
  createForm.province = ''
  createForm.city = ''
  createForm.defaultDeploymentMode = 'managed-control-plane'
}

function syncProfileForm() {
  const tenant = overview.value?.tenant
  const fallback = activeTenant.value

  profileForm.tenantName = tenant?.tenantName || fallback?.tenantName || ''
  profileForm.displayName = tenant?.displayName || fallback?.displayName || ''
  profileForm.primaryDomain = tenant?.primaryDomain || fallback?.primaryDomain || ''
  profileForm.industryCategory = tenant?.industryCategory || fallback?.industryCategory || ''
  profileForm.companySize = tenant?.companySize || fallback?.companySize || ''
  profileForm.province = tenant?.province || fallback?.province || ''
  profileForm.city = tenant?.city || fallback?.city || ''
  profileForm.deploymentPublicUrl = tenant?.deploymentPublicUrl || ''
}

function openProfile() {
  if (!activeTenantCode.value) return
  profileError.value = null
  syncProfileForm()
  profileOpen.value = true
}

async function submitCreateTenant() {
  if (!createForm.tenantName.trim()) {
    createError.value = '企业名称不能为空'
    return
  }

  createPending.value = true
  createError.value = null

  try {
    const response = await platformFetchJson<{ success: true, data: DashboardTenantItem }>('/api/platform/console/tenants', {
      method: 'POST',
      body: {
        tenantName: createForm.tenantName.trim(),
        displayName: createForm.displayName.trim() || null,
        tenantType: 'enterprise',
        industryCategory: createForm.industryCategory || null,
        companySize: createForm.companySize || null,
        province: createForm.province.trim() || null,
        city: createForm.city.trim() || null,
        defaultDeploymentMode: createForm.defaultDeploymentMode
      }
    })

    const createdTenant = response.data
    myTenants.value = [
      createdTenant,
      ...myTenants.value.filter(item => item.tenantCode !== createdTenant.tenantCode)
    ]
    applyTenantContext(createdTenant.tenantCode)
    resetCreateForm()
    createOpen.value = false
  } catch (error) {
    createError.value = extractErrorMessage(error, '企业创建失败')
  } finally {
    createPending.value = false
  }
}

async function submitProfile() {
  if (!activeTenantCode.value) {
    profileError.value = '请先选择企业'
    return
  }
  if (!profileForm.tenantName.trim()) {
    profileError.value = '企业名称不能为空'
    return
  }
  if (!profileForm.deploymentPublicUrl.trim()) {
    profileError.value = 'HZY_DEPLOYMENT_PUBLIC_URL 不能为空'
    return
  }

  profilePending.value = true
  profileError.value = null

  try {
    await $fetch('/api/platform/tenant-admin/profile', {
      method: 'PATCH',
      body: {
        tenantCode: activeTenantCode.value,
        tenantName: profileForm.tenantName.trim(),
        displayName: profileForm.displayName.trim() || null,
        primaryDomain: profileForm.primaryDomain.trim() || null,
        industryCategory: profileForm.industryCategory || null,
        companySize: profileForm.companySize || null,
        province: profileForm.province.trim() || null,
        city: profileForm.city.trim() || null,
        deploymentPublicUrl: profileForm.deploymentPublicUrl.trim()
      }
    })

    profileOpen.value = false
    await Promise.all([
      loadMyTenants(),
      loadOverview()
    ])
  } catch (error) {
    profileError.value = extractErrorMessage(error, '企业信息保存失败')
  } finally {
    profilePending.value = false
  }
}

async function loadOverview() {
  if (!activeTenantCode.value) {
    overview.value = null
    overviewError.value = null
    return
  }

  overviewPending.value = true
  overviewError.value = null

  try {
    const response = await platformFetchJson<{ success: true, data: DashboardOverviewResponse }>(
      '/api/platform/tenant-admin/dashboard/overview',
      {
        query: {
          tenantCode: activeTenantCode.value
        }
      }
    )
    overview.value = response.data
    syncProfileForm()
  } catch (error) {
    overview.value = null
    overviewError.value = extractErrorMessage(error, '企业概览加载失败')
  } finally {
    overviewPending.value = false
  }
}

watch(activeTenantCode, (tenantCode) => {
  selectedTenantCode.value = tenantCode
  loadOverview()
}, { immediate: true })

onMounted(() => {
  loadMyTenants()
})
</script>

<template>
  <UDashboardPanel
    id="tenant-dashboard-home"
    :ui="{ body: 'console-page' }"
  >
    <template #body>
      <section class="console-hero">
        <div class="pb-3">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div class="min-w-0">
              <h1 class="text-xl font-semibold text-highlighted">
                {{ overview?.tenant.displayName || overview?.tenant.tenantName || tenantDisplayName(activeTenant) || '企业工作台' }}
              </h1>
            </div>

            <UButton
              v-if="activeTenantCode"
              class="shrink-0 sm:ml-auto"
              color="primary"
              variant="soft"
              icon="i-lucide-building-2"
              :disabled="!activeTenant?.isOwner"
              @click="openProfile"
            >
              维护企业信息
            </UButton>
          </div>

          <div>
            <div
              v-if="activeTenantCode"
              class="mt-3 flex flex-wrap items-center gap-2"
            >
              <UBadge
                :color="overview?.tenant.deploymentPublicUrl ? 'success' : 'warning'"
                variant="soft"
              >
                {{ overview?.tenant.deploymentPublicUrl ? '租户访问 URL 已配置' : '待配置租户访问 URL' }}
              </UBadge>
            </div>
          </div>
        </div>

        <div
          v-if="myTenants.length === 0"
          class="mb-3 rounded-lg border border-dashed border-default px-3 py-4 text-sm text-muted"
        >
          <p class="font-medium text-highlighted">
            当前账号还没有企业
          </p>
          <p class="mt-1 leading-6">
            新建企业后会自动成为 owner，并切换到新企业上下文。
          </p>
          <UButton
            class="mt-3"
            color="primary"
            icon="i-lucide-plus"
            @click="openCreateTenant"
          >
            新建企业
          </UButton>
        </div>

        <div>
          <div
            v-if="!activeTenantCode"
            class="rounded-xl border border-dashed border-default px-4 py-6 text-sm text-muted"
          >
            当前账号还没有选择企业。请从上方切换企业，或新建企业后继续。
          </div>

          <div
            v-else-if="overviewError"
            class="rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-sm text-error"
          >
            {{ overviewError }}
          </div>

          <div
            v-else
            class="space-y-3"
          >
            <UAlert
              v-if="subscriptionAlert"
              :color="subscriptionAlert.color"
              variant="soft"
              :icon="subscriptionAlert.icon"
              :title="subscriptionAlert.title"
              :description="subscriptionAlert.description"
              :actions="[{ label: '查看订阅', color: subscriptionAlert.color, variant: 'solid', onClick: () => { navigateTo('/dashboard/subscription-plans') } }]"
            />
            <div class="grid gap-3 sm:grid-cols-4">
              <div class="rounded-xl border border-default bg-muted px-4 py-3">
                <p class="text-xs uppercase tracking-[0.2em] text-muted">
                  企业名称
                </p>
                <p class="mt-1 text-base font-semibold text-highlighted">
                  {{ overview?.tenant.tenantName || tenantDisplayName(activeTenant) }}
                </p>
                <p class="text-sm text-muted">
                  {{ overview?.tenant.tenantCode || activeTenantCode }}
                </p>
              </div>
              <div class="rounded-xl border border-default bg-muted px-4 py-3">
                <p class="text-xs uppercase tracking-[0.2em] text-muted">
                  订阅计划
                </p>
                <p class="mt-1 text-base font-semibold text-highlighted">
                  {{ overview?.tenant.planName || overview?.tenant.planCode || '未配置' }}
                </p>
                <p class="text-sm text-muted">
                  {{ overview?.tenant.planCode || '—' }}
                </p>
              </div>
              <div class="rounded-xl border border-default bg-muted px-4 py-3">
                <p class="text-xs uppercase tracking-[0.2em] text-muted">
                  自定义域名
                </p>
                <p class="mt-1 truncate text-base font-semibold text-highlighted">
                  {{ overview?.tenant.primaryDomain || '未配置' }}
                </p>
              </div>
              <div class="rounded-xl border border-default bg-muted px-4 py-3">
                <p class="text-xs uppercase tracking-[0.2em] text-muted">
                  统一访问URL
                </p>
                <p class="mt-1 truncate text-base font-semibold text-highlighted">
                  {{ overview?.tenant.deploymentPublicUrl || '未配置' }}
                </p>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <UBadge
                :color="tenantStatusColor(activeTenant?.status || '')"
                variant="soft"
              >
                {{ tenantStatusLabel(activeTenant?.status || '') }}
              </UBadge>
              <UBadge
                :color="activeTenant?.isOwner ? 'primary' : 'neutral'"
                variant="soft"
              >
                {{ activeTenant?.isOwner ? '企业所有者' : '成员' }}
              </UBadge>
              <UBadge
                color="neutral"
                variant="soft"
              >
                {{ onboardingStageLabel(activeTenant?.onboardingStage || '') }}
              </UBadge>
            </div>

            <div class="grid gap-3 sm:grid-cols-4">
              <div
                v-for="card in statsCards"
                :key="card.label"
                class="rounded-xl border border-default bg-muted px-4 py-3"
              >
                <p class="text-xs uppercase tracking-[0.2em] text-muted">
                  {{ card.label }}
                </p>
                <p class="mt-1 text-base font-semibold text-highlighted">
                  {{ card.value }}
                </p>
              </div>
            </div>

            <div
              v-if="overviewPending"
              class="text-xs text-muted"
            >
              正在刷新企业概览...
            </div>
          </div>
        </div>
      </section>

      <section class="console-panel">
        <div class="console-panel__header">
          <div>
            <h2 class="text-lg font-semibold text-highlighted">
              待办与提醒
            </h2>
            <p class="mt-1 text-sm text-muted">
              企业开通与配置的关键事项，未完成的请及时处理。
            </p>
          </div>
        </div>

        <div class="console-step-list mt-4">
          <div
            v-for="(item, index) in healthItems"
            :key="item.title"
            class="console-step"
            :data-complete="item.completed"
          >
            <span class="console-step__index">{{ index + 1 }}</span>
            <div class="min-w-0 flex-1">
              <h3 class="text-sm font-medium text-highlighted">
                {{ item.title }}
              </h3>
              <p class="mt-1 text-sm leading-6 text-muted">
                {{ item.description }}
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <UButton
                v-if="item.action"
                color="primary"
                variant="soft"
                size="xs"
                @click="item.action.onClick"
              >
                {{ item.action.label }}
              </UButton>
              <UBadge
                :color="item.completed ? 'success' : 'warning'"
                variant="soft"
              >
                {{ item.completed ? '已就绪' : '待处理' }}
              </UBadge>
            </div>
          </div>
        </div>
      </section>

      <UModal
        v-model:open="profileOpen"
        title="维护企业信息"
        :ui="{ content: 'max-w-3xl', footer: 'flex justify-end gap-2' }"
      >
        <template #body>
          <div class="grid gap-4 md:grid-cols-2">
            <div
              v-if="profileError"
              class="tenant-notice md:col-span-2"
              data-tone="error"
            >
              {{ profileError }}
            </div>

            <UFormField
              label="企业名称"
              required
            >
              <UInput
                v-model="profileForm.tenantName"
                class="w-full"
                placeholder="例如：汇智云科技有限公司"
              />
            </UFormField>

            <UFormField label="显示名称">
              <UInput
                v-model="profileForm.displayName"
                class="w-full"
                placeholder="例如：汇智云"
              />
            </UFormField>

            <UFormField label="租户域名 / 自定义域名">
              <UInput
                v-model="profileForm.primaryDomain"
                class="w-full"
                placeholder="例如：https://wiztek.huizhi.yun"
              />
            </UFormField>

            <UFormField
              label="统一访问 URL"
              required
            >
              <UInput
                v-model="profileForm.deploymentPublicUrl"
                class="w-full"
                placeholder="例如：https://wiztek.huizhi.yun"
              />
            </UFormField>

            <UFormField label="行业分类">
              <USelect
                v-model="profileForm.industryCategory"
                class="w-full"
                :items="industryCategoryItems"
                placeholder="选择 GB/T 4754-2017 门类"
              />
            </UFormField>

            <UFormField label="企业规模">
              <USelect
                v-model="profileForm.companySize"
                class="w-full"
                :items="companySizeItems"
                placeholder="选择企业规模"
              />
            </UFormField>

            <UFormField label="所在省">
              <UInput
                v-model="profileForm.province"
                class="w-full"
                placeholder="例如：山东省"
              />
            </UFormField>

            <UFormField label="所在市">
              <UInput
                v-model="profileForm.city"
                class="w-full"
                placeholder="例如：青岛市"
              />
            </UFormField>
          </div>
        </template>

        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              :disabled="profilePending"
              @click="profileOpen = false"
            >
              取消
            </UButton>
            <UButton
              color="primary"
              icon="i-lucide-save"
              :loading="profilePending"
              @click="submitProfile"
            >
              保存
            </UButton>
          </div>
        </template>
      </UModal>

      <UModal
        v-model:open="createOpen"
        title="新建企业"
        :ui="{ content: 'max-w-2xl', footer: 'flex justify-end gap-2' }"
      >
        <template #body>
          <div class="grid gap-4 md:grid-cols-2">
            <div
              v-if="createError"
              class="tenant-notice md:col-span-2"
              data-tone="error"
            >
              {{ createError }}
            </div>

            <UFormField
              label="企业名称"
              required
            >
              <UInput
                v-model="createForm.tenantName"
                class="w-full"
                placeholder="例如：汇智云科技有限公司"
              />
            </UFormField>

            <UFormField label="显示名称">
              <UInput
                v-model="createForm.displayName"
                class="w-full"
                placeholder="例如：汇智云"
              />
            </UFormField>

            <UFormField label="行业分类">
              <USelect
                v-model="createForm.industryCategory"
                class="w-full"
                :items="industryCategoryItems"
                placeholder="选择 GB/T 4754-2017 门类"
              />
            </UFormField>

            <UFormField label="企业规模">
              <USelect
                v-model="createForm.companySize"
                class="w-full"
                :items="companySizeItems"
                placeholder="选择企业规模"
              />
            </UFormField>

            <UFormField label="所在省">
              <UInput
                v-model="createForm.province"
                class="w-full"
                placeholder="例如：山东省"
              />
            </UFormField>

            <UFormField label="所在市">
              <UInput
                v-model="createForm.city"
                class="w-full"
                placeholder="例如：青岛市"
              />
            </UFormField>

            <!-- <UFormField
              label="默认部署模式"
            >
              <USelect
                v-model="createForm.defaultDeploymentMode"
                class="w-full"
                :items="deploymentModeItems"
              />
            </UFormField> -->
          </div>
        </template>

        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              :disabled="createPending"
              @click="createOpen = false"
            >
              取消
            </UButton>
            <UButton
              color="primary"
              icon="i-lucide-check"
              :loading="createPending"
              @click="submitCreateTenant"
            >
              创建并切换
            </UButton>
          </div>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
