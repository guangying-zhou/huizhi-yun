<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { formatDateTime } from '~/utils/opsConsole'

definePageMeta({
  layout: 'platform'
})

interface ApiEnvelope<T> {
  success: true
  data: T
}

interface TenantDetail {
  id: number
  tenantCode: string
  tenantName: string
  displayName: string | null
  tenantType: string
  primaryDomain: string | null
  status: string
  defaultAuthMode: string
  defaultDeploymentMode: string
  onboardingStage: string | null
  planCode: string | null
  subscriptionStatus: string | null
  subscriptionStartedAt: string | null
  subscriptionEndedAt: string | null
  lastActivityAt: string | null
  createdAt: string
  updatedAt: string
}

interface TenantSummary {
  userCount: number
  subjectCount: number
  memberCount: number
  roleCount: number
  templateCount: number
  applicationCount: number
  deploymentCount: number
  healthyDeploymentCount: number
  warningCount: number
  licenseCount: number
}

interface TenantDetailResponse {
  tenant: TenantDetail
  summary: TenantSummary
}

interface SubscriptionItem {
  application: {
    id: number
    appCode: string
    appName: string
    icon: string | null
    appType: string
    runtimeMode: string
    authMode: string
    status: string
  }
  stage: {
    key: string
    label: string
    tone: 'neutral' | 'info' | 'warning' | 'error' | 'success'
  }
  deployment: {
    id: number
    deploymentCode: string
    deploymentName: string
    deploymentMode: string
    status: string
    connectivityStatus: string
    versionStatus: string
    lastHeartbeatAt: string | null
  } | null
  license: {
    id: number
    licenseCode: string
    status: string
    expiresAt: string | null
    graceUntil: string | null
  } | null
  manifest: {
    manifestSeq: number
    createdAt: string
  } | null
}

interface DeploymentItem {
  id: number
  tenantCode: string
  appCode: string
  deploymentCode: string
  deploymentName: string
  deploymentMode: string
  environment: string
  region: string | null
  status: string
  licenseStatus: string
  connectivityStatus: string
  versionStatus: string
  reportedAppVersion: string | null
  lastHeartbeatAt: string | null
}

interface UserItem {
  id: number
  tenantCode: string
  uid: string
  username: string | null
  displayName: string
  status: string
  sourceType: string
  lastLoginAt: string | null
  createdAt: string
}

interface AuditItem {
  id: number
  tenantCode: string
  operatorUid: string | null
  action: string
  targetType: string | null
  targetId: string | null
  source: string | null
  ip: string | null
  createdAt: string
  tone: 'neutral' | 'info' | 'warning' | 'error' | 'success'
}

interface Paged<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

const STATUS_TONE: Record<string, 'success' | 'info' | 'warning' | 'error' | 'neutral'> = {
  active: 'success',
  pending: 'info',
  suspended: 'warning',
  terminated: 'error',
  disabled: 'neutral'
}

const route = useRoute()
const code = computed(() => String(route.params.code || ''))
const tab = ref<'overview' | 'subscription' | 'deployments' | 'members' | 'audit'>('overview')
const auditQuery = ref('')

const { data: detailData, pending: detailPending, error: detailError, refresh: refreshDetail } = usePlatformData<ApiEnvelope<TenantDetailResponse>>(
  () => `/api/platform/ops/tenants/${encodeURIComponent(code.value)}/detail`,
  { watch: [code] }
)

const { data: subscriptionData, pending: subscriptionPending, refresh: refreshSubscriptions } = usePlatformData<ApiEnvelope<Paged<SubscriptionItem>>>(
  '/api/platform/ops/subscriptions',
  {
    query: () => ({
      tenantCode: code.value,
      page: 1,
      pageSize: 100
    }),
    watch: [code]
  }
)

const { data: deploymentData, pending: deploymentsPending, refresh: refreshDeployments } = usePlatformData<ApiEnvelope<Paged<DeploymentItem>>>(
  '/api/platform/ops/deployments',
  {
    query: () => ({
      tenantCode: code.value,
      page: 1,
      pageSize: 100
    }),
    watch: [code]
  }
)

