<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({
  layout: 'platform'
})

interface ApiEnvelope<T> {
  success: true
  data: T
}

interface PlanDetail {
  id: number
  planCode: string
  planName: string
  planTier: string
  priceModel: string
  basePrice: number | null
  currency: string | null
  billingCycle: string | null
  description: string | null
  status: string
  createdAt: string
  updatedAt: string
}

interface PlanApp {
  id: number
  appCode: string
  appName: string
  serviceRole: string
  roleInPlan: 'core' | 'business'
  pinReleaseId: number | null
  pinReleaseVersion: string | null
  latestReleaseVersion: string | null
  sortOrder: number
}

interface PlanCapability {
  id: number
  capabilityCode: string
  capabilityName: string
  capabilityType: string
  capabilityValue: string | null
  description: string | null
}

interface PlanSubscriber {
  tenantCode: string
  tenantName: string
  status: string
  startedAt: string | null
  endedAt: string | null
}

interface ApplicationItem {
  id: number
  appCode: string
  appName: string
  serviceRole: string
  status: string
}

interface ApplicationListResponse {
  items: ApplicationItem[]
  total: number
}

interface CapabilityItem {
  id: number
  capabilityCode: string
  capabilityName: string
  capabilityType: string
  description: string | null
}

interface CapabilityListResponse {
  items: CapabilityItem[]
}

interface PlanDetailResponse {
  plan: PlanDetail
  apps: PlanApp[]
  capabilities: PlanCapability[]
  subscribers: PlanSubscriber[]
}

interface SelectedApp {
  appCode: string
  appName: string
  roleInPlan: 'core' | 'business'
  pinReleaseId: number | null
  sortOrder: number
}

interface SelectedCapability {
  capabilityCode: string
  capabilityName: string
  capabilityValue: string
}

const TIER_TONE: Record<string, 'neutral' | 'info' | 'primary' | 'warning'> = {
  starter: 'neutral',
  standard: 'info',
  advanced: 'primary',
  enterprise: 'warning'
}

const TIER_LABEL: Record<string, string> = {
  starter: '基础（Starter）',
  standard: '标准（Standard）',
  advanced: '高级（Advanced）',
  enterprise: '企业（Enterprise · 全站独立部署）'
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  suspended: 'warning',
  disabled: 'neutral',
  draft: 'neutral'
}

const ROLE_TONE: Record<string, 'primary' | 'info'> = {
  core: 'primary',
  business: 'info'
}

const ROLE_LABEL: Record<string, string> = {
  core: '基础模块',
  business: '业务应用'
}

const tierItems = [
  { label: '基础 Starter', value: 'starter' },
  { label: '标准 Standard', value: 'standard' },
  { label: '高级 Advanced', value: 'advanced' },
  { label: '企业 Enterprise（全站独立部署）', value: 'enterprise' }
]

const priceModelItems = [
  { label: '固定价（fixed）', value: 'fixed' },
  { label: '按量计费（metered）', value: 'metered' },
  { label: '面议（custom）', value: 'custom' }
]

const billingCycleItems = [
  { label: '按月', value: 'monthly' },
  { label: '按年', value: 'yearly' },
  { label: '一次性', value: 'one_time' }
]

const statusItems = [
  { label: 'active', value: 'active' },
  { label: 'draft', value: 'draft' },
  { label: 'suspended', value: 'suspended' },
  { label: 'disabled', value: 'disabled' }
]

const route = useRoute()
const router = useRouter()
const toast = useToast()

const code = computed(() => String(route.params.code || ''))

const { data, pending, error, refresh } = usePlatformData<ApiEnvelope<PlanDetailResponse>>(
  () => `/api/platform/ops/plans/${encodeURIComponent(code.value)}`,
  { watch: [code] }
)

const { data: appData, refresh: refreshApps } = usePlatformData<ApiEnvelope<ApplicationListResponse>>(
  '/api/platform/ops/applications',
  { query: { pageSize: 200 } }
)

const { data: capData, refresh: refreshCaps } = usePlatformData<ApiEnvelope<CapabilityListResponse>>(
  '/api/platform/ops/capabilities'
)

await Promise.all([refresh(), refreshApps(), refreshCaps()])

