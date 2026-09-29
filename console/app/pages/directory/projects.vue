<script setup lang="ts">
import type { ConsoleDirectoryProject as DirectoryProject } from '@hzy/foundation/app/types/consoleDirectory'
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('项目注册表')

interface DirectoryProjectsResponse {
  items: DirectoryProject[]
  flat: DirectoryProject[]
  total: number
}

interface ApiResponse<T> {
  code: number
  data: T
}

const { search, debounced: debouncedSearch, flush: flushSearch, reset: resetSearch } = useDebouncedSearch()
const deptCode = ref('')
const leaderUid = ref('')
const status = ref('active')
const typeFilter = ref('all')
const { page, pageSize, resetFilters: resetListFilters } = useListPage({
  pageSize: 20,
  filters: { search, deptCode, leaderUid, status, typeFilter },
  defaults: { search: '', deptCode: '', leaderUid: '', status: 'active', typeFilter: 'all' }
})
const query = computed(() => ({
  page: page.value,
  pageSize,
  search: debouncedSearch.value || undefined,
  deptCode: deptCode.value || undefined,
  leaderUid: leaderUid.value || undefined,
  status: status.value,
  onlyGroup: typeFilter.value === 'group' ? '1' : undefined,
  includeTemplate: typeFilter.value === 'template' || typeFilter.value === 'all' ? '1' : '0'
}))

const { data, pending, error, refresh } = await useFetch<ApiResponse<DirectoryProjectsResponse>>('/api/v1/console/directory/projects', {
  query,
  default: () => ({ code: 0, data: { items: [], flat: [], total: 0 } })
})
const errorAlert = useApiErrorAlert(error, {
  appName: 'Console',
  fallbackTitle: '项目注册表加载失败'
})

const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => {
  setRefresh(refreshPage)
})
onBeforeUnmount(clearRefresh)

const { data: departmentData } = await useFetch<ApiResponse<{ flat: Array<{ deptCode: string, name: string, level: number, orgType: string }> }>>(
  '/api/v1/console/directory/departments',
  {
    default: () => ({ code: 0, data: { flat: [] } })
  }
)

const projects = computed(() => data.value?.data.flat || [])
const visibleProjects = computed(() => projects.value)
const total = computed(() => data.value?.data.total || 0)
const groupCount = computed(() => projects.value.filter(project => project.isGroup).length)
const templateCount = computed(() => projects.value.filter(project => project.isTemplate).length)
const rootCount = computed(() => projects.value.filter(project => !project.parentId).length)

const statusOptions = [
  { label: '正常', value: 'active' },
  { label: '归档', value: 'archived' },
  { label: '停用', value: 'inactive' },
  { label: '已删除', value: 'deleted' },
  { label: '全部', value: 'all' }
]
const typeOptions = [
  { label: '全部', value: 'all' },
  { label: '项目组', value: 'group' },
  { label: '不含模板', value: 'project' },
  { label: '含模板', value: 'template' }
]
function resetFilters() {
  resetSearch()
  resetListFilters()
}

const { loaded: permissionsLoaded, loadPermissions, hasPermission, clearCache } = usePermissions()
if (!permissionsLoaded.value) await loadPermissions()
const writeDenied = ref(false)
const canEdit = computed(() => permissionsLoaded.value && hasPermission('directory_projects', 'edit') && !error.value && !writeDenied.value)
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
  <UDashboardPanel id="directory-projects" :ui="dashboardPanelUi">
    <!-- <template #header>
      <UDashboardNavbar title="项目注册表">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            :loading="pending"
            @click="refresh()"
          >
            刷新
          </UButton>
        </template>
      </UDashboardNavbar>
    </template> -->

    <template #body>
      <DirectoryProjectEditor
        v-slot="editor"
        api-path="/api/v1/console/directory/projects"
        :projects="projects"
        :departments="departmentData?.data.flat || []"
        :can-edit="canEdit"
        :refresh="refreshList"
        @denied="denied"
      >
        <div class="grid gap-3 md:grid-cols-4">
          <UCard>
            <p class="text-xs text-muted">
              注册项目
            </p>
            <p class="mt-1 text-2xl font-semibold">
              {{ total }}
            </p>
          </UCard>
          <UCard>
            <p class="text-xs text-muted">
              当前页项目组
            </p>
            <p class="mt-1 text-2xl font-semibold">
              {{ groupCount }}
            </p>
          </UCard>
          <UCard>
            <p class="text-xs text-muted">
              当前页模板
            </p>
            <p class="mt-1 text-2xl font-semibold">
              {{ templateCount }}
            </p>
          </UCard>
          <UCard>
            <p class="text-xs text-muted">
              当前页根节点
            </p>
            <p class="mt-1 text-2xl font-semibold">
              {{ rootCount }}
            </p>
          </UCard>
        </div>

        <UCard>
          <template #header>
            <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div class="flex flex-col gap-2">
                <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  <UInput
                    v-model="search"
                    icon="i-lucide-search"
                    placeholder="搜索项目编码 / 名称"
                    @keyup.enter="flushSearch"
                  />
                  <UInput
                    v-model="deptCode"
                    placeholder="部门编码"
                  />
                  <UInput
                    v-model="leaderUid"
                    placeholder="负责人 UID"
                  />
                  <USelect
                    v-model="status"
                    :items="statusOptions"
                  />
                  <USelect
                    v-model="typeFilter"
                    :items="typeOptions"
                  />
                </div>
                <div class="flex justify-end gap-2">
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
                    @click="editor.create"
                  >
                    新建项目
                  </UButton>
                </div>
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

          <DirectoryProjectsTable
            :items="visibleProjects"
            :loading="pending"
            :read-only="!canEdit"
            :detail-enabled="false"
            :mutating="editor.saving"
            empty-description="调整筛选条件，或新建一个项目注册。"
            @members="editor.members"
            @edit="editor.edit"
            @remove="editor.remove"
          />

          <div
            v-if="total > 0"
            class="mt-4 flex items-center justify-between border-t border-default pt-4"
          >
            <span class="text-sm text-muted">共 {{ total }} 条</span>
            <UPagination
              v-model:page="page"
              :items-per-page="pageSize"
              :total="total"
            />
          </div>
        </UCard>
      </DirectoryProjectEditor>
    </template>
  </UDashboardPanel>
</template>
