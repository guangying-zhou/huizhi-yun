<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { h } from 'vue'
import { formatDate } from '~/utils/log'

const { apiBase } = useApiBase()
const toast = useToast()

const UBadge = resolveComponent('UBadge')

interface Contributor {
  id: number
  name: string
  realName?: string
  username: string
  email?: string
  parentId?: number
  parentName?: string
  departmentId?: number
  departmentName?: string
  isCoder: boolean
  isActive: boolean
  firstCommitAt?: string
  lastCommitAt?: string
}

interface Department {
  id: number
  name: string
  code?: string
  isActive: boolean
}

const search = ref('')
const deptId = ref<number>(0)
const paging = reactive({ page: 1, pageSize: 50 })
const contributors = ref<Contributor[]>([])
const loading = ref(false)

// Fetch departments for filter dropdown
const { data: departmentsResponse } = useAsyncData(
  'contributorDepartments',
  () => $fetch<{ data: Department[] }>(`${apiBase}/departments`),
  { server: false }
)

const deptFilterOptions = computed(() => [
  { label: '全部部门', value: 0 },
  ...(departmentsResponse.value?.data ?? [])
    .filter(d => d.isActive)
    .map(d => ({ label: d.name, value: d.id }))
])

async function loadContributors() {
  loading.value = true
  try {
    const params: Record<string, string | number> = {
      page: paging.page,
      pageSize: paging.pageSize
    }
    if (search.value) params.search = search.value
    if (deptId.value) params.deptId = deptId.value

    const result = await $fetch<Contributor[]>(`${apiBase}/contributors`, { params })
    contributors.value = result ?? []
  } catch (error: any) {
    toast.add({
      title: '加载贡献者列表失败',
      description: error?.data?.message || error?.message || '未知错误',
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

const columns: TableColumn<Contributor>[] = [
  { accessorKey: 'id', header: 'ID', meta: { class: { th: 'w-16', td: 'text-muted' } } },
  {
    accessorKey: 'realName',
    header: '姓名',
    cell: ({ row }) => row.original.realName || row.original.name || '-'
  },
  { accessorKey: 'username', header: '用户名' },
  {
    accessorKey: 'email',
    header: '邮箱',
    cell: ({ row }) => row.original.email || '-'
  },
  {
    accessorKey: 'departmentName',
    header: '部门',
    cell: ({ row }) => row.original.departmentName || '未分配'
  },
  {
    accessorKey: 'isCoder',
    header: '编码人员',
    cell: ({ row }) => h(UBadge, {
      label: row.original.isCoder ? '是' : '否',
      color: row.original.isCoder ? 'success' : 'neutral',
      variant: 'subtle',
      size: 'sm'
    })
  },
  {
    accessorKey: 'lastCommitAt',
    header: '最近提交时间',
    cell: ({ row }) => formatDate(row.original.lastCommitAt ?? null)
  }
]

watch([deptId], () => {
  paging.page = 1
  loadContributors()
})

watchDebounced(
  search,
  () => {
    paging.page = 1
    loadContributors()
  },
  { debounce: 300, maxWait: 1000 }
)

onMounted(() => loadContributors())
</script>

<template>
  <UDashboardPanel grow>
    <UDashboardNavbar title="贡献者列表">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
      <template #right>
        <span class="text-xs text-muted">
          共 {{ contributors.length }} 人
        </span>
        <UButton
          icon="i-lucide-refresh-cw"
          variant="ghost"
          size="sm"
          :loading="loading"
          @click="loadContributors"
        />
      </template>
    </UDashboardNavbar>

    <div class="flex items-center gap-3 px-4 pt-3">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="搜索姓名、用户名、邮箱..."
        size="sm"
        class="w-64"
      />
      <USelect
        v-model="deptId"
        :items="deptFilterOptions"
        value-key="value"
        label-key="label"
        size="sm"
        class="min-w-[140px]"
      />
    </div>

    <div class="p-4">
      <UCard :ui="{ body: 'p-0' }">
        <UTable
          :columns="columns"
          :data="contributors"
          :loading="loading"
          sticky
          class="max-h-[calc(100vh-220px)]"
        />
        <div
          v-if="!loading && contributors.length === 0"
          class="py-10 text-center text-muted"
        >
          暂无贡献者数据
        </div>
      </UCard>
    </div>
  </UDashboardPanel>
</template>
