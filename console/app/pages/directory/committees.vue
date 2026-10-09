<script setup lang="ts">
import type { ConsoleDirectoryCommittee as DirectoryCommittee } from '@hzy/foundation/app/types/consoleDirectory'
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('委员会')

interface ApiResponse<T> {
  code: number
  data: T
}

interface CommitteeListResponse {
  items: DirectoryCommittee[]
  total: number
  page: number
  pageSize: number
}

const { search, debounced: debouncedSearch, flush: flushSearch, reset: resetSearch } = useDebouncedSearch()
const status = ref('active')
const { page, pageSize, resetFilters: resetListFilters } = useListPage({
  pageSize: 20,
  filters: { search, status },
  defaults: { search: '', status: 'active' }
})

const query = computed(() => ({
  page: page.value,
  pageSize,
  search: debouncedSearch.value || undefined,
  status: status.value
}))

const { data, pending, error, refresh } = await useFetch<ApiResponse<CommitteeListResponse>>(
  '/api/v1/console/directory/committees',
  {
    query,
    default: () => ({
      code: 0,
      data: { items: [], total: 0, page: 1, pageSize }
    })
  }
)
const errorAlert = useApiErrorAlert(error, {
  appName: 'Console',
  fallbackTitle: '委员会加载失败'
})

const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => {
  setRefresh(refreshPage)
})
onBeforeUnmount(clearRefresh)

const { data: departmentData } = await useFetch<ApiResponse<{
  flat: Array<{ deptCode: string, name: string, level: number, orgType: string }>
}>>('/api/v1/console/directory/departments', {
  default: () => ({ code: 0, data: { flat: [] } })
})

const committees = computed(() => data.value?.data.items || [])
const total = computed(() => data.value?.data.total || 0)

const statusOptions = [
  { label: '启用', value: 'active' },
  { label: '停用', value: 'inactive' },
  { label: '全部', value: 'all' }
]
function resetFilters() {
  resetSearch()
  resetListFilters()
}
const { loaded: permissionsLoaded, loadPermissions, hasPermission, clearCache } = usePermissions()
if (!permissionsLoaded.value) await loadPermissions()
const writeDenied = ref(false)
const canEdit = computed(() => permissionsLoaded.value && hasPermission('directory_departments', 'edit') && !error.value && !writeDenied.value)
async function refreshList() {
  await refresh()
  if (error.value) throw error.value
  writeDenied.value = false
}
async function refreshPage() {
  clearCache()
  await loadPermissions()
  await refreshList()
}
async function denied() {
  writeDenied.value = true
  clearCache()
  await loadPermissions()
  await refresh()
}
</script>

<template>
  <UDashboardPanel id="directory-committees" :ui="dashboardPanelUi">
    <template #body>
      <DirectoryCommitteeEditor
        v-slot="editor"
        api-path="/api/v1/console/directory/committees"
        :committees="committees"
        :departments="departmentData?.data.flat || []"
        :can-edit="canEdit"
        :refresh="refreshList"
        @denied="denied"
      >
        <UCard>
          <template #header>
            <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div class="grid min-w-0 flex-1 gap-2 sm:grid-cols-2 lg:max-w-2xl">
                <UInput
                  v-model="search"
                  icon="i-lucide-search"
                  placeholder="搜索委员会编码 / 名称"
                  @keyup.enter="flushSearch"
                />
                <USelect
                  v-model="status"
                  :items="statusOptions"
                />
              </div>
              <div class="flex flex-wrap justify-end gap-2">
                <UButton
                  color="neutral"
                  variant="soft"
                  icon="i-lucide-rotate-ccw"
                  @click="resetFilters"
                >
                  重置
                </UButton>
                <UButton
                  v-if="canEdit"
                  color="primary"
                  icon="i-lucide-plus"
                  :disabled="editor.saving"
                  @click="editor.create"
                >
                  新建委员会
                </UButton>
              </div>
            </div>
          </template>

          <UAlert
            v-if="errorAlert"
            :color="errorAlert.color"
            variant="soft"
            :icon="errorAlert.icon"
            :title="errorAlert.title"
            :description="errorAlert.description"
            class="mb-3"
          />

          <div class="overflow-x-auto">
            <DirectoryCommitteesTable
              :items="committees"
              :loading="pending"
              :can-edit="canEdit"
              :mutating="editor.saving"
              empty-description="调整筛选条件，或新建一个委员会并添加成员。"
              @members="editor.members"
              @edit="editor.edit"
              @remove="editor.remove"
            />
          </div>

          <div
            v-if="total > 0"
            class="mt-4 flex flex-col gap-3 border-t border-default pt-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <span class="text-sm text-muted">共 {{ total }} 条</span>
            <UPagination
              v-model:page="page"
              :items-per-page="pageSize"
              :total="total"
            />
          </div>
        </UCard>
      </DirectoryCommitteeEditor>
    </template>
  </UDashboardPanel>
</template>
