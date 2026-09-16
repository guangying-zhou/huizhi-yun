<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ layout: 'platform' })
usePageTitle('公告管理')

interface AnnouncementItem {
  id: number
  title: string
  content: string
  audienceType: string
  audienceValue: string | null
  severity: string
  status: string
  publishedAt: string | null
  expiredAt: string | null
  creatorUid: string | null
  creatorName: string | null
  createdAt: string
  updatedAt: string
}
interface ListResponse { items: AnnouncementItem[], total: number, page: number, pageSize: number }
interface ApiEnvelope<T> { success: true, data: T }

const q = ref('')
const status = ref('all')
const severity = ref('all')
const page = ref(1)
const pageSize = 20
const pending = ref(false)
const error = ref<unknown>(null)
const data = ref<ApiEnvelope<ListResponse> | null>(null)
const statusItems = [{ label: '状态：全部', value: 'all' }, { label: '草稿', value: 'draft' }, { label: '已发布', value: 'published' }, { label: '已下线', value: 'archived' }]
const severityItems = [{ label: '级别：全部', value: 'all' }, { label: '信息', value: 'info' }, { label: '成功', value: 'success' }, { label: '警告', value: 'warning' }, { label: '严重', value: 'error' }]
const columns: TableColumn<AnnouncementItem>[] = [
  { id: 'announcement', header: '公告' }, { id: 'audience', header: '受众' }, { id: 'severity', header: '级别' },
  { id: 'status', header: '状态' }, { id: 'publishedAt', header: '发布时间' }, { id: 'expiredAt', header: '到期时间' }, { id: 'creator', header: '创建人' }
]
const listQuery = computed(() => ({ keyword: q.value || undefined, status: status.value, severity: severity.value, page: page.value, pageSize }))
const rows = computed(() => data.value?.data.items || [])
const total = computed(() => data.value?.data.total || 0)

async function refresh() {
  pending.value = true
  error.value = null
  try {
    data.value = await platformFetchJson<ApiEnvelope<ListResponse>>('/api/platform/ops/announcements', { query: listQuery.value })
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
watch([q, status, severity], () => {
  page.value = 1
})
watch(listQuery, () => {
  void refresh()
})
</script>

<template>
  <div>
    <div class="page-h">
      <div><h1>公告管理</h1><p>查看平台公告的受众、级别、发布时间和有效期。</p></div><div class="page-h-actions">
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
      title="公告加载失败"
      :description="String((error as any)?.data?.message || (error as any)?.message || '请稍后重试')"
      class="mb-4"
    />
    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="toolbar">
        <UInput
          v-model="q"
          icon="i-lucide-search"
          placeholder="搜索公告标题 / 内容 / 受众"
          size="sm"
          class="w-full max-w-80"
        /><USelect
          v-model="status"
          :items="statusItems"
          size="sm"
          class="w-36"
        /><USelect
          v-model="severity"
          :items="severityItems"
          size="sm"
          class="w-36"
        /><span class="grow" /><span class="mono text-muted text-xs">{{ rows.length }} / {{ total }}</span>
      </div>
      <UEmpty
        v-if="!pending && rows.length === 0"
        icon="i-lucide-megaphone"
        title="暂无公告"
        description="平台公告创建后会显示在这里。"
        class="py-14"
      />
      <UTable
        v-else
        :data="rows"
        :columns="columns"
        :loading="pending"
        :ui="{ root: 'overflow-x-auto', th: 'text-xs font-medium text-muted bg-muted/40 whitespace-nowrap', td: 'text-sm text-muted whitespace-nowrap' }"
      >
        <template #announcement-cell="{ row }">
          <div class="max-w-96">
            <div class="font-medium text-highlighted">
              {{ row.original.title }}
            </div><div class="truncate text-xs text-muted">
              {{ row.original.content }}
            </div>
          </div>
        </template>
        <template #audience-cell="{ row }">
          <div>
            <div class="text-highlighted">
              {{ row.original.audienceType }}
            </div><div class="mono text-xs text-muted">
              {{ row.original.audienceValue || '全部' }}
            </div>
          </div>
        </template>
        <template #severity-cell="{ row }">
          <UBadge
            :color="row.original.severity === 'error' ? 'error' : row.original.severity === 'warning' ? 'warning' : row.original.severity === 'success' ? 'success' : 'info'"
            variant="soft"
          >
            {{ row.original.severity }}
          </UBadge>
        </template>
        <template #status-cell="{ row }">
          <UBadge
            :color="row.original.status === 'published' ? 'success' : row.original.status === 'draft' ? 'warning' : 'neutral'"
            variant="soft"
          >
            {{ row.original.status }}
          </UBadge>
        </template>
        <template #publishedAt-cell="{ row }">
          {{ formatDateTime(row.original.publishedAt) }}
        </template>
        <template #expiredAt-cell="{ row }">
          {{ formatDateTime(row.original.expiredAt) }}
        </template>
        <template #creator-cell="{ row }">
          {{ row.original.creatorName || row.original.creatorUid || '—' }}
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
