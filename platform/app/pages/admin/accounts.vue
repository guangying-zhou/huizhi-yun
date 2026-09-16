<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ layout: 'platform' })
usePageTitle('平台账号')

interface AccountItem {
  id: number
  uid: string
  username: string
  email: string
  displayName: string
  accountType: string
  mfaEnabled: boolean
  status: string
  roles: string[]
  lastLoginAt: string | null
}
interface ListResponse { items: AccountItem[], total: number, page: number, pageSize: number }
interface ApiEnvelope<T> { success: true, data: T }

const q = ref('')
const status = ref('all')
const page = ref(1)
const pageSize = 20
const pending = ref(false)
const error = ref<unknown>(null)
const data = ref<ApiEnvelope<ListResponse> | null>(null)
const statusItems = [
  { label: '状态：全部', value: 'all' },
  { label: '启用', value: 'active' },
  { label: '停用', value: 'disabled' }
]
const columns: TableColumn<AccountItem>[] = [
  { id: 'account', header: '账号' },
  { id: 'contact', header: '登录信息' },
  { id: 'roles', header: '平台角色' },
  { id: 'security', header: '安全' },
  { id: 'lastLoginAt', header: '最近登录' },
  { id: 'status', header: '状态' }
]
const listQuery = computed(() => ({ keyword: q.value || undefined, status: status.value, page: page.value, pageSize }))
const rows = computed(() => data.value?.data.items || [])
const total = computed(() => data.value?.data.total || 0)

async function refresh() {
  pending.value = true
  error.value = null
  try {
    data.value = await platformFetchJson<ApiEnvelope<ListResponse>>('/api/platform/ops/accounts', { query: listQuery.value })
  } catch (caught) {
    error.value = caught
  } finally {
    pending.value = false
  }
}

function formatDateTime(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

await refresh()
watch([q, status], () => {
  page.value = 1
})
watch(listQuery, () => {
  void refresh()
})
</script>

<template>
  <div>
    <div class="page-h">
      <div><h1>平台账号</h1><p>查看能够登录 Platform Admin Console 的账号及其角色。</p></div>
      <div class="page-h-actions">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-refresh-cw"
          :loading="pending"
          @click="refresh"
        >
          刷新
        </UButton>
      </div>
    </div>
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      title="账号加载失败"
      :description="String((error as any)?.data?.message || (error as any)?.message || '请稍后重试')"
      class="mb-4"
    />
    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="toolbar">
        <UInput
          v-model="q"
          icon="i-lucide-search"
          placeholder="搜索 UID / 用户名 / 邮箱"
          size="sm"
          class="w-full max-w-80"
        />
        <USelect
          v-model="status"
          :items="statusItems"
          size="sm"
          class="w-36"
        />
        <span class="grow" /><span class="mono text-muted text-xs">{{ rows.length }} / {{ total }}</span>
      </div>
      <UEmpty
        v-if="!pending && rows.length === 0"
        icon="i-lucide-users"
        title="暂无平台账号"
        description="平台账号创建后会显示在这里。"
        class="py-14"
      />
      <UTable
        v-else
        :data="rows"
        :columns="columns"
        :loading="pending"
        :ui="{ root: 'overflow-x-auto', th: 'text-xs font-medium text-muted bg-muted/40 whitespace-nowrap', td: 'text-sm text-muted whitespace-nowrap' }"
      >
        <template #account-cell="{ row }">
          <div>
            <div class="font-medium text-highlighted">
              {{ row.original.displayName }}
            </div><div class="mono text-xs text-muted">
              {{ row.original.uid }}
            </div>
          </div>
        </template>
        <template #contact-cell="{ row }">
          <div>
            <div>{{ row.original.username }}</div><div class="text-xs text-muted">
              {{ row.original.email }}
            </div>
          </div>
        </template>
        <template #roles-cell="{ row }">
          <span>{{ row.original.roles.join('、') || '未分配' }}</span>
        </template>
        <template #security-cell="{ row }">
          <UBadge
            color="neutral"
            variant="soft"
          >
            {{ row.original.mfaEnabled ? 'MFA 已开启' : row.original.accountType }}
          </UBadge>
        </template>
        <template #lastLoginAt-cell="{ row }">
          {{ formatDateTime(row.original.lastLoginAt) }}
        </template>
        <template #status-cell="{ row }">
          <UBadge
            :color="row.original.status === 'active' ? 'success' : 'neutral'"
            variant="soft"
          >
            {{ row.original.status }}
          </UBadge>
        </template>
      </UTable>
      <div
        v-if="rows.length > 0"
        class="tbl-foot"
      >
        <span>共 <b class="font-semibold text-highlighted">{{ total }}</b> 条</span><UPagination
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
  </div>
</template>
