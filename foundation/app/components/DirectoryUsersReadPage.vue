<script setup lang="ts">
import ContentPageHeader from './ContentPageHeader.vue'
import type { ConsoleDirectoryUser } from '../types/consoleDirectory'

usePageTitle('目录用户')
const props = defineProps<{ apiPath: string, consolePath: string }>()
const { search, debounced, flush, reset } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
const deptCode = ref('')
const status = ref('active')
const { page, pageSize, resetFilters } = useListPage({ pageSize: 20, filters: { deptCode, status }, defaults: { deptCode: '', status: 'active' } })
const query = computed(() => ({ page: page.value, pageSize, search: debounced.value || undefined, deptCode: deptCode.value || undefined, status: status.value }))
const { data, pending, error, refresh } = await useFetch<{ code: number, data: { items: ConsoleDirectoryUser[], total: number } }>(props.apiPath, { query })
const forbidden = computed(() => error.value?.statusCode === 403)
const selectedUid = ref<string | null>(null)
const detailOpen = ref(false)
const detailPath = computed(() => `${props.apiPath}/${encodeURIComponent(selectedUid.value || '')}`)
const { data: detail, pending: detailPending, error: detailError, execute: loadDetail, clear: clearDetail } = await useFetch<{ code: number, data: ConsoleDirectoryUser }>(detailPath, { immediate: false, watch: false })
async function selectUser(user: ConsoleDirectoryUser) {
  clearDetail()
  selectedUid.value = user.uid
  detailOpen.value = true
  await loadDetail()
}
function resetAll() {
  reset()
  resetFilters()
}
const statusOptions = [{ label: '正常', value: 'active' }, { label: '停用', value: 'inactive' }, { label: '待激活', value: 'pending' }, { label: '已删除', value: 'deleted' }, { label: '全部', value: 'all' }]
</script>

<template>
  <UDashboardPanel id="enterprise-directory-users">
    <template #body>
      <ContentPageHeader hosted title="目录用户" description="查询企业目录与用户资料。">
        <template #actions>
          <UButton
            color="neutral"
            icon="i-lucide-refresh-cw"
            aria-label="刷新用户"
            :loading="pending"
            @click="refresh()"
          />
          <UButton
            :to="consolePath"
            external
            color="neutral"
            variant="outline"
            label="在控制台管理"
          />
        </template>
      </ContentPageHeader>
      <div class="flex flex-wrap gap-2">
        <UInput v-model="search" placeholder="搜索用户" @keyup.enter="flush" />
        <UInput v-model="deptCode" placeholder="部门编码" />
        <USelect v-model="status" :items="statusOptions" aria-label="用户状态" />
        <UButton
          color="neutral"
          variant="ghost"
          label="重置"
          @click="resetAll"
        />
      </div>
      <CommonEmptyState v-if="forbidden" title="无权限" description="你没有查看目录用户的权限。" />
      <UAlert
        v-else-if="error"
        color="error"
        title="目录用户加载失败"
        description="请稍后重试。"
      />
      <template v-else>
        <DirectoryUsersTable :items="data?.data.items || []" :loading="pending" @select="selectUser" />
        <div class="flex flex-wrap items-center justify-between gap-3">
          <span class="text-sm text-muted">共 {{ data?.data.total || 0 }} 条</span>
          <UPagination v-model:page="page" :items-per-page="pageSize" :total="data?.data.total || 0" />
        </div>
      </template>
      <USlideover v-model:open="detailOpen" title="用户资料">
        <template #body>
          <CommonEmptyState v-if="detailError?.statusCode === 403" title="无权限" description="你没有查看这位用户资料的权限。" />
          <UAlert
            v-else-if="detailError"
            color="error"
            title="用户资料加载失败"
            description="请稍后重试。"
          />
          <USkeleton v-else-if="detailPending" class="h-48" />
          <DirectoryUserDetails v-else-if="detail?.data" :user="detail.data" />
        </template>
      </USlideover>
    </template>
  </UDashboardPanel>
</template>