const plan = computed(() => data.value?.data.plan || null)
const apps = computed<PlanApp[]>(() => data.value?.data.apps || [])
const capabilities = computed<PlanCapability[]>(() => data.value?.data.capabilities || [])
const subscribers = computed<PlanSubscriber[]>(() => data.value?.data.subscribers || [])
const allApps = computed<ApplicationItem[]>(() => appData.value?.data.items || [])
const allCaps = computed<CapabilityItem[]>(() => capData.value?.data.items || [])

usePageTitle('订阅计划')

const tab = ref<'overview' | 'apps' | 'capabilities' | 'subscribers'>('overview')
const editOpen = ref(false)
const saving = ref(false)
const newAppCode = ref('')
const newCapCode = ref('')
const editApps = ref<SelectedApp[]>([])
const editCaps = ref<SelectedCapability[]>([])

const editForm = reactive({
  planName: '',
  planTier: 'starter',
  priceModel: 'fixed',
  basePrice: '',
  currency: 'CNY',
  billingCycle: 'monthly',
  description: '',
  status: 'active'
})

const tabItems = computed(() => [
  { value: 'overview', label: '概览' },
  { value: 'apps', label: '应用清单', badge: apps.value.length },
  { value: 'capabilities', label: '能力开关', badge: capabilities.value.length },
  { value: 'subscribers', label: '订阅租户', badge: subscribers.value.length }
])

const crumbs = computed(() => [
  { label: '工作台', to: '/admin' },
  { label: '订阅计划', to: '/admin/plans' },
  { label: plan.value?.planName || code.value }
])

const appColumns: TableColumn<PlanApp>[] = [
  { accessorKey: 'app', header: '应用' },
  { accessorKey: 'roleInPlan', header: '在计划中的角色' },
  { accessorKey: 'release', header: '版本绑定' },
  { accessorKey: 'sortOrder', header: '排序', meta: { class: { th: 'text-right', td: 'text-right' } } }
]

const capabilityColumns: TableColumn<PlanCapability>[] = [
  { accessorKey: 'capability', header: '能力' },
  { accessorKey: 'capabilityType', header: '类型' },
  { accessorKey: 'capabilityValue', header: '取值' },
  { accessorKey: 'description', header: '说明' }
]

const subscriberColumns: TableColumn<PlanSubscriber>[] = [
  { accessorKey: 'tenant', header: '租户' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'startedAt', header: '生效时间' },
  { accessorKey: 'endedAt', header: '结束时间' }
]

const fetchErrorMessage = computed(() => {
  const err = error.value as { data?: { message?: string }, message?: string } | null
  return err?.data?.message || err?.message || '订阅计划加载失败'
})

const availableApps = computed<Array<{ label: string, value: string }>>(() =>
  allApps.value
    .filter(a => !editApps.value.some(s => s.appCode === a.appCode))
    .map(a => ({ label: `${a.appName} (${a.appCode})`, value: a.appCode }))
)

const availableCaps = computed<Array<{ label: string, value: string }>>(() =>
  allCaps.value
    .filter(c => !editCaps.value.some(s => s.capabilityCode === c.capabilityCode))
    .map(c => ({ label: `${c.capabilityName} (${c.capabilityCode})`, value: c.capabilityCode }))
)

function isCoreApplication(app: Pick<ApplicationItem, 'appCode' | 'serviceRole'>) {
  return ['console', 'workflow'].includes(app.appCode)
    || app.serviceRole === 'directory_runtime'
    || app.serviceRole === 'workflow_runtime'
    || app.serviceRole === 'supporting_service'
}

function openEditPlan() {
  const current = plan.value
  if (!current) return

  editForm.planName = current.planName
  editForm.planTier = current.planTier
  editForm.priceModel = current.priceModel
  editForm.basePrice = current.basePrice === null || current.basePrice === undefined ? '' : String(current.basePrice)
  editForm.currency = current.currency || 'CNY'
  editForm.billingCycle = current.billingCycle || 'monthly'
  editForm.description = current.description || ''
  editForm.status = current.status

  editApps.value = apps.value.map(app => ({
    appCode: app.appCode,
    appName: app.appName,
    roleInPlan: app.roleInPlan,
    pinReleaseId: app.pinReleaseId,
    sortOrder: app.sortOrder
  }))

  editCaps.value = capabilities.value.map(capability => ({
    capabilityCode: capability.capabilityCode,
    capabilityName: capability.capabilityName,
    capabilityValue: capability.capabilityValue || ''
  }))

  newAppCode.value = ''
  newCapCode.value = ''
  editOpen.value = true
}

