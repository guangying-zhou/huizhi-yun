<script setup lang="ts">
import { flattenDepartmentTree } from '@hzy/foundation/shared/utils/consoleDepartmentTree'
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('部门')

interface DirectoryDepartment {
  id?: number
  deptCode: string
  name: string
  parentId: string | null
  level: number
  orgType: string
  deptCategory: string | null
  managerId: string | null
  manager: string | null
  leaderId: string | null
  leader: string | null
  sortOrder?: number
  description?: string | null
  children: DirectoryDepartment[]
}

interface DirectoryDepartmentsResponse {
  tree: DirectoryDepartment[]
  flat: DirectoryDepartment[]
}

interface ApiResponse<T> {
  code: number
  data: T
}

const search = ref('')
const expandedCodes = ref<Set<string>>(new Set())
const { data, pending, error, refresh } = await useFetch<ApiResponse<DirectoryDepartmentsResponse>>('/api/v1/console/directory/departments', {
  default: () => ({ code: 0, data: { tree: [], flat: [] } })
})

const flatDepartments = computed(() => data.value?.data.flat || [])
const treeDepartments = computed(() => data.value?.data.tree || [])

watch(treeDepartments, (nodes) => {
  if (expandedCodes.value.size > 0) return
  const next = new Set<string>()
  const visit = (items: DirectoryDepartment[]) => {
    for (const item of items) {
      if (item.children?.length) next.add(item.deptCode)
      visit(item.children || [])
    }
  }
  visit(nodes)
  expandedCodes.value = next
}, { immediate: true })

function toggle(dept: DirectoryDepartment) {
  const next = new Set(expandedCodes.value)
  if (next.has(dept.deptCode)) next.delete(dept.deptCode)
  else next.add(dept.deptCode)
  expandedCodes.value = next
}

const visibleDepartments = computed(() => flattenDepartmentTree(treeDepartments.value, search.value, expandedCodes.value))

function expandAll() {
  expandedCodes.value = new Set(flatDepartments.value.map(dept => dept.deptCode))
}

function collapseAll() {
  expandedCodes.value = new Set()
}

const { loaded, loadPermissions, hasPermission, clearCache } = usePermissions()
if (!loaded.value) await loadPermissions()
const canEdit = computed(() => loaded.value && hasPermission('directory_departments', 'edit') && !error.value)
async function refreshList() {
  await refresh()
  if (error.value) throw error.value
}
async function denied() {
  clearCache()
  await loadPermissions()
  await refresh()
}
</script>

<template>
  <UDashboardPanel id="directory-departments" :ui="dashboardPanelUi">
    <!-- <template #header>
      <UDashboardNavbar title="目录部门">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>

        </template>
      </UDashboardNavbar>
    </template> -->

    <template #body>
      <DirectoryDepartmentEditor
        v-slot="editor"
        api-path="/api/v1/console/directory/departments"
        :departments="flatDepartments"
        :can-edit="canEdit"
        :refresh="refreshList"
        @denied="denied"
      >
        <div class="grid gap-3 md:grid-cols-3">
          <UCard>
            <p class="text-xs text-muted">
              部门节点
            </p>
            <p class="mt-1 text-2xl font-semibold">
              {{ flatDepartments.length }}
            </p>
          </UCard>
          <UCard>
            <p class="text-xs text-muted">
              根节点
            </p>
            <p class="mt-1 text-2xl font-semibold">
              {{ treeDepartments.length }}
            </p>
          </UCard>
          <UCard>
            <p class="text-xs text-muted">
              当前模式
            </p>
            <p class="mt-1 text-lg font-semibold">
              可维护
            </p>
          </UCard>
        </div>

        <div>
          <div class="flex items-center gap-2 mb-3">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div class="flex flex-col gap-2 sm:flex-row">
                <UInput
                  v-model="search"
                  icon="i-lucide-search"
                  placeholder="搜索部门 / 负责人"
                  class="sm:w-72"
                />
                <UButton color="neutral" variant="soft" @click="expandAll">
                  全部展开
                </UButton>
                <UButton color="neutral" variant="soft" @click="collapseAll">
                  全部收起
                </UButton>
                <UButton
                  icon="i-lucide-refresh-cw"
                  color="neutral"
                  variant="ghost"
                  :loading="pending"
                  @click="refresh()"
                >
                  刷新
                </UButton>
                <UButton
                  v-if="canEdit"
                  color="primary"
                  icon="i-lucide-plus"
                  :disabled="editor.saving"
                  @click="editor.create"
                >
                  新建部门
                </UButton>
              </div>
            </div>
          </div>

          <UAlert
            v-if="error"
            color="error"
            variant="soft"
            title="加载失败"
            :description="error.message"
            class="mb-3"
          />

          <DirectoryDepartmentsTable
            :items="visibleDepartments"
            :loading="pending"
            :search="search"
            :expanded-codes="expandedCodes"
            :read-only="!canEdit"
            :detail-enabled="false"
            :mutating="editor.saving"
            empty-description="新建部门或运行目录同步后会显示在这里。"
            @toggle="toggle"
            @edit="editor.edit"
            @remove="editor.remove"
          />
        </div>
      </DirectoryDepartmentEditor>
    </template>
  </UDashboardPanel>
</template>