const { data: memberData, pending: membersPending, refresh: refreshMembers } = usePlatformData<ApiEnvelope<Paged<UserItem>>>(
  '/api/platform/ops/users',
  {
    query: () => ({
      tenantCode: code.value,
      page: 1,
      pageSize: 100
    }),
    watch: [code]
  }
)

const { data: auditData, pending: auditsPending, refresh: refreshAudits } = usePlatformData<ApiEnvelope<Paged<AuditItem>>>(
  () => `/api/platform/ops/tenants/${encodeURIComponent(code.value)}/audits`,
  {
    query: () => ({
      keyword: auditQuery.value || undefined,
      page: 1,
      pageSize: 100
    }),
    watch: [code, auditQuery]
  }
)

await Promise.all([
  refreshDetail(),
  refreshSubscriptions(),
  refreshDeployments(),
  refreshMembers(),
  refreshAudits()
])

const tenant = computed<TenantDetail | null>(() => detailData.value?.data.tenant || null)
const summary = computed<TenantSummary | null>(() => detailData.value?.data.summary || null)
const subscriptions = computed<SubscriptionItem[]>(() => (subscriptionData.value?.data.items || []) as SubscriptionItem[])
const deployments = computed<DeploymentItem[]>(() => (deploymentData.value?.data.items || []) as DeploymentItem[])
const members = computed<UserItem[]>(() => (memberData.value?.data.items || []) as UserItem[])
const audits = computed<AuditItem[]>(() => (auditData.value?.data.items || []) as AuditItem[])
const recentAudits = computed<AuditItem[]>(() => audits.value.slice(0, 5))

useHead({
  title: () => tenant.value ? `${tenant.value.tenantName} · 租户 - 汇智云平台` : '租户详情 - 汇智云平台'
})

const tabItems = computed(() => [
  { value: 'overview', label: 'Overview' },
  { value: 'subscription', label: 'Subscription', badge: subscriptions.value.length },
  { value: 'deployments', label: 'Deployments', badge: deployments.value.length },
  { value: 'members', label: 'Members', badge: members.value.length },
  { value: 'audit', label: 'Audit' }
])

const crumbs = computed(() => [
  { label: '工作台', to: '/admin' },
  { label: '租户', to: '/admin/tenants' },
  { label: tenant.value?.tenantName || code.value }
])

const subscriptionColumns: TableColumn<SubscriptionItem>[] = [
  { id: 'application', header: '应用' },
  { id: 'stage', header: '状态' },
  { id: 'deployment', header: 'Deployment' },
  { id: 'license', header: 'License' },
  { id: 'manifest', header: 'Manifest' }
]

const deploymentColumns: TableColumn<DeploymentItem>[] = [
  { accessorKey: 'deploymentCode', header: 'Deployment' },
  { accessorKey: 'appCode', header: '应用' },
  { accessorKey: 'environment', header: '环境' },
  { accessorKey: 'reportedAppVersion', header: '版本' },
  { accessorKey: 'status', header: '状态' },
  { id: 'health', header: '健康' },
  { id: 'heartbeat', header: 'Heartbeat' }
]

const memberColumns: TableColumn<UserItem>[] = [
  { id: 'member', header: '成员' },
  { accessorKey: 'sourceType', header: '来源' },
  { accessorKey: 'status', header: '状态' },
  { id: 'lastLogin', header: '最近登录' }
]

const auditColumns: TableColumn<AuditItem>[] = [
  { id: 'time', header: '时间' },
  { accessorKey: 'operatorUid', header: 'Actor' },
  { accessorKey: 'action', header: 'Action' },
  { id: 'target', header: 'Target' },
  { accessorKey: 'ip', header: 'IP' }
]