function addApp() {
  if (!newAppCode.value) return

  const found = allApps.value.find(a => a.appCode === newAppCode.value)
  if (!found) return

  editApps.value.push({
    appCode: found.appCode,
    appName: found.appName,
    roleInPlan: isCoreApplication(found) ? 'core' : 'business',
    pinReleaseId: null,
    sortOrder: editApps.value.length
  })
  newAppCode.value = ''
}

function removeApp(index: number) {
  editApps.value.splice(index, 1)
}

function addCap() {
  if (!newCapCode.value) return

  const found = allCaps.value.find(c => c.capabilityCode === newCapCode.value)
  if (!found) return

  editCaps.value.push({
    capabilityCode: found.capabilityCode,
    capabilityName: found.capabilityName,
    capabilityValue: ''
  })
  newCapCode.value = ''
}

function removeCap(index: number) {
  editCaps.value.splice(index, 1)
}

async function savePlan() {
  if (!plan.value) return
  if (!editForm.planName.trim()) {
    toast.add({ title: '请填写计划名称', color: 'warning' })
    return
  }

  const basePrice = editForm.basePrice === '' ? null : Number(editForm.basePrice)
  if (basePrice !== null && !Number.isFinite(basePrice)) {
    toast.add({ title: '基础价必须是数字', color: 'warning' })
    return
  }

  saving.value = true
  try {
    await $fetch(`/api/platform/ops/plans/${encodeURIComponent(plan.value.planCode)}`, {
      method: 'PATCH',
      body: {
        planName: editForm.planName.trim(),
        planTier: editForm.planTier,
        priceModel: editForm.priceModel,
        basePrice,
        currency: editForm.currency.trim() || null,
        billingCycle: editForm.billingCycle || null,
        description: editForm.description.trim() || null,
        status: editForm.status,
        apps: editApps.value.map(app => ({
          appCode: app.appCode,
          roleInPlan: app.roleInPlan,
          pinReleaseId: app.pinReleaseId,
          sortOrder: Number(app.sortOrder || 0)
        })),
        capabilities: editCaps.value.map(capability => ({
          capabilityCode: capability.capabilityCode,
          capabilityValue: capability.capabilityValue.trim() || null
        }))
      }
    })

    await refresh()
    editOpen.value = false
    toast.add({ title: '订阅计划已更新', description: plan.value.planCode, color: 'success' })
  } catch (err) {
    const message = err instanceof Error ? err.message : '保存失败'
    const detail = (err as { data?: { message?: string } }).data?.message
    toast.add({ title: '保存失败', description: detail || message, color: 'error' })
  } finally {
    saving.value = false
  }
}

function copyCode() {
  if (!plan.value) return
  navigator.clipboard?.writeText(plan.value.planCode)
  toast.add({ title: '已复制 code', description: plan.value.planCode, color: 'success' })
}

function backToList() {
  router.push('/admin/plans')
}

function formatPrice(p: PlanDetail) {
  if (p.basePrice === null || p.basePrice === undefined) return '面议'
  const currency = p.currency || 'CNY'
  const cycle = p.billingCycle ? ` / ${p.billingCycle}` : ''
  return `${currency} ${p.basePrice.toLocaleString()}${cycle}`
}

function formatDateTime(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}
</script>

