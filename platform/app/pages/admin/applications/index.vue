<script setup lang="ts">
import {
  ROLE_TONE,
  appIconFallback,
  formatDateTime,
  isAppIconName,
  roleLabel,
  statusTone,
  type ApiEnvelope,
  type OpsApplication,
  type OpsApplicationList,
  type ServiceRole,
  type Tone
} from '~/utils/opsConsole'

definePageMeta({
  layout: 'platform'
})

usePageTitle('应用管理')

const router = useRouter()
const toast = useToast()
const q = ref('')
const role = ref<ServiceRole | 'all'>('all')
const status = ref<string>('all')
const appStatus = ref<string>('all')
const showAdvancedFilters = ref(false)
const actionPending = ref<number | null>(null)
const page = ref(1)
const pageSize = 20
const orderModalOpen = ref(false)
const orderRows = ref<Array<Pick<OpsApplication, 'id' | 'appCode' | 'appName' | 'icon' | 'sortOrder' | 'status'>>>([])
const orderLoading = ref(false)
const orderSaving = ref(false)

const roleItems = [
  { label: '服务定位：全部', value: 'all' },
  { label: '业务应用', value: 'business_app' },
  { label: '目录运行时', value: 'directory_runtime' },
  { label: '工作流运行时', value: 'workflow_runtime' },
  { label: '平台服务', value: 'supporting_service' }
]

const statusItems = [
  { label: '最新 release：全部', value: 'all' },
  { label: 'released', value: 'released' },
  { label: 'draft', value: 'draft' },
  { label: 'permissions_pending', value: 'permissions_pending' },
  { label: 'ready', value: 'ready' },
  { label: 'deprecated', value: 'deprecated' }
]

const appStatusItems = [
  { label: '应用状态：全部', value: 'all' },
  { label: 'active', value: 'active' },
  { label: 'suspended', value: 'suspended' },
  { label: 'disabled', value: 'disabled' }
]

interface ApplicationListQuery {
  keyword?: string
  serviceRole?: ServiceRole
  releaseStatus?: string
  status?: string
  page: number
  pageSize: number
}

const columns = [
  { id: 'select', header: '' },
  { accessorKey: 'sortOrder', header: '顺序', meta: { class: { th: 'w-20 text-right', td: 'w-20 text-right' } } },
  { accessorKey: 'appName', header: '应用' },
  { accessorKey: 'serviceRole', header: '服务定位' },
  { id: 'release', header: '最新 Release' },
  { id: 'manifest', header: 'Manifest' },
  { accessorKey: 'subscriberCount', header: '订阅', meta: { class: { th: 'text-right', td: 'text-right' } } },
  { accessorKey: 'status', header: '状态' },
  { id: 'actions', header: '', meta: { class: { th: 'w-10', td: 'w-10 text-right' } } }
]

const listQuery = computed<ApplicationListQuery>(() => ({
  keyword: q.value || undefined,
  serviceRole: role.value === 'all' ? undefined : role.value,
  releaseStatus: status.value === 'all' ? undefined : status.value,
  status: appStatus.value === 'all' ? undefined : appStatus.value,
  page: page.value,
  pageSize
}))

const { data, pending, refresh } = await useAsyncData(
  'ops-applications',
  () => platformFetchJson<ApiEnvelope<OpsApplicationList>>('/api/platform/ops/applications', {
    query: listQuery.value
  }),
  {
    watch: [listQuery]
  }
)

const rows = computed(() => data.value?.data.items || [])
const total = computed(() => data.value?.data.total || 0)

function go(code: string) {
  router.push(`/admin/applications/${code}`)
}

function clearFilters() {
  q.value = ''
  role.value = 'all'
  status.value = 'all'
  appStatus.value = 'all'
  page.value = 1
}