function goTab(value: string | number) {
  tab.value = String(value) as typeof tab.value
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

function toneByHealth(item: DeploymentItem) {
  if (item.status !== 'active') {
    return 'warning'
  }
  if (item.connectivityStatus === 'passed' && item.versionStatus !== 'drifted' && item.versionStatus !== 'incompatible') {
    return 'success'
  }
  return 'warning'
}

async function refreshAll(showToast = true) {
  await Promise.all([
    refreshDetail(),
    refreshSubscriptions(),
    refreshDeployments(),
    refreshMembers(),
    refreshAudits()
  ])

  if (showToast) {
    useToast().add({ title: '租户数据已刷新', color: 'success' })
  }
}

function openTenantConsole() {
  if (!tenant.value?.primaryDomain) {
    useToast().add({ title: '未配置 primaryDomain', color: 'warning' })
    return
  }

  const url = tenant.value.primaryDomain.startsWith('http')
    ? tenant.value.primaryDomain
    : `https://${tenant.value.primaryDomain}`
  window.open(url, '_blank', 'noopener,noreferrer')
}
</script>

<template>
  <div v-if="tenant">
    <UBreadcrumb
      :items="crumbs"
      class="mb-3.5"
    />

    <UCard :ui="{ body: 'p-5 sm:p-5' }">
      <div class="entity-h-row">
        <div class="entity-icon">
          <UIcon
            name="i-lucide-building-2"
            class="size-6"
          />
        </div>
        <div class="entity-h-main">
          <div class="entity-h-title">
            <h1>{{ tenant.tenantName }}</h1>
            <UBadge
              :color="STATUS_TONE[tenant.status] || 'neutral'"
              variant="soft"
              size="sm"
            >
              <template #leading>
                <span class="size-1.5 rounded-full bg-current" />
              </template>
              {{ tenant.status }}
            </UBadge>
            <UBadge
              :color="onboardingTone(tenant.onboardingStage)"
              variant="soft"
              size="sm"
            >
              {{ tenant.onboardingStage || '—' }}
            </UBadge>
          </div>
          <div class="entity-h-meta">
            <span class="code-chip">{{ tenant.tenantCode }}</span>
            <span class="dot">·</span>
            <span>{{ tenant.planCode || '未分配计划' }}</span>
            <span class="dot">·</span>
            <span>{{ tenant.primaryDomain || '未设置域名' }}</span>
            <span class="dot">·</span>
            <span>{{ summary?.applicationCount || 0 }} 个应用</span>
            <span class="dot">·</span>
            <span>创建于 {{ formatDateTime(tenant.createdAt) }}</span>
          </div>
        </div>
        <div class="entity-h-actions">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-external-link"
            title="进入租户控制台"
            square
            @click="openTenantConsole"
          />
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-refresh-cw"
            :loading="detailPending || subscriptionPending || deploymentsPending || membersPending || auditsPending"
            square
            @click="() => refreshAll()"
          />
          <UButton
            color="primary"
            icon="i-lucide-arrow-left"
            to="/admin/tenants"
          >
            返回租户列表
          </UButton>
        </div>
      </div>
    </UCard>

    <UTabs
      :items="tabItems"
      :model-value="tab"
      variant="link"
      color="neutral"
      :content="false"
      class="mt-4"
      @update:model-value="goTab"
    />

    <div
      v-if="tab === 'overview'"
      class="grid gap-4 mt-4 xl:grid-cols-[1.6fr_1fr]"
    >
      <div class="col gap-4">
        <UCard>
          <template #header>
            <div class="font-medium text-highlighted">
              组织信息
            </div>
          </template>
          <dl class="grid gap-x-4 gap-y-2 sm:grid-cols-[140px_1fr] text-sm">
            <dt class="text-muted">
              显示名
            </dt>
            <dd class="text-default">
              {{ tenant.displayName || tenant.tenantName }}
            </dd>
            <dt class="text-muted">
              租户 Code
            </dt>
            <dd>
              <span class="code-chip">{{ tenant.tenantCode }}</span>
            </dd>
            <dt class="text-muted">
              主域名
            </dt>
            <dd class="mono">
              {{ tenant.primaryDomain || '—' }}
            </dd>
            <dt class="text-muted">
              默认登录
            </dt>
            <dd>
              {{ tenant.defaultAuthMode }}
            </dd>
            <dt class="text-muted">
              默认部署
            </dt>
            <dd>
              {{ tenant.defaultDeploymentMode }}
            </dd>
            <dt class="text-muted">
              类型
            </dt>
            <dd>
              {{ tenant.tenantType }}
            </dd>
            <dt class="text-muted">
              最近活跃
            </dt>
            <dd>
              {{ formatDateTime(tenant.lastActivityAt || tenant.updatedAt) }}
            </dd>
            <dt class="text-muted">
              创建于
            </dt>
            <dd>
              {{ formatDateTime(tenant.createdAt) }}
            </dd>
          </dl>
        </UCard>

        <UCard>
          <template #header>
            <div class="font-medium text-highlighted">
              最近事件
            </div>
          </template>
          <UEmpty
            v-if="recentAudits.length === 0"
            icon="i-lucide-clock-3"
            title="暂无事件"
            description="当前租户还没有审计事件。"
          />
          <div
            v-else
            class="col gap-3"
          >
            <div
              v-for="item in recentAudits"
              :key="item.id"
              class="rounded-lg border border-default px-3 py-2"
            >
              <div class="flex items-center justify-between gap-3">
                <div class="mono text-xs text-dimmed">
                  {{ item.operatorUid || 'system' }}
                </div>
                <div class="text-xs text-muted">
                  {{ formatDateTime(item.createdAt) }}
                </div>
              </div>
              <div class="mt-1 text-sm text-default">
                <span class="mono">{{ item.action }}</span>
                <span class="text-muted"> · {{ item.targetType || 'tenant' }}/{{ item.targetId || tenant.tenantCode }}</span>
              </div>
            </div>
          </div>
        </UCard>
      </div>

      <div class="col gap-4">
        <UCard>
          <template #header>
            <div class="font-medium text-highlighted">
              关键指标
            </div>
          </template>
          <div class="col gap-2 text-sm">
            <div class="flex items-center justify-between">
              <span class="text-muted">活跃 deployment</span>
              <span class="mono text-highlighted">{{ summary?.healthyDeploymentCount || 0 }} / {{ summary?.deploymentCount || 0 }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-muted">已激活应用</span>
              <span class="mono text-highlighted">{{ summary?.applicationCount || 0 }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-muted">租户成员</span>
              <span class="mono text-highlighted">{{ summary?.memberCount || 0 }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-muted">角色 / 模板</span>
              <span class="mono text-highlighted">{{ summary?.roleCount || 0 }} / {{ summary?.templateCount || 0 }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-muted">License</span>
              <span class="mono text-highlighted">{{ summary?.licenseCount || 0 }}</span>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="font-medium text-highlighted">
              订阅摘要
            </div>
          </template>
          <div class="row-between mb-3">
            <div>
              <div class="text-xs uppercase tracking-[0.05em] text-muted">
                当前计划
              </div>
              <div class="text-lg font-semibold text-highlighted">
                {{ tenant.planCode || '未分配' }}
              </div>
            </div>
            <UBadge
              :color="STATUS_TONE[tenant.status] || 'neutral'"
              variant="soft"
            >
              {{ tenant.status }}
            </UBadge>
          </div>
          <dl class="grid gap-x-4 gap-y-2 sm:grid-cols-[90px_1fr] text-sm">
            <dt class="text-muted">
              开始
            </dt>
            <dd class="mono">
              {{ tenant.subscriptionStartedAt || '—' }}
            </dd>
            <dt class="text-muted">
              到期
            </dt>
            <dd class="mono">
              {{ tenant.subscriptionEndedAt || '—' }}
            </dd>
            <dt class="text-muted">
              订阅状态
            </dt>
            <dd>
              {{ tenant.subscriptionStatus || '—' }}
            </dd>
          </dl>
        </UCard>
      </div>
    </div>

    <UCard
      v-else-if="tab === 'subscription'"
      class="mt-4"
      :ui="{ body: 'p-0 sm:p-0' }"
    >
      <div class="toolbar">
        <span class="text-sm text-muted">启用应用与授权态</span>
        <span class="grow" />
        <span class="mono text-muted text-xs">{{ subscriptions.length }} items</span>
      </div>
      <UEmpty
        v-if="subscriptions.length === 0"
        icon="i-lucide-layers"
        title="暂无订阅应用"
        description="该租户还没有展开任何应用订阅。"
        class="py-14"
      />
      <UTable
        v-else
        :data="subscriptions"
        :columns="subscriptionColumns"
        :ui="{
          root: 'overflow-x-auto',
          th: 'text-xs font-medium uppercase tracking-[0.04em] text-muted bg-muted/40 whitespace-nowrap',
          td: 'text-sm text-muted whitespace-nowrap'
        }"
      >
        <template #application-cell="{ row }">
          <div class="font-medium text-highlighted">
            {{ row.original.application.appName }}
          </div>
          <div class="mono text-dimmed text-xs">
            {{ row.original.application.appCode }}
          </div>
        </template>

        <template #stage-cell="{ row }">
          <UBadge
            :color="row.original.stage.tone"
            variant="soft"
            size="sm"
          >
            {{ row.original.stage.label }}
          </UBadge>
        </template>

        <template #deployment-cell="{ row }">
          <div
            v-if="row.original.deployment"
            class="mono text-muted text-xs"
          >
            {{ row.original.deployment.deploymentCode }}
          </div>
          <span
            v-else
            class="text-dimmed text-xs"
          >—</span>
        </template>

        <template #license-cell="{ row }">
          <div
            v-if="row.original.license"
            class="mono text-muted text-xs"
          >
            {{ row.original.license.licenseCode }}
          </div>
          <span
            v-else
            class="text-dimmed text-xs"
          >—</span>
        </template>

        <template #manifest-cell="{ row }">
          <div
            v-if="row.original.manifest"
            class="mono text-muted text-xs"
          >
            seq #{{ row.original.manifest.manifestSeq }}
          </div>
          <span
            v-else
            class="text-dimmed text-xs"
          >—</span>
        </template>
      </UTable>
    </UCard>

    <UCard
      v-else-if="tab === 'deployments'"
      class="mt-4"
      :ui="{ body: 'p-0 sm:p-0' }"
    >
      <div class="toolbar">
        <span class="text-sm text-muted">运行中的部署对象</span>
        <span class="grow" />
        <span class="mono text-muted text-xs">{{ deployments.length }} items</span>
      </div>
      <UEmpty
        v-if="deployments.length === 0"
        icon="i-lucide-server"
        title="尚无 deployment"
        description="该租户当前没有任何运行的部署。"
        class="py-14"
      />
      <UTable
        v-else
        :data="deployments"
        :columns="deploymentColumns"
        :ui="{
          root: 'overflow-x-auto',
          th: 'text-xs font-medium uppercase tracking-[0.04em] text-muted bg-muted/40 whitespace-nowrap',
          td: 'text-sm text-muted whitespace-nowrap'
        }"
      >
        <template #reportedAppVersion-cell="{ row }">
          <span class="mono text-muted text-xs">{{ row.original.reportedAppVersion || '—' }}</span>
        </template>

        <template #status-cell="{ row }">
          <UBadge
            :color="STATUS_TONE[row.original.status] || 'neutral'"
            variant="soft"
            size="sm"
          >
            {{ row.original.status }}
          </UBadge>
        </template>

        <template #health-cell="{ row }">
          <UBadge
            :color="toneByHealth(row.original)"
            variant="soft"
            size="sm"
          >
            {{ row.original.connectivityStatus }}
          </UBadge>
        </template>

        <template #heartbeat-cell="{ row }">
          <span class="text-muted">{{ formatDateTime(row.original.lastHeartbeatAt) }}</span>
        </template>
      </UTable>
    </UCard>

    <UCard
      v-else-if="tab === 'members'"
      class="mt-4"
      :ui="{ body: 'p-0 sm:p-0' }"
    >
      <div class="toolbar">
        <span class="text-sm text-muted">租户成员</span>
        <span class="grow" />
        <span class="mono text-muted text-xs">{{ members.length }} items</span>
      </div>
      <UEmpty
        v-if="members.length === 0"
        icon="i-lucide-users"
        title="暂无成员"
        description="该租户还没有同步用户。"
        class="py-14"
      />
      <UTable
        v-else
        :data="members"
        :columns="memberColumns"
        :ui="{
          root: 'overflow-x-auto',
          th: 'text-xs font-medium uppercase tracking-[0.04em] text-muted bg-muted/40 whitespace-nowrap',
          td: 'text-sm text-muted whitespace-nowrap'
        }"
      >
        <template #member-cell="{ row }">
          <div class="font-medium text-highlighted">
            {{ row.original.displayName }}
          </div>
          <div class="mono text-dimmed text-xs">
            {{ row.original.uid }}
          </div>
        </template>

        <template #status-cell="{ row }">
          <UBadge
            :color="STATUS_TONE[row.original.status] || 'neutral'"
            variant="soft"
            size="sm"
          >
            {{ row.original.status }}
          </UBadge>
        </template>

        <template #lastLogin-cell="{ row }">
          <span class="text-muted">{{ formatDateTime(row.original.lastLoginAt || row.original.createdAt) }}</span>
        </template>
      </UTable>
    </UCard>

    <UCard
      v-else
      class="mt-4"
      :ui="{ body: 'p-0 sm:p-0' }"
    >
      <div class="toolbar">
        <UInput
          v-model="auditQuery"
          icon="i-lucide-search"
          placeholder="搜索 actor / action..."
          size="sm"
          class="w-full max-w-[320px]"
        />
        <span class="grow" />
        <span class="mono text-muted text-xs">{{ audits.length }} items</span>
      </div>
      <UEmpty
        v-if="audits.length === 0"
        icon="i-lucide-activity"
        title="暂无审计日志"
        description="该租户还没有可展示的审计事件。"
        class="py-14"
      />
      <UTable
        v-else
        :data="audits"
        :columns="auditColumns"
        :ui="{
          root: 'overflow-x-auto',
          th: 'text-xs font-medium uppercase tracking-[0.04em] text-muted bg-muted/40 whitespace-nowrap',
          td: 'text-sm text-muted whitespace-nowrap'
        }"
      >
        <template #time-cell="{ row }">
          <span class="text-muted">{{ formatDateTime(row.original.createdAt) }}</span>
        </template>

        <template #action-cell="{ row }">
          <UBadge
            :color="row.original.tone"
            variant="soft"
            size="sm"
          >
            {{ row.original.action }}
          </UBadge>
        </template>

        <template #target-cell="{ row }">
          <span class="mono text-muted text-xs">{{ row.original.targetType || 'tenant' }}/{{ row.original.targetId || tenant.tenantCode }}</span>
        </template>
      </UTable>
    </UCard>
  </div>

  <div v-else>
    <UBreadcrumb
      :items="crumbs"
      class="mb-3.5"
    />
    <UEmpty
      icon="i-lucide-search-x"
      title="未找到该租户"
      :description="`tenantCode=${code} 不存在或已删除。`"
      class="py-14"
    >
      <template #actions>
        <UButton
          to="/admin/tenants"
          icon="i-lucide-arrow-left"
        >
          返回租户列表
        </UButton>
      </template>
    </UEmpty>
    <UAlert
      v-if="detailError"
      color="error"
      variant="soft"
      title="租户详情加载失败"
      class="mt-4"
    >
      <template #description>
        {{ (detailError as Error).message }}
      </template>
    </UAlert>
  </div>
</template>
