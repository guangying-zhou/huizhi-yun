<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { formatDateTime } from '~/utils/opsConsole'

definePageMeta({
  layout: 'platform'
})

usePageTitle('租户管理')

interface ApiEnvelope<T> {
  success: true
  data: T
}

type TenantStatus = 'active' | 'pending' | 'suspended' | 'disabled' | 'terminated'

interface TenantItem {
  id: number
  tenantCode: string
  tenantName: string
  displayName: string | null
  tenantType: string
  primaryDomain: string | null
  status: TenantStatus
  defaultAuthMode: string
  defaultDeploymentMode: string
  onboardingStage: string | null
  planCode: string | null
  subscriptionStatus: string | null
  subscriptionStartedAt: string | null
  subscriptionEndedAt: string | null
  applicationCount: number
  memberCount: number
  deploymentCount: number
  healthyDeploymentCount: number
  warningCount: number
  lastActivityAt: string | null
  createdAt: string
  updatedAt: string
}

interface TenantListResponse {
  items: TenantItem[]
  total: number
  page: number
  pageSize: number
}

interface FetchLikeError extends Error {
  data?: {
    message?: string
    statusMessage?: string
  }
}

const STATUS_TONE: Record<string, 'success' | 'info' | 'warning' | 'error' | 'neutral'> = {
  active: 'success',
  pending: 'info',
  suspended: 'warning',
  terminated: 'error',
  disabled: 'neutral'
}

const router = useRouter()
const toast = useToast()

const q = ref('')
const status = ref<string>('all')
const planCode = ref<string>('all')
const page = ref(1)
const pageSize = 20
const createOpen = ref(false)
const createPending = ref(false)

const filtersStatusItems = [
  { label: '状态：全部', value: 'all' },
  { label: 'active', value: 'active' },
  { label: 'pending', value: 'pending' },
  { label: 'suspended', value: 'suspended' },
  { label: 'disabled', value: 'disabled' }
]

const basePlanItems = [
  { label: '计划：全部', value: 'all' },
  { label: 'Starter', value: 'starter' },
  { label: 'Pro', value: 'pro' },
  { label: 'Advanced', value: 'advanced' }
]

