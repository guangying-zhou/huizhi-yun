<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({
  layout: 'platform'
})

usePageTitle('应用权限角色')

interface ApiEnvelope<T> {
  success: true
  data: T
}

interface ApplicationItem {
  appCode: string
  appName: string
}

interface ApplicationListResponse {
  items: ApplicationItem[]
}

interface SystemRoleItem {
  id: number
  roleCode: string
  roleName: string
  roleType: string
  appCode: string | null
  description: string | null
  isRequired: boolean
  status: string
  permissionCount: number
  templateCount: number
  tenantCount: number
}

interface SystemRoleListResponse {
  items: SystemRoleItem[]
  total: number
  page: number
  pageSize: number
}

interface CoverageResponse {
  total: number
  summary: Array<{
    appCode: string
    appName: string
    missingCount: number
  }>
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral' | 'info'> = {
  active: 'success',
  suspended: 'warning',
  disabled: 'neutral',
  draft: 'info'
}

const router = useRouter()
const q = ref('')
const appCode = ref('all')

const columns: TableColumn<SystemRoleItem>[] = [
  { accessorKey: 'role', header: '角色' },
  { accessorKey: 'app', header: '应用' },
  { accessorKey: 'description', header: '说明' },
  { accessorKey: 'permissionCount', header: '权限', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'templateCount', header: '引用模板', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'tenantCount', header: '使用租户', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'status', header: '状态' },
  { id: 'actions', header: '', meta: { class: { th: 'w-10', td: 'w-10 text-right' } } }
]

const listQuery = computed(() => ({
  keyword: q.value || undefined,
  appCode: appCode.value === 'all' ? undefined : appCode.value,
  page: 1,
  pageSize: 200
}))

const { data: applicationData, refresh: refreshApplications } = usePlatformData<ApiEnvelope<ApplicationListResponse>>('/api/platform/ops/applications', {
  query: {
    page: 1,
    pageSize: 200
  }
})

const { data, pending, refresh } = usePlatformData<ApiEnvelope<SystemRoleListResponse>>('/api/platform/ops/system-roles', {
  query: () => listQuery.value,
  watch: [listQuery]
})

const { data: coverageData, refresh: refreshCoverage } = usePlatformData<ApiEnvelope<CoverageResponse>>('/api/platform/ops/system-roles/coverage', {
  query: {
    onlyMissing: 'true'
  }
})

await Promise.all([refreshApplications(), refresh(), refreshCoverage()])

const rows = computed<SystemRoleItem[]>(() => (data.value?.data.items || []) as SystemRoleItem[])
const total = computed(() => data.value?.data.total || 0)
const appNameByCode = computed(() => new Map(((applicationData.value?.data.items || []) as ApplicationItem[]).map(item => [item.appCode, item.appName])))
const appItems = computed(() => [
  { label: '应用：全部', value: 'all' },
  ...((applicationData.value?.data.items || []) as ApplicationItem[])
    .filter(item => item.appCode)
    .map(item => ({
      label: `${item.appName} (${item.appCode})`,
      value: item.appCode
    }))
])
const missingCoverageCount = computed(() => coverageData.value?.data.total || 0)
const missingCoverageApps = computed(() => ((coverageData.value?.data.summary || []) as CoverageResponse['summary'])
  .filter(item => item.missingCount > 0)
  .map(item => `${item.appName} ${item.missingCount}`)
  .join(' / '))

function clearFilters() {
  q.value = ''
  appCode.value = 'all'
}

function refreshAll() {
  refresh()
  refreshCoverage()
}

function go(code: string) {
  router.push(`/admin/system-roles/${encodeURIComponent(code)}`)
}

function selectRow(_event: Event, row: { original: SystemRoleItem }) {
  go(row.original.roleCode)
}

function rowMenuItems(role: SystemRoleItem) {
  return [[
    { label: '打开详情', icon: 'i-lucide-panel-right-open', onSelect: () => go(role.roleCode) },
    { label: '编辑权限', icon: 'i-lucide-pencil', onSelect: () => go(role.roleCode) },
    { label: '复制 code', icon: 'i-lucide-copy', onSelect: () => navigator.clipboard?.writeText(role.roleCode) }
  ]]
}
</script>

<template>
  <div>
    <div class="page-h">
      <div>
        <h1>应用权限角色</h1>
        <p>维护各应用可被企业角色引用的权限角色，如 codocs.admin、aims.view。</p>
      </div>
      <div class="page-h-actions">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-refresh-cw"
          :loading="pending"
          @click="refreshAll"
        >
          刷新
        </UButton>
        <UButton
          color="primary"
          variant="solid"
          icon="i-lucide-plus"
          to="/admin/system-roles/new"
        >
          新建应用权限角色
        </UButton>
      </div>
    </div>

    <UAlert
      v-if="missingCoverageCount > 0"
      color="warning"
      variant="soft"
      icon="i-lucide-shield-alert"
      class="mb-4"
      title="存在未被应用权限角色覆盖的授权动作"
      :description="missingCoverageApps || `${missingCoverageCount} 个 requires_grant 动作缺少应用权限角色覆盖`"
    />

    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="toolbar">
        <UInput
          v-model="q"
          icon="i-lucide-search"
          placeholder="搜索角色名 / code…"
          size="sm"
          class="w-full max-w-70"
        />
        <USelect
          v-model="appCode"
          :items="appItems"
          size="sm"
          class="w-64"
        />
        <span class="grow" />
        <span class="mono text-muted text-xs">
          {{ rows.length }} / {{ total }}
        </span>
      </div>

      <UEmpty
        v-if="pending && rows.length === 0"
        icon="i-lucide-loader-circle"
        title="加载应用权限角色中"
        description="正在从数据库加载应用权限角色清单。"
        class="py-14"
      />

      <UEmpty
        v-else-if="rows.length === 0"
        icon="i-lucide-search"
        title="无匹配角色"
        description="尝试调整筛选条件或清空搜索。"
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
        <template #role-cell="{ row }">
          <div class="flex items-center gap-2.5">
            <div class="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted">
              <UIcon
                name="i-lucide-shield"
                class="size-3.5"
              />
            </div>
            <div class="min-w-0">
              <div class="font-medium text-highlighted">
                {{ row.original.roleName }}
              </div>
              <div class="mono text-dimmed text-xs">
                {{ row.original.roleCode }}
              </div>
            </div>
          </div>
        </template>

        <template #app-cell="{ row }">
          <div class="min-w-0">
            <div class="text-highlighted">
              {{ row.original.appCode ? appNameByCode.get(row.original.appCode) || row.original.appCode : '未关联应用' }}
            </div>
            <div
              v-if="row.original.appCode"
              class="mono text-dimmed text-xs"
            >
              {{ row.original.appCode }}
            </div>
          </div>
        </template>

        <template #description-cell="{ row }">
          <span class="text-muted line-clamp-1 max-w-[320px] block">
            {{ row.original.description || '未设置描述' }}
          </span>
        </template>

        <template #permissionCount-cell="{ row }">
          <span class="mono text-highlighted">{{ row.original.permissionCount }}</span>
        </template>

        <template #templateCount-cell="{ row }">
          <span class="mono text-highlighted">{{ row.original.templateCount }}</span>
        </template>

        <template #tenantCount-cell="{ row }">
          <span class="mono text-highlighted">{{ row.original.tenantCount }}</span>
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

        <template #actions-cell="{ row }">
          <UDropdownMenu :items="rowMenuItems(row.original)">
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-ellipsis"
              size="sm"
              square
              @click.stop
            />
          </UDropdownMenu>
        </template>
      </UTable>
    </UCard>
  </div>
</template>