<template>
  <div>
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      :title="fetchErrorMessage"
      class="mb-4"
    >
      <template #actions>
        <UButton
          color="error"
          variant="ghost"
          size="sm"
          icon="i-lucide-refresh-cw"
          @click="() => refresh()"
        >
          重试
        </UButton>
      </template>
    </UAlert>

    <UCard
      v-else-if="pending && !plan"
    >
      <UEmpty
        icon="i-lucide-loader-circle"
        title="加载订阅计划中"
      />
    </UCard>

    <UCard v-else-if="!plan">
      <UEmpty
        icon="i-lucide-package-x"
        title="未找到订阅计划"
        description="该计划可能已被删除，或 code 不存在。"
      >
        <template #actions>
          <UButton
            color="neutral"
            variant="soft"
            icon="i-lucide-arrow-left"
            @click="backToList"
          >
            返回列表
          </UButton>
        </template>
      </UEmpty>
    </UCard>

    <template v-else>
      <UBreadcrumb
        :items="crumbs"
        class="mb-4"
      />

      <div class="entity-header">
        <div class="flex min-w-0 items-start gap-3">
          <div class="grid size-11 shrink-0 place-items-center rounded-lg bg-muted text-muted">
            <UIcon
              name="i-lucide-package"
              class="size-5"
            />
          </div>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="text-xl font-semibold text-highlighted">
                {{ plan.planName }}
              </h1>
              <UBadge
                :color="STATUS_TONE[plan.status] || 'neutral'"
                variant="soft"
                size="sm"
              >
                <template #leading>
                  <span class="size-1.5 rounded-full bg-current" />
                </template>
                {{ plan.status }}
              </UBadge>
            </div>
            <div class="mono text-dimmed text-xs mt-0.5">
              {{ plan.planCode }}
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <UBadge
                :color="TIER_TONE[plan.planTier] || 'neutral'"
                variant="soft"
                size="sm"
              >
                {{ TIER_LABEL[plan.planTier] || plan.planTier }}
              </UBadge>
              <span class="text-muted text-sm">{{ formatPrice(plan) }}</span>
              <span
                v-if="plan.description"
                class="text-muted text-sm"
              >· {{ plan.description }}</span>
            </div>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-copy"
            square
            @click="copyCode"
          />
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-arrow-left"
            @click="backToList"
          >
            返回
          </UButton>
          <UButton
            color="primary"
            variant="solid"
            icon="i-lucide-pencil"
            @click="openEditPlan"
          >
            编辑计划
          </UButton>
        </div>
      </div>

      <UTabs
        v-model="tab"
        :items="tabItems"
        :content="false"
        class="mt-6"
      />

      <div
        v-if="tab === 'overview'"
        class="mt-4 grid gap-4 lg:grid-cols-2"
      >
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-highlighted">基础信息</span>
            </div>
          </template>
          <dl class="grid grid-cols-3 gap-x-4 gap-y-3 text-sm">
            <dt class="text-muted">
              计划 Code
            </dt>
            <dd class="col-span-2 mono text-highlighted">
              {{ plan.planCode }}
            </dd>
            <dt class="text-muted">
              名称
            </dt>
            <dd class="col-span-2 text-highlighted">
              {{ plan.planName }}
            </dd>
            <dt class="text-muted">
              档位
            </dt>
            <dd class="col-span-2">
              <UBadge
                :color="TIER_TONE[plan.planTier] || 'neutral'"
                variant="soft"
                size="sm"
              >
                {{ TIER_LABEL[plan.planTier] || plan.planTier }}
              </UBadge>
            </dd>
            <dt class="text-muted">
              说明
            </dt>
            <dd class="col-span-2 text-default">
              {{ plan.description || '—' }}
            </dd>
            <dt class="text-muted">
              状态
            </dt>
            <dd class="col-span-2">
              <UBadge
                :color="STATUS_TONE[plan.status] || 'neutral'"
                variant="soft"
                size="sm"
              >
                {{ plan.status }}
              </UBadge>
            </dd>
          </dl>
        </UCard>

        <UCard>
          <template #header>
            <div class="text-sm font-medium text-highlighted">
              计费
            </div>
          </template>
          <dl class="grid grid-cols-3 gap-x-4 gap-y-3 text-sm">
            <dt class="text-muted">
              计费模式
            </dt>
            <dd class="col-span-2 text-highlighted">
              {{ plan.priceModel }}
            </dd>
            <dt class="text-muted">
              基础价
            </dt>
            <dd class="col-span-2 mono text-highlighted">
              {{ formatPrice(plan) }}
            </dd>
            <dt class="text-muted">
              结算周期
            </dt>
            <dd class="col-span-2 text-default">
              {{ plan.billingCycle || '—' }}
            </dd>
            <dt class="text-muted">
              创建于
            </dt>
            <dd class="col-span-2 text-default">
              {{ formatDateTime(plan.createdAt) }}
            </dd>
            <dt class="text-muted">
              更新于
            </dt>
            <dd class="col-span-2 text-default">
              {{ formatDateTime(plan.updatedAt) }}
            </dd>
          </dl>
        </UCard>
      </div>

      <div
        v-if="tab === 'apps'"
        class="mt-4"
      >
        <UCard
          v-if="apps.length === 0"
        >
          <UEmpty
            icon="i-lucide-app-window"
            title="未配置应用"
            description="计划至少应包含 console / account / workflow 等基础模块；编辑计划添加。"
          />
        </UCard>
        <UCard
          v-else
          :ui="{ body: 'p-0 sm:p-0' }"
        >
          <UTable
            :data="apps"
            :columns="appColumns"
            :ui="{
              th: 'text-xs font-medium uppercase tracking-[0.04em] text-muted bg-muted/40 whitespace-nowrap',
              td: 'text-sm text-muted whitespace-nowrap'
            }"
          >
            <template #app-cell="{ row }">
              <div class="flex items-center gap-2.5">
                <div class="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted">
                  <UIcon
                    name="i-lucide-app-window"
                    class="size-3.5"
                  />
                </div>
                <div>
                  <div class="font-medium text-highlighted">
                    {{ row.original.appName }}
                  </div>
                  <div class="mono text-dimmed text-xs">
                    {{ row.original.appCode }}
                  </div>
                </div>
              </div>
            </template>
            <template #roleInPlan-cell="{ row }">
              <UBadge
                :color="ROLE_TONE[row.original.roleInPlan] || 'neutral'"
                variant="soft"
                size="sm"
              >
                {{ ROLE_LABEL[row.original.roleInPlan] || row.original.roleInPlan }}
              </UBadge>
            </template>
            <template #release-cell="{ row }">
              <div
                v-if="row.original.pinReleaseVersion"
                class="flex items-center gap-2"
              >
                <UIcon
                  name="i-lucide-pin"
                  class="size-3.5 text-warning"
                />
                <span class="mono text-highlighted">{{ row.original.pinReleaseVersion }}</span>
                <span class="text-dimmed text-xs">已锁定</span>
              </div>
              <div
                v-else
                class="flex items-center gap-2"
              >
                <UIcon
                  name="i-lucide-trending-up"
                  class="size-3.5 text-success"
                />
                <span class="text-default text-sm">跟随最新</span>
                <span
                  v-if="row.original.latestReleaseVersion"
                  class="mono text-dimmed text-xs"
                >({{ row.original.latestReleaseVersion }})</span>
              </div>
            </template>
            <template #sortOrder-cell="{ row }">
              <span class="mono text-dimmed">{{ row.original.sortOrder }}</span>
            </template>
          </UTable>
        </UCard>
      </div>

      <div
        v-if="tab === 'capabilities'"
        class="mt-4"
      >
        <UCard
          v-if="capabilities.length === 0"
        >
          <UEmpty
            icon="i-lucide-toggle-right"
            title="未配置能力开关"
            description="此计划目前不签入任何能力（capability）。"
          />
        </UCard>
        <UCard
          v-else
          :ui="{ body: 'p-0 sm:p-0' }"
        >
          <UTable
            :data="capabilities"
            :columns="capabilityColumns"
            :ui="{
              th: 'text-xs font-medium uppercase tracking-[0.04em] text-muted bg-muted/40 whitespace-nowrap',
              td: 'text-sm text-muted whitespace-nowrap'
            }"
          >
            <template #capability-cell="{ row }">
              <div>
                <div class="font-medium text-highlighted">
                  {{ row.original.capabilityName }}
                </div>
                <div class="mono text-dimmed text-xs">
                  {{ row.original.capabilityCode }}
                </div>
              </div>
            </template>
            <template #capabilityType-cell="{ row }">
              <UBadge
                color="info"
                variant="soft"
                size="sm"
              >
                {{ row.original.capabilityType }}
              </UBadge>
            </template>
            <template #capabilityValue-cell="{ row }">
              <span class="mono text-default">
                {{ row.original.capabilityValue || '—' }}
              </span>
            </template>
            <template #description-cell="{ row }">
              <span class="text-muted">{{ row.original.description || '—' }}</span>
            </template>
          </UTable>
        </UCard>
      </div>

      <div
        v-if="tab === 'subscribers'"
        class="mt-4"
      >
        <UCard
          v-if="subscribers.length === 0"
        >
          <UEmpty
            icon="i-lucide-building"
            title="暂无订阅租户"
            description="还没有租户订阅此计划。"
          />
        </UCard>
        <UCard
          v-else
          :ui="{ body: 'p-0 sm:p-0' }"
        >
          <UTable
            :data="subscribers"
            :columns="subscriberColumns"
            :ui="{
              th: 'text-xs font-medium uppercase tracking-[0.04em] text-muted bg-muted/40 whitespace-nowrap',
              td: 'text-sm text-muted whitespace-nowrap'
            }"
          >
            <template #tenant-cell="{ row }">
              <div>
                <div class="font-medium text-highlighted">
                  {{ row.original.tenantName }}
                </div>
                <div class="mono text-dimmed text-xs">
                  {{ row.original.tenantCode }}
                </div>
              </div>
            </template>
            <template #status-cell="{ row }">
              <UBadge
                :color="STATUS_TONE[row.original.status] || 'neutral'"
                variant="soft"
                size="sm"
              >
                <template #leading>
                  <span class="size-1.5 rounded-full bg-current" />
                </template>
                {{ row.original.status }}
              </UBadge>
            </template>
            <template #startedAt-cell="{ row }">
              <span class="text-muted text-xs">{{ formatDateTime(row.original.startedAt) }}</span>
            </template>
            <template #endedAt-cell="{ row }">
              <span class="text-muted text-xs">{{ formatDateTime(row.original.endedAt) }}</span>
            </template>
          </UTable>
        </UCard>
      </div>

      <UModal
        v-model:open="editOpen"
        title="编辑订阅计划"
        :ui="{ content: 'max-w-4xl', body: 'max-h-[80vh] overflow-y-auto' }"
        :description="plan ? `更新 ${plan.planCode} 的基础信息、应用清单与能力开关。` : undefined"
      >
        <template #body>
          <div class="flex max-h-[72vh] flex-col gap-5 overflow-y-auto pr-1">
            <section>
              <div class="mb-3 text-sm font-medium text-highlighted">
                基础信息
              </div>
              <div class="grid gap-6 sm:grid-cols-2 ">
                <UFormField
                  label="计划名称"
                  required
                  orientation="horizontal"
                >
                  <UInput
                    v-model="editForm.planName"
                    size="sm"
                    class="w-60"
                  />
                </UFormField>
                <UFormField
                  label="状态"
                  orientation="horizontal"
                >
                  <USelect
                    v-model="editForm.status"
                    :items="statusItems"
                    size="sm"
                    class="w-60"
                  />
                </UFormField>
                <UFormField
                  label="档位"
                  orientation="horizontal"
                >
                  <USelect
                    v-model="editForm.planTier"
                    :items="tierItems"
                    size="sm"
                    class="w-60"
                  />
                </UFormField>
                <UFormField
                  label="计费模式"
                  orientation="horizontal"
                >
                  <USelect
                    v-model="editForm.priceModel"
                    :items="priceModelItems"
                    size="sm"
                    class="w-60"
                  />
                </UFormField>
                <UFormField
                  label="基础价（元）"
                  orientation="horizontal"
                >
                  <UInput
                    v-model="editForm.basePrice"
                    type="number"
                    size="sm"
                    placeholder="留空表示面议"
                    class="w-60"
                  />
                </UFormField>
                <UFormField
                  label="结算周期"
                  orientation="horizontal"
                >
                  <USelect
                    v-model="editForm.billingCycle"
                    :items="billingCycleItems"
                    size="sm"
                    class="w-60"
                  />
                </UFormField>
                <UFormField
                  label="说明"
                  class="sm:col-span-2"
                >
                  <UTextarea
                    v-model="editForm.description"
                    :rows="3"
                    class="w-full"
                  />
                </UFormField>
              </div>
            </section>

            <section>
              <div class="mb-3 flex items-center justify-between gap-3">
                <div class="text-sm font-medium text-highlighted">
                  应用清单
                  <span class="text-muted text-xs ml-2">{{ editApps.length }} 个</span>
                </div>
                <div class="flex items-center gap-2">
                  <USelect
                    v-model="newAppCode"
                    :items="availableApps"
                    placeholder="选择应用..."
                    size="sm"
                    class="w-60"
                  />
                  <UButton
                    color="neutral"
                    variant="soft"
                    size="sm"
                    icon="i-lucide-plus"
                    :disabled="!newAppCode"
                    @click="addApp"
                  >
                    添加
                  </UButton>
                </div>
              </div>

              <div
                v-if="editApps.length === 0"
                class="rounded-md border border-dashed border-default py-8 text-center text-sm text-muted"
              >
                尚未添加应用。
              </div>
              <div
                v-else
                class="flex flex-col gap-2"
              >
                <div
                  v-for="(app, index) in editApps"
                  :key="app.appCode"
                  class="flex items-center gap-3 rounded-md border border-default bg-elevated/40 px-3 py-2"
                >
                  <UIcon
                    name="i-lucide-app-window"
                    class="size-4 text-muted"
                  />
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-medium text-highlighted">
                      {{ app.appName }}
                    </div>
                    <div class="mono text-dimmed text-xs">
                      {{ app.appCode }}
                    </div>
                  </div>
                  <USelect
                    v-model="app.roleInPlan"
                    :items="[
                      { label: '基础模块', value: 'core' },
                      { label: '业务应用', value: 'business' }
                    ]"
                    size="sm"
                    class="w-28"
                  />
                  <UInput
                    v-model.number="app.sortOrder"
                    type="number"
                    size="sm"
                    class="w-20"
                  />
                  <UButton
                    color="error"
                    variant="ghost"
                    icon="i-lucide-x"
                    size="sm"
                    square
                    @click="removeApp(index)"
                  />
                </div>
              </div>
            </section>

            <section>
              <div class="mb-3 flex items-center justify-between gap-3">
                <div class="text-sm font-medium text-highlighted">
                  能力开关
                  <span class="text-muted text-xs ml-2">{{ editCaps.length }} 个</span>
                </div>
                <div class="flex items-center gap-2">
                  <USelect
                    v-model="newCapCode"
                    :items="availableCaps"
                    placeholder="选择能力..."
                    size="sm"
                    class="w-60"
                  />
                  <UButton
                    color="neutral"
                    variant="soft"
                    size="sm"
                    icon="i-lucide-plus"
                    :disabled="!newCapCode"
                    @click="addCap"
                  >
                    添加
                  </UButton>
                </div>
              </div>

              <div
                v-if="editCaps.length === 0"
                class="rounded-md border border-dashed border-default py-8 text-center text-sm text-muted"
              >
                尚未添加能力开关。
              </div>
              <div
                v-else
                class="flex flex-col gap-2"
              >
                <div
                  v-for="(capability, index) in editCaps"
                  :key="capability.capabilityCode"
                  class="flex items-center gap-3 rounded-md border border-default bg-elevated/40 px-3 py-2"
                >
                  <UIcon
                    name="i-lucide-toggle-right"
                    class="size-4 text-muted"
                  />
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-medium text-highlighted">
                      {{ capability.capabilityName }}
                    </div>
                    <div class="mono text-dimmed text-xs">
                      {{ capability.capabilityCode }}
                    </div>
                  </div>
                  <UInput
                    v-model="capability.capabilityValue"
                    size="sm"
                    class="w-48"
                    placeholder="可选取值"
                  />
                  <UButton
                    color="error"
                    variant="ghost"
                    icon="i-lucide-x"
                    size="sm"
                    square
                    @click="removeCap(index)"
                  />
                </div>
              </div>
            </section>
          </div>
        </template>

        <template #footer="{ close }">
          <div class="flex w-full justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              :disabled="saving"
              @click="close"
            >
              取消
            </UButton>
            <UButton
              color="primary"
              icon="i-lucide-save"
              :loading="saving"
              @click="savePlan"
            >
              保存
            </UButton>
          </div>
        </template>
      </UModal>
    </template>
  </div>
</template>

<style scoped>
.entity-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--ui-border);
}
</style>
