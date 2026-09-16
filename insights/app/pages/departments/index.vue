<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { h } from 'vue'

const { apiBase } = useApiBase()
const toast = useToast()

const UBadge = resolveComponent('UBadge')
const UButton = resolveComponent('UButton')

interface Department {
  id: number
  name: string
  code?: string
  parentId?: number
  isActive: boolean
  isExternal: boolean
  managerId?: number
  manager?: string
  leaderId?: number
  leader?: string
}

const departments = ref<Department[]>([])
const loading = ref(false)

async function loadDepartments() {
  loading.value = true
  try {
    const result = await $fetch<{ data: Department[] }>(`${apiBase}/departments`)
    departments.value = result.data ?? []
  } catch (error: any) {
    toast.add({
      title: '加载部门列表失败',
      description: error?.data?.message || error?.message || '未知错误',
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

const activeDepartments = computed(() =>
  departments.value.filter(d => d.isActive)
)

const columns: TableColumn<Department>[] = [
  { accessorKey: 'id', header: 'ID', meta: { class: { th: 'w-16', td: 'text-muted' } } },
  { accessorKey: 'name', header: '部门名称' },
  {
    accessorKey: 'code',
    header: '编码',
    cell: ({ row }) => row.original.code || '-'
  },
  {
    accessorKey: 'manager',
    header: '负责人',
    cell: ({ row }) => row.original.manager || '-'
  },
  {
    accessorKey: 'leader',
    header: '主管',
    cell: ({ row }) => row.original.leader || '-'
  },
  {
    accessorKey: 'isExternal',
    header: '外部',
    cell: ({ row }) => h(UBadge, {
      label: row.original.isExternal ? '是' : '否',
      color: row.original.isExternal ? 'warning' : 'neutral',
      variant: 'subtle',
      size: 'sm'
    })
  },
  {
    accessorKey: 'isActive',
    header: '状态',
    cell: ({ row }) => h(UBadge, {
      label: row.original.isActive ? '启用' : '停用',
      color: row.original.isActive ? 'success' : 'error',
      variant: 'subtle',
      size: 'sm'
    })
  },
  {
    id: 'actions',
    header: '操作',
    cell: ({ row }) => h('div', { class: 'flex gap-1' }, [
      h(UButton, {
        icon: 'i-lucide-bar-chart-3',
        size: 'xs',
        variant: 'ghost',
        color: 'neutral',
        to: `/dashboard/departments`
      }),
      h(UButton, {
        icon: 'i-lucide-settings',
        size: 'xs',
        variant: 'ghost',
        color: 'neutral',
        to: `/settings/departments`
      })
    ])
  }
]

onMounted(() => loadDepartments())
</script>

<template>
  <UDashboardPanel grow>
    <UDashboardNavbar title="部门概览">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
      <template #right>
        <span class="text-xs text-muted">
          {{ activeDepartments.length }} 个活跃部门 / 共 {{ departments.length }} 个
        </span>
        <UButton
          label="部门分析"
          icon="i-lucide-bar-chart-3"
          size="sm"
          variant="outline"
          to="/dashboard/departments"
        />
        <UButton
          label="部门管理"
          icon="i-lucide-settings"
          size="sm"
          variant="outline"
          to="/settings/departments"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          variant="ghost"
          size="sm"
          :loading="loading"
          @click="loadDepartments"
        />
      </template>
    </UDashboardNavbar>

    <div class="p-4">
      <UCard :ui="{ body: 'p-0' }">
        <UTable
          :columns="columns"
          :data="departments"
          :loading="loading"
          sticky
          class="max-h-[calc(100vh-180px)]"
        />
        <div
          v-if="!loading && departments.length === 0"
          class="py-10 text-center text-muted"
        >
          暂无部门数据
        </div>
      </UCard>
    </div>
  </UDashboardPanel>
</template>
