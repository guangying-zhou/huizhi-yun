<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { h, ref, reactive, computed, onMounted } from 'vue'

// Import modal component
import ContributorAttributionModal from '~/components/repoinsight/settings/ContributorAttributionModal.vue'

const { apiBase } = useApiBase()
const toast = useToast()

const UButton = resolveComponent('UButton')
const UBadge = resolveComponent('UBadge')
const USwitch = resolveComponent('USwitch')

interface Contributor {
  id: number
  username: string
  realName?: string
  email?: string
  departmentId?: number
  departmentName?: string
  parentId?: number
  parentName?: string
  isActive: boolean
  isCoder: boolean
  firstCommitAt?: string

  lastCommitAt?: string
}

interface Department {
  id: number
  name: string
  isActive: boolean
}
interface PrimaryContributor { id: number, name: string }
interface TablePaginationState { pageIndex: number, pageSize: number }

const contributors = ref<Contributor[]>([])
const primaryContributors = ref<PrimaryContributor[]>([])
const loading = ref(false)
const syncing = ref(false)
const tablePagination = ref<TablePaginationState>({ pageIndex: 0, pageSize: 10000 })

async function syncFromAccount() {
  syncing.value = true
  try {
    const result = await $fetch<{ success: boolean, message: string }>('/api/sync/contributors', { method: 'POST' })
    toast.add({ title: result.message, color: 'success' })
    await loadContributors()
  } catch (error: any) {
    toast.add({ title: '同步失败', description: error.data?.message || error.message, color: 'error' })
  } finally {
    syncing.value = false
  }
}

const filters = reactive({ search: '', isActive: '1', deptId: 0, showAliases: false })

const showAttributionModal = ref(false)
const activeAttributionRow = ref<Contributor | null>(null)

const { data: departmentsData } = useFetch<{ data: Department[] }>(`${apiBase}/departments`)
const USelect = resolveComponent('USelect')

// ... interface ...

const departments = computed(() => departmentsData.value?.data ?? [])
const allDeptOptions = computed(() => departments.value.map(d => ({
  label: d.isActive ? d.name : `${d.name} (已停用)`,
  value: d.id
})))

const deptOptions = computed(() => [
  { label: '全部部门', value: 0 },
  ...allDeptOptions.value
])
const editDeptOptions = computed(() => [
  { label: '未分配', value: 0 },
  ...allDeptOptions.value
])
// Load primary contributors logic... (keep as is or simplify?)
// USelectMenu not needed
async function loadPrimaryContributors() {
  try {
    // Fetch all primary contributors for the dropdown (active or inactive)
    const result = await $fetch<Contributor[]>(`${apiBase}/contributors`)
    const list = Array.isArray(result) ? result : (result as any).data ?? []
    primaryContributors.value = list.map(c => ({ id: c.id, name: c.realName || c.username }))
  } catch (e) {
    console.error('Failed to load primary contributors', e)
  }
}

async function loadContributors() {
  loading.value = true
  try {
    const params: Record<string, any> = { includeSecondary: filters.showAliases, pageSize: 10000, page: 1 }
    if (filters.isActive !== 'all') params.isActive = filters.isActive
    if (Number.isFinite(filters.deptId) && Number(filters.deptId) > 0) params.deptId = Number(filters.deptId)
    const result = await $fetch<Contributor[]>(`${apiBase}/contributors`, { params })
    contributors.value = Array.isArray(result) ? result : (result as any).data ?? []
  } catch (error: any) {
    toast.add({ title: '加载失败', description: error.message, color: 'error' })
  } finally {
    loading.value = false
  }
}

function normalizeDeptValue(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  if (value && typeof value === 'object' && 'value' in value) {
    return normalizeDeptValue((value as { value?: unknown }).value)
  }

  return 0
}

const filteredContributors = computed(() => {
  let data = [...contributors.value]

  if (filters.isActive !== 'all') {
    const active = filters.isActive === '1'
    data = data.filter(c => c.isActive === active)
  }

  if (filters.deptId > 0) {
    data = data.filter(c => (c.departmentId ?? 0) === filters.deptId)
  }

  if (filters.search) {
    const s = filters.search.toLowerCase()
    data = data.filter(c => c.username.toLowerCase().includes(s) || c.realName?.toLowerCase().includes(s))
  }

  return data
})

async function updateContributor(id: number, updates: Partial<Contributor>) {
  try {
    await ($fetch as any)(`${apiBase}/contributors/${id}`, { method: 'PATCH', body: updates })
    await loadContributors()
    toast.add({ title: '更新成功', color: 'success' })
  } catch (error: any) {
    toast.add({ title: '更新失败', description: error.message, color: 'error' })
  }
}