const columns: TableColumn<TenantItem>[] = [
  { id: 'tenant', header: '租户' },
  { id: 'status', header: '状态' },
  { id: 'plan', header: '计划' },
  { accessorKey: 'onboardingStage', header: '开通' },
  { accessorKey: 'applicationCount', header: '应用', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'memberCount', header: '成员', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { id: 'lastActivity', header: '最近活跃' },
  { id: 'actions', header: '', meta: { class: { th: 'w-10', td: 'w-10 text-right' } } }
]

const listQuery = computed(() => ({
  keyword: q.value || undefined,
  status: status.value === 'all' ? undefined : status.value,
  planCode: planCode.value === 'all' ? undefined : planCode.value,
  page: page.value,
  pageSize
}))

const { data, pending, refresh } = usePlatformData<ApiEnvelope<TenantListResponse>>('/api/platform/ops/tenants', {
  query: () => listQuery.value,
  watch: [listQuery]
})

await refresh()

const rows = computed<TenantItem[]>(() => (data.value?.data.items || []) as TenantItem[])
const total = computed(() => data.value?.data.total || 0)
const dynamicPlanItems = computed(() => {
  const set = new Set<string>()
  for (const row of rows.value) {
    if (row.planCode) {
      set.add(row.planCode)
    }
  }

  const dynamic = Array.from(set)
    .filter(code => !basePlanItems.some(item => item.value === code))
    .sort()
    .map(code => ({ label: code, value: code }))

  return [...basePlanItems, ...dynamic]
})

const stats = computed(() => {
  const items = rows.value
  return {
    active: items.filter(item => item.status === 'active').length,
    pending: items.filter(item => item.status === 'pending').length,
    suspended: items.filter(item => item.status === 'suspended').length,
    memberCount: items.reduce((sum, item) => sum + Number(item.memberCount || 0), 0)
  }
})

watch([q, status, planCode], () => {
  page.value = 1
})

function go(code: string) {
  router.push(`/admin/tenants/${encodeURIComponent(code)}`)
}

function selectRow(_event: Event, row: { original: TenantItem }) {
  go(row.original.tenantCode)
}

function onboardingTone(stage: string | null) {
  if (!stage || stage === 'active') {
    return 'success'
  }
  if (stage === 'draft') {
    return 'neutral'
  }
  return 'warning'
}

function rowMenuItems(tenant: TenantItem) {
  return [[
    {
      label: '打开详情',
      icon: 'i-lucide-panel-right-open',
      onSelect: () => go(tenant.tenantCode)
    },
    {
      label: '复制 tenantCode',
      icon: 'i-lucide-copy',
      onSelect: () => navigator.clipboard?.writeText(tenant.tenantCode)
    }
  ]]
}

function clearFilters() {
  q.value = ''
  status.value = 'all'
  planCode.value = 'all'
  page.value = 1
}

function exportCsv() {
  if (!import.meta.client || rows.value.length === 0) {
    return
  }

  const header = ['tenantCode', 'tenantName', 'status', 'planCode', 'onboardingStage', 'applicationCount', 'memberCount', 'lastActivityAt']
  const csv = [
    header.join(','),
    ...rows.value.map(item => ([
      item.tenantCode,
      `"${(item.tenantName || '').replace(/"/g, '""')}"`,
      item.status,
      item.planCode || '',
      item.onboardingStage || '',
      item.applicationCount,
      item.memberCount,
      item.lastActivityAt || ''
    ].join(',')))
  ].join('\n')

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `tenants-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

const createForm = reactive({
  tenantName: '',
  displayName: '',
  tenantType: 'enterprise',
  primaryDomain: '',
  status: 'active',
  defaultAuthMode: 'oidc',
  defaultDeploymentMode: 'managed-control-plane'
})

const tenantTypeItems = [
  { label: 'enterprise', value: 'enterprise' },
  { label: 'team', value: 'team' },
  { label: 'trial', value: 'trial' }
]

const authModeItems = [
  { label: 'oidc', value: 'oidc' },
  { label: 'gitlab_oidc', value: 'gitlab_oidc' },
  { label: 'cas', value: 'cas' },
  { label: 'wecom', value: 'wecom' }
]

const deploymentModeItems = [
  { label: 'managed-control-plane', value: 'managed-control-plane' },
  { label: 'self-hosted-enterprise', value: 'self-hosted-enterprise' }
]

function resetCreateForm() {
  createForm.tenantName = ''
  createForm.displayName = ''
  createForm.tenantType = 'enterprise'
  createForm.primaryDomain = ''
  createForm.status = 'active'
  createForm.defaultAuthMode = 'oidc'
  createForm.defaultDeploymentMode = 'managed-control-plane'
}

function createErrorMessage(error: unknown) {
  const fetchError = error as FetchLikeError
  return fetchError.data?.message || fetchError.data?.statusMessage || fetchError.message || '租户创建失败'
}

async function submitCreateTenant() {
  createPending.value = true
  try {
    if (!createForm.tenantName.trim()) {
      throw new Error('tenantName 不能为空')
    }

    const response = await platformFetchJson<ApiEnvelope<TenantItem>>('/api/platform/ops/tenants', {
      method: 'POST',
      body: {
        tenantName: createForm.tenantName.trim(),
        displayName: createForm.displayName.trim() || null,
        tenantType: createForm.tenantType,
        primaryDomain: createForm.primaryDomain.trim() || null,
        status: createForm.status,
        defaultAuthMode: createForm.defaultAuthMode,
        defaultDeploymentMode: createForm.defaultDeploymentMode
      }
    })

    toast.add({
      title: '租户已创建',
      description: `${response.data.tenantName} (${response.data.tenantCode})`,
      color: 'success'
    })

    createOpen.value = false
    resetCreateForm()
    await refresh()
    await go(response.data.tenantCode)
  } catch (error) {
    toast.add({
      title: '创建失败',
      description: createErrorMessage(error),
      color: 'error'
    })
  } finally {
    createPending.value = false
  }
}
</script>

<template>
  <div>
    <div class="page-h">
      <div>
        <h1>租户</h1>
        <p>平台所有企业租户。从这里查看订阅状态、部署健康，并下钻到单租户运营详情。</p>
      </div>
      <div class="page-h-actions">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-file-down"
          @click="exportCsv"
        >
          导出 CSV
        </UButton>
        <UButton
          color="primary"
          variant="solid"
          icon="i-lucide-plus"
          @click="createOpen = true"
        >
          新建租户
        </UButton>
      </div>
    </div>

    <div class="grid gap-3 md:grid-cols-4 mb-4">
      <UCard>
        <p class="text-xs uppercase tracking-[0.2em] text-muted">
          活跃
        </p>
        <p class="mt-2 text-lg font-semibold text-highlighted">
          {{ stats.active }}
        </p>
      </UCard>
      <UCard>
        <p class="text-xs uppercase tracking-[0.2em] text-muted">
          开通中
        </p>
        <p class="mt-2 text-lg font-semibold text-highlighted">
          {{ stats.pending }}
        </p>
      </UCard>
      <UCard>
        <p class="text-xs uppercase tracking-[0.2em] text-muted">
          已暂停
        </p>
        <p class="mt-2 text-lg font-semibold text-highlighted">
          {{ stats.suspended }}
        </p>
      </UCard>
      <UCard>
        <p class="text-xs uppercase tracking-[0.2em] text-muted">
          总成员
        </p>
        <p class="mt-2 text-lg font-semibold text-highlighted">
          {{ stats.memberCount }}
        </p>
      </UCard>
    </div>

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="toolbar">
        <UInput
          v-model="q"
          icon="i-lucide-search"
          placeholder="搜索租户名 / code..."
          size="sm"
          class="w-full max-w-[280px]"
        />
        <USelect
          v-model="status"
          :items="filtersStatusItems"
          size="sm"
          class="w-40"
        />
        <USelect
          v-model="planCode"
          :items="dynamicPlanItems"
          size="sm"
          class="w-40"
        />
        <span class="grow" />
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-x"
          @click="clearFilters"
        >
          清空筛选
        </UButton>
        <span class="mono text-muted text-xs">
          {{ rows.length }} / {{ total }}
        </span>
      </div>

      <UEmpty
        v-if="rows.length === 0"
        icon="i-lucide-search"
        title="无匹配租户"
        description="尝试调整筛选条件，或清空搜索。"
        class="py-14"
      >
        <template #actions>
          <UButton
            size="sm"
            @click="clearFilters"
          >
            清空筛选
          </UButton>
        </template>
      </UEmpty>

      <UTable
        v-else
        :data="rows"
        :columns="columns"
        :on-select="selectRow"
        :ui="{
          root: 'overflow-x-auto',
          th: 'text-xs font-medium uppercase tracking-[0.04em] text-muted bg-muted/40 whitespace-nowrap',
          td: 'text-sm text-muted whitespace-nowrap',
          tr: 'cursor-pointer'
        }"
      >
        <template #tenant-cell="{ row }">
          <div class="min-w-0">
            <div class="font-medium text-highlighted">
              {{ row.original.tenantName }}
            </div>
            <div class="mono text-dimmed text-xs">
              {{ row.original.tenantCode }}
            </div>
          </div>
        </template>

        <template #status-cell="{ row }">
          <div class="flex items-center gap-2">
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
            <UBadge
              v-if="row.original.warningCount > 0"
              color="warning"
              variant="soft"
              size="sm"
            >
              {{ row.original.warningCount }} 告警
            </UBadge>
          </div>
        </template>

        <template #plan-cell="{ row }">
          <span class="mono text-highlighted">{{ row.original.planCode || '—' }}</span>
        </template>

        <template #onboardingStage-cell="{ row }">
          <UBadge
            :color="onboardingTone(row.original.onboardingStage)"
            variant="soft"
            size="sm"
          >
            {{ row.original.onboardingStage || '—' }}
          </UBadge>
        </template>

        <template #applicationCount-cell="{ row }">
          <span class="mono text-highlighted">{{ row.original.applicationCount }}</span>
        </template>

        <template #memberCount-cell="{ row }">
          <span class="mono text-highlighted">{{ row.original.memberCount }}</span>
        </template>

        <template #lastActivity-cell="{ row }">
          <span class="text-muted">{{ formatDateTime(row.original.lastActivityAt || row.original.updatedAt) }}</span>
        </template>

        <template #actions-cell="{ row }">
          <UDropdownMenu :items="rowMenuItems(row.original)">
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-ellipsis"
              size="sm"
              square
              :loading="pending"
              @click.stop
            />
          </UDropdownMenu>
        </template>
      </UTable>

      <div
        v-if="rows.length > 0"
        class="tbl-foot"
      >
        <span>共 <b class="text-highlighted font-semibold">{{ total }}</b> 条</span>
        <UPagination
          v-model:page="page"
          :total="total"
          :items-per-page="pageSize"
          size="sm"
          variant="ghost"
          color="neutral"
          :show-edges="false"
        />
      </div>
    </UCard>

    <UModal
      v-model:open="createOpen"
      title="新建租户"
      description="创建租户主档并初始化基础角色。"
      :ui="{ content: 'max-w-2xl' }"
    >
      <template #body>
        <div class="grid gap-4 md:grid-cols-2">
          <UFormField
            label="tenantName"
            required
            class="md:col-span-2"
          >
            <UInput
              v-model="createForm.tenantName"
              placeholder="Acme Corporation"
            />
          </UFormField>

          <UFormField label="displayName">
            <UInput
              v-model="createForm.displayName"
              placeholder="Acme"
            />
          </UFormField>

          <UFormField label="primaryDomain">
            <UInput
              v-model="createForm.primaryDomain"
              placeholder="acme.example.com"
            />
          </UFormField>

          <UFormField label="tenantType">
            <USelect
              v-model="createForm.tenantType"
              :items="tenantTypeItems"
            />
          </UFormField>

          <UFormField label="status">
            <USelect
              v-model="createForm.status"
              :items="filtersStatusItems.filter(item => item.value !== 'all')"
            />
          </UFormField>

          <UFormField label="defaultAuthMode">
            <USelect
              v-model="createForm.defaultAuthMode"
              :items="authModeItems"
            />
          </UFormField>

          <UFormField label="defaultDeploymentMode">
            <USelect
              v-model="createForm.defaultDeploymentMode"
              :items="deploymentModeItems"
            />
          </UFormField>
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
            创建租户
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
