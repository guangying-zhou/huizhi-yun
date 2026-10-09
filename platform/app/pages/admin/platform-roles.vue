<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

definePageMeta({ layout: 'platform' })
usePageTitle('平台角色')

interface RoleItem { id: number, roleCode: string, roleName: string, description: string | null, isSystem: boolean, isAssignable: boolean, status: string }
interface ListResponse { items: RoleItem[], total: number, page: number, pageSize: number }
interface ApiEnvelope<T> { success: true, data: T }

const q = ref('')
const status = ref('all')
const page = ref(1)
const pageSize = 20
const pending = ref(false)
const error = ref<unknown>(null)
const data = ref<ApiEnvelope<ListResponse> | null>(null)
const statusItems = [{ label: '状态：全部', value: 'all' }, { label: '启用', value: 'active' }, { label: '停用', value: 'disabled' }]
const columns: TableColumn<RoleItem>[] = [
  { id: 'role', header: '角色' },
  { accessorKey: 'description', header: '说明' },
  { id: 'properties', header: '属性' },
  { id: 'status', header: '状态' }
]
const listQuery = computed(() => ({ keyword: q.value || undefined, status: status.value === 'all' ? undefined : status.value, page: page.value, pageSize }))
const rows = computed(() => data.value?.data.items || [])
const total = computed(() => data.value?.data.total || 0)

async function refresh() {
  pending.value = true
  error.value = null
  try {
    data.value = await platformFetchJson<ApiEnvelope<ListResponse>>('/api/platform/ops/roles', { query: listQuery.value })
  } catch (caught) {
    error.value = caught
  } finally {
    pending.value = false
  }
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
      <div><h1>平台角色</h1><p>查看平台运营账号使用的角色目录和可分配状态。</p></div>
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
      title="角色加载失败"
      :description="String((error as any)?.data?.message || (error as any)?.message || '请稍后重试')"
      class="mb-4"
    />
    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="toolbar">
        <UInput
          v-model="q"
          icon="i-lucide-search"
          placeholder="搜索角色编码 / 名称"
          size="sm"
          class="w-full max-w-80"
        /><USelect
          v-model="status"
          :items="statusItems"
          size="sm"
          class="w-36"
        /><span class="grow" /><span class="mono text-muted text-xs">{{ rows.length }} / {{ total }}</span>
      </div>
      <UEmpty
        v-if="!pending && rows.length === 0"
        icon="i-lucide-shield-check"
        title="暂无平台角色"
        description="平台角色初始化后会显示在这里。"
        class="py-14"
      />
      <UTable
        v-else
        :data="rows"
        :columns="columns"
        :loading="pending"
        :ui="{ root: 'overflow-x-auto', th: 'text-xs font-medium text-muted bg-muted/40 whitespace-nowrap', td: 'text-sm text-muted whitespace-nowrap' }"
      >
        <template #role-cell="{ row }">
          <div>
            <div class="font-medium text-highlighted">
              {{ row.original.roleName }}
            </div><div class="mono text-xs text-muted">
              {{ row.original.roleCode }}
            </div>
          </div>
        </template>
        <template #properties-cell="{ row }">
          <div class="flex gap-1">
            <UBadge
              v-if="row.original.isSystem"
              color="info"
              variant="soft"
            >
              内置
            </UBadge><UBadge
              :color="row.original.isAssignable ? 'success' : 'neutral'"
              variant="soft"
            >
              {{ row.original.isAssignable ? '可分配' : '不可分配' }}
            </UBadge>
          </div>
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