const columns = computed<TableColumn<Contributor>[]>(() => [
  { accessorKey: 'username', header: '用户名' },
  { accessorKey: 'realName', header: '姓名', cell: ({ row }) => row.original.realName || '-' },
  {
    accessorKey: 'parentName',
    header: '归属人',
    cell: ({ row }) => h(UButton, {
      variant: 'ghost',
      size: 'xs',
      color: row.original.parentId ? 'primary' : 'neutral',
      label: row.original.parentName || '归并',
      onClick: () => {
        console.log('Opening attributing modal for', row.original)
        activeAttributionRow.value = row.original
        showAttributionModal.value = true
      }
    })
  },
  {
    accessorKey: 'departmentName',
    header: '部门',
    cell: ({ row }) => h(USelect, {
      'modelValue': row.original.departmentId || 0,
      'items': editDeptOptions.value,
      'value-key': 'value',
      'label-key': 'label',
      'size': 'xs',
      'class': 'min-w-[120px]',
      'onUpdate:modelValue': (value: unknown) => {
        const departmentId = normalizeDeptValue(value)
        updateContributor(row.original.id, { departmentId: departmentId === 0 ? null : departmentId } as any)
      }
    })
  },
  { accessorKey: 'email', header: '邮箱', cell: ({ row }) => row.original.email || '-' },
  { accessorKey: 'isActive', header: '有效', cell: ({ row }) => h(USwitch, { 'modelValue': row.original.isActive, 'size': 'xs', 'onUpdate:modelValue': (v: boolean) => updateContributor(row.original.id, { isActive: v }) }) },
  { accessorKey: 'isCoder', header: '程序员', cell: ({ row }) => h(USwitch, { 'modelValue': row.original.isCoder, 'size': 'xs', 'onUpdate:modelValue': (v: boolean) => updateContributor(row.original.id, { isCoder: v }) }) }
])

watch([() => filters.isActive, () => filters.deptId, () => filters.showAliases], () => {
  loadContributors()
})
onMounted(() => {
  loadContributors()
  loadPrimaryContributors()
})
</script>

<template>
  <UDashboardPanel grow>
    <UDashboardNavbar title="贡献者管理">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
      <template #right>
        <UButton
          icon="i-lucide-cloud-download"
          label="从Account同步"
          size="sm"
          variant="outline"
          :loading="syncing"
          @click="syncFromAccount"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="ghost"
          size="sm"
          :loading="loading"
          @click="loadContributors"
        />
      </template>
    </UDashboardNavbar>

    <UDashboardToolbar>
      <template #left>
        <UInput
          v-model="filters.search"
          placeholder="搜索..."
          icon="i-lucide-search"
          size="sm"
          class="w-64"
        />
        <USelect
          v-model="filters.deptId"
          :items="deptOptions"
          value-key="value"
          label-key="label"
          size="sm"
          class="min-w-37.5"
          @update:model-value="(value: unknown) => { filters.deptId = normalizeDeptValue(value) }"
        />
        <USelect
          v-model="filters.isActive"
          :items="[{ label: '有效', value: '1' }, { label: '无效', value: '0' }, { label: '全部', value: 'all' }]"
          value-key="value"
          label-key="label"
          size="sm"
          class="w-24"
        />
        <div class="flex items-center gap-2 ml-2">
          <span class="text-sm text-gray-500">显示别名</span>
          <USwitch
            v-model="filters.showAliases"
            size="sm"
          />
        </div>
      </template>
      <template #right>
        <UBadge
          variant="soft"
          color="neutral"
        >
          {{ filteredContributors.length }} 人
        </UBadge>
      </template>
    </UDashboardToolbar>

    <div class="p-4">
      <UCard :ui="{ body: 'p-0' }">
        <UTable
          :columns="columns"
          :data="filteredContributors"
          v-model:pagination="tablePagination"
          :loading="loading"
          sticky
          class="h-[calc(100vh-200px)]"
        />
        <div
          v-if="!loading && filteredContributors.length === 0"
          class="py-10 text-center text-muted-500"
        >
          暂无数据
        </div>
      </UCard>
    </div>

    <ContributorAttributionModal
      v-if="activeAttributionRow"
      v-model:open="showAttributionModal"
      :current-parent-id="activeAttributionRow.parentId"
      :contributors="primaryContributors"
      @select="(id) => updateContributor(activeAttributionRow!.id, { parentId: id } as any)"
    />
  </UDashboardPanel>
</template>