function normalizeOrderRows(items: OpsApplication[]) {
  return items
    .map(item => ({
      id: item.id,
      appCode: item.appCode,
      appName: item.appName,
      icon: item.icon,
      sortOrder: Number(item.sortOrder || 0),
      status: item.status
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.appCode.localeCompare(b.appCode))
}

watch([q, role, status, appStatus], () => {
  page.value = 1
})

function toneColor(tone: Tone) {
  return tone
}

function selectRow(_event: Event, row: { original: OpsApplication }) {
  go(row.original.appCode)
}

async function updateAppStatus(app: OpsApplication, nextStatus: 'active' | 'suspended') {
  actionPending.value = app.id
  try {
    await $fetch(`/api/platform/ops/applications/${app.id}`, {
      method: 'PATCH',
      body: { status: nextStatus }
    })
    await refresh()
    toast.add({
      title: nextStatus === 'active' ? '应用已恢复' : '应用已暂停',
      description: app.appCode,
      color: 'success'
    })
  } catch (error) {
    toast.add({
      title: '状态更新失败',
      description: error instanceof Error ? error.message : '请稍后重试。',
      color: 'error'
    })
  } finally {
    actionPending.value = null
  }
}

async function openOrderModal() {
  orderModalOpen.value = true
  orderLoading.value = true
  try {
    const response = await platformFetchJson<ApiEnvelope<OpsApplicationList>>('/api/platform/ops/applications', {
      query: {
        page: 1,
        pageSize: 100
      }
    })
    orderRows.value = normalizeOrderRows(response.data.items)
  } catch (error) {
    toast.add({
      title: '应用顺序加载失败',
      description: error instanceof Error ? error.message : '请稍后重试。',
      color: 'error'
    })
  } finally {
    orderLoading.value = false
  }
}

function normalizeSequentialOrder() {
  orderRows.value = orderRows.value.map((item, index) => ({
    ...item,
    sortOrder: (index + 1) * 10
  }))
}

function moveOrderRow(index: number, direction: -1 | 1) {
  const targetIndex = index + direction
  if (targetIndex < 0 || targetIndex >= orderRows.value.length) return

  const nextRows = [...orderRows.value]
  const [item] = nextRows.splice(index, 1)
  if (!item) return
  nextRows.splice(targetIndex, 0, item)
  orderRows.value = nextRows
  normalizeSequentialOrder()
}

async function saveApplicationOrder() {
  orderSaving.value = true
  try {
    await $fetch('/api/platform/ops/applications/order', {
      method: 'PUT',
      body: {
        items: orderRows.value.map(item => ({
          id: item.id,
          sortOrder: Number(item.sortOrder || 0)
        }))
      }
    })
    orderModalOpen.value = false
    await refresh()
    toast.add({ title: '应用显示顺序已保存', color: 'success' })
  } catch (error) {
    toast.add({
      title: '应用顺序保存失败',
      description: error instanceof Error ? error.message : '请稍后重试。',
      color: 'error'
    })
  } finally {
    orderSaving.value = false
  }
}

function openHome(app: OpsApplication) {
  if (!app.homeUrl) {
    toast.add({ title: '未配置主页 URL', description: app.appCode, color: 'warning' })
    return
  }
  window.open(app.homeUrl, '_blank', 'noopener,noreferrer')
}

function rowMenuItems(app: OpsApplication) {
  return [[
    {
      label: '打开详情',
      icon: 'i-lucide-panel-right-open',
      onSelect: () => go(app.appCode)
    },
    {
      label: 'Release',
      icon: 'i-lucide-tags',
      onSelect: () => router.push(`/admin/applications/${app.appCode}/releases`)
    },
    {
      label: '设置',
      icon: 'i-lucide-settings',
      onSelect: () => router.push(`/admin/applications/${app.appCode}/settings`)
    },
    {
      label: '打开主页',
      icon: 'i-lucide-external-link',
      disabled: !app.homeUrl,
      onSelect: () => openHome(app)
    }
  ], [
    {
      label: app.status === 'active' ? '暂停应用' : '恢复应用',
      icon: app.status === 'active' ? 'i-lucide-pause-circle' : 'i-lucide-play-circle',
      onSelect: () => updateAppStatus(app, app.status === 'active' ? 'suspended' : 'active')
    }
  ]]
}
</script>

<template>
  <div>
    <div class="page-h">
      <div>
        <h1>应用</h1>
        <p>平台上架的所有应用。从 GitLab 仓库导入新应用，或维护现有应用的 release 与 manifest。</p>
      </div>
      <div class="page-h-actions">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-refresh-cw"
          :loading="pending"
          @click="() => refresh()"
        >
          同步
        </UButton>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-list-ordered"
          @click="openOrderModal"
        >
          显示顺序
        </UButton>
        <UButton
          color="primary"
          variant="solid"
          icon="i-lucide-plus"
          to="/admin/applications/new"
        >
          从 GitLab 导入
        </UButton>
      </div>
    </div>

    <UCard
      :ui="{ body: 'p-0 sm:p-0' }"
    >
      <div class="toolbar">
        <UInput
          v-model="q"
          icon="i-lucide-search"
          placeholder="搜索应用名、code..."
          size="sm"
          class="w-full max-w-70"
        />
        <USelect
          v-model="role"
          :items="roleItems"
          size="sm"
          class="w-40"
        />
        <USelect
          v-model="status"
          :items="statusItems"
          size="sm"
          class="w-44"
        />
        <span class="grow" />
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-filter"
          @click="showAdvancedFilters = !showAdvancedFilters"
        >
          更多筛选
        </UButton>
        <span class="mono text-muted text-xs">
          {{ rows.length }} / {{ total }}
        </span>
      </div>

      <div
        v-if="showAdvancedFilters"
        class="toolbar border-t border-default"
      >
        <USelect
          v-model="appStatus"
          :items="appStatusItems"
          size="sm"
          class="w-44"
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
      </div>

      <UEmpty
        v-if="rows.length === 0"
        icon="i-lucide-search"
        title="无匹配应用"
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
        <template #select-header>
          <UCheckbox
            :model-value="false"
            aria-label="选择全部应用"
          />
        </template>

        <template #select-cell>
          <UCheckbox
            :model-value="false"
            aria-label="选择应用"
            @click.stop
          />
        </template>

        <template #sortOrder-cell="{ row }">
          <span class="mono text-highlighted">{{ row.original.sortOrder }}</span>
        </template>

        <template #name-cell="{ row }">
          <div class="flex items-center gap-2.5">
            <div class="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-base">
              <UIcon
                v-if="isAppIconName(row.original.icon)"
                :name="row.original.icon"
                class="size-4 text-muted"
              />
              <img
                v-else-if="row.original.icon"
                :src="row.original.icon"
                class="size-4 rounded object-contain"
                :alt="row.original.appName"
              >
              <span v-else>{{ appIconFallback(row.original) }}</span>
            </div>
            <div class="min-w-0">
              <div class="font-medium text-highlighted">
                {{ row.original.appName }}
              </div>
              <div class="mono text-dimmed text-xs">
                {{ row.original.appCode }}
              </div>
            </div>
          </div>
        </template>

        <template #serviceRole-cell="{ row }">
          <UBadge
            :color="toneColor(ROLE_TONE[row.original.serviceRole])"
            variant="soft"
            size="sm"
          >
            <template #leading>
              <span class="size-1.5 rounded-full bg-current" />
            </template>
            {{ roleLabel(row.original.serviceRole) }}
          </UBadge>
        </template>

        <template #release-cell="{ row }">
          <div class="flex items-center gap-2">
            <span class="mono text-highlighted">{{ row.original.latestReleaseVersion || '—' }}</span>
            <UBadge
              :color="toneColor(statusTone(row.original.latestReleaseStatus))"
              variant="soft"
              size="sm"
            >
              <template #leading>
                <span class="size-1.5 rounded-full bg-current" />
              </template>
              {{ row.original.latestReleaseStatus || 'no release' }}
            </UBadge>
          </div>
        </template>

        <template #manifest-cell="{ row }">
          <div class="mono text-default">
            seq #{{ row.original.latestManifestSeq || '—' }}
          </div>
          <div class="text-dimmed text-xs">
            {{ formatDateTime(row.original.lastManifestRegisteredAt) }}
          </div>
        </template>

        <template #subscribers-cell="{ row }">
          <span class="mono text-highlighted">{{ row.original.subscriberCount }}</span>
        </template>

        <template #status-cell="{ row }">
          <UBadge
            :color="toneColor(statusTone(row.original.status))"
            variant="soft"
            size="sm"
          >
            <template #leading>
              <span class="size-1.5 rounded-full bg-current" />
            </template>
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
              :loading="actionPending === row.original.id"
              square
              @click.stop
            />
          </UDropdownMenu>
        </template>
      </UTable>

      <div
        v-if="rows.length > 0"
        class="tbl-foot"
      >
        <span>共 <b class="text-highlighted font-semibold">{{ rows.length }}</b> 条</span>
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
      v-model:open="orderModalOpen"
      title="应用显示顺序"
      description="该顺序会进入 Platform runtime applications 与 policy bundle，控制 Console 工作台、AppRail 和 AppLauncher 中的应用展示顺序。"
      :ui="{ content: 'max-w-3xl', body: 'max-h-[72vh] overflow-y-auto' }"
    >
      <template #body>
        <div class="flex flex-col gap-3">
          <UAlert
            color="info"
            variant="soft"
            icon="i-lucide-info"
            title="排序规则"
            description="数字越小越靠前；使用上下按钮会自动按 10 递增重新编号，也可以直接编辑数字。"
          />

          <div
            v-if="orderLoading"
            class="flex items-center justify-center py-12 text-sm text-muted"
          >
            <UIcon
              name="i-lucide-loader-2"
              class="mr-2 size-4 animate-spin"
            />
            正在加载应用...
          </div>

          <div
            v-else-if="orderRows.length === 0"
            class="rounded-md border border-dashed border-default py-10 text-center text-sm text-muted"
          >
            暂无应用。
          </div>

          <div
            v-else
            class="flex flex-col gap-2"
          >
            <div
              v-for="(app, index) in orderRows"
              :key="app.id"
              class="flex items-center gap-3 rounded-md border border-default bg-elevated/40 px-3 py-2"
            >
              <div class="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-base">
                <UIcon
                  v-if="isAppIconName(app.icon)"
                  :name="app.icon!"
                  class="size-4 text-muted"
                />
                <img
                  v-else-if="app.icon"
                  :src="app.icon"
                  class="size-4 rounded object-contain"
                  :alt="app.appName"
                >
                <span v-else>{{ appIconFallback(app) }}</span>
              </div>

              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium text-highlighted">
                  {{ app.appName }}
                </div>
                <div class="mono text-dimmed text-xs">
                  {{ app.appCode }}
                </div>
              </div>

              <UInput
                v-model.number="app.sortOrder"
                type="number"
                size="sm"
                class="w-24"
                :ui="{ base: 'text-right font-mono' }"
              />

              <div class="flex items-center gap-1">
                <UButton
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-chevron-up"
                  size="sm"
                  square
                  :disabled="index === 0"
                  @click="moveOrderRow(index, -1)"
                />
                <UButton
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-chevron-down"
                  size="sm"
                  square
                  :disabled="index === orderRows.length - 1"
                  @click="moveOrderRow(index, 1)"
                />
              </div>
            </div>
          </div>
        </div>
      </template>

      <template #footer="{ close }">
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="orderSaving"
            @click="close"
          >
            取消
          </UButton>
          <UButton
            color="primary"
            icon="i-lucide-save"
            :loading="orderSaving"
            :disabled="orderLoading || orderRows.length === 0"
            @click="saveApplicationOrder"
          >
            保存顺序
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
