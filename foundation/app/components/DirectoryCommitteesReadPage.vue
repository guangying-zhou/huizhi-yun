<script setup lang="ts">
import ContentPageHeader from './ContentPageHeader.vue'
import type { ConsoleDirectoryCommittee } from '../types/consoleDirectory'

usePageTitle('委员会')
const props = defineProps<{ apiPath: string, consolePath: string }>()
const { search, debounced, flush, reset } = useDebouncedSearch({ onChange: () => {
  page.value = 1
} })
const status = ref('active')
const { page, pageSize, resetFilters } = useListPage({ pageSize: 20, filters: { status }, defaults: { status: 'active' } })
const query = computed(() => ({ page: page.value, pageSize, search: debounced.value || undefined, status: status.value }))
const { data, pending, error, refresh } = await useFetch<{ code: number, canEdit?: boolean, data: { items: ConsoleDirectoryCommittee[], total: number } }>(props.apiPath, { query })
const writeDenied = ref(0)
const canEdit = computed(() => data.value?.canEdit === true && !error.value && !writeDenied.value)
const forbidden = computed(() => error.value?.statusCode === 403 || writeDenied.value === 403)
const { data: departmentData } = await useFetch<{ code: number, data: { flat: Array<{ deptCode: string, name: string, level: number, orgType: string }> } }>('/enterprise/api/directory/departments')
async function refreshList() {
  await refresh()
  if (error.value) throw error.value
  writeDenied.value = 0
}
async function refreshPage() {
  await refresh()
  if (!error.value) writeDenied.value = 0
}
async function denied(status: number) {
  writeDenied.value = status
  await refresh()
}
function resetAll() {
  reset()
  resetFilters()
}
const statusOptions = [{ label: '启用', value: 'active' }, { label: '停用', value: 'inactive' }, { label: '全部', value: 'all' }]
</script>

<template>
  <UDashboardPanel id="enterprise-directory-committees">
    <template #body>
      <DirectoryCommitteeEditor
        v-slot="editor"
        :api-path="apiPath"
        :committees="data?.data.items || []"
        :departments="departmentData?.data.flat || []"
        :can-edit="canEdit"
        :refresh="refreshList"
        @denied="denied"
      >
        <ContentPageHeader hosted title="委员会" description="查看委员会资料和成员。">
          <template #actions>
            <UButton
              v-if="canEdit"
              icon="i-lucide-plus"
              label="新建委员会"
              :disabled="editor.saving"
              @click="editor.create"
            />
            <UButton
              color="neutral"
              icon="i-lucide-refresh-cw"
              aria-label="刷新委员会"
              :loading="pending"
              @click="refreshPage"
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
          <UInput v-model="search" placeholder="搜索委员会" @keyup.enter="flush" />
          <USelect v-model="status" :items="statusOptions" aria-label="委员会状态" />
          <UButton
            color="neutral"
            variant="ghost"
            label="重置"
            @click="resetAll"
          />
        </div>
        <CommonEmptyState v-if="forbidden" title="无权限" description="你没有查看委员会的权限。" />
        <UAlert
          v-else-if="error || writeDenied"
          color="error"
          title="委员会加载失败"
          description="请稍后重试。"
        />
        <template v-else>
          <DirectoryCommitteesTable
            :items="data?.data.items || []"
            :loading="pending"
            :can-edit="canEdit"
            :mutating="editor.saving"
            @members="editor.members"
            @edit="editor.edit"
            @remove="editor.remove"
          />
          <div class="flex flex-wrap items-center justify-between gap-3">
            <span class="text-sm text-muted">共 {{ data?.data.total || 0 }} 条</span>
            <UPagination v-model:page="page" :items-per-page="pageSize" :total="data?.data.total || 0" />
          </div>
        </template>
      </DirectoryCommitteeEditor>
    </template>
  </UDashboardPanel>
</template>
