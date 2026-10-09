<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { ConsoleDirectoryDepartment } from '../types/consoleDirectory'

const props = withDefaults(defineProps<{
  items: Array<ConsoleDirectoryDepartment & { displayLevel: number }>
  loading: boolean
  search?: string
  expandedCodes: Set<string>
  readOnly?: boolean
  detailEnabled?: boolean
  mutating?: boolean
  emptyDescription?: string
}>(), { search: '', readOnly: true, detailEnabled: true, mutating: false, emptyDescription: '调整筛选条件后重试。' })
const emit = defineEmits<{ toggle: [department: ConsoleDirectoryDepartment], select: [department: ConsoleDirectoryDepartment], edit: [department: ConsoleDirectoryDepartment], remove: [department: ConsoleDirectoryDepartment] }>()
const UButton = resolveComponent('UButton')
const UBadge = resolveComponent('UBadge')
const departmentColumns: TableColumn<ConsoleDirectoryDepartment & { displayLevel: number }>[] = [
  {
    accessorKey: 'name',
    header: '部门',
    cell: ({ row }) => {
      const dept = row.original
      return h('div', { class: 'directory-department-label flex items-center gap-2', style: { '--directory-indent': `${dept.displayLevel * 18}px` } }, [
        dept.children?.length
          ? h(UButton, {
              icon: props.expandedCodes.has(dept.deptCode) || props.search ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right',
              color: 'neutral',
              variant: 'ghost',
              size: 'xs',
              onClick: () => emit('toggle', dept)
            })
          : h('span', { class: 'inline-block w-7' }),
        h('div', [
          h('p', { class: 'font-medium text-highlighted' }, dept.name),
          h('p', { class: 'text-xs text-muted' }, dept.deptCode)
        ])
      ])
    }
  },
  {
    accessorKey: 'orgType',
    header: '类型',
    cell: ({ row }) => h(UBadge, { color: 'neutral', variant: 'soft' }, () => row.original.orgType)
  },
  {
    accessorKey: 'manager',
    header: '负责人',
    cell: ({ row }) => row.original.manager || row.original.managerId || '-'
  },
  {
    accessorKey: 'leader',
    header: 'Leader',
    cell: ({ row }) => row.original.leader || row.original.leaderId || '-'
  },
  {
    accessorKey: 'parentId',
    header: '父级',
    cell: ({ row }) => row.original.parentId || '-'
  },
  {
    id: 'actions',
    header: '',
    cell: ({ row }) => props.readOnly
      ? props.detailEnabled ? h(UButton, { color: 'neutral', variant: 'ghost', onClick: () => emit('select', row.original) }, () => '查看') : null
      : h('div', { class: 'flex justify-end gap-1' }, [
          props.detailEnabled ? h(UButton, { color: 'neutral', variant: 'ghost', onClick: () => emit('select', row.original) }, () => '查看') : null,
          h(UButton, {
            color: 'neutral',
            variant: 'ghost',
            size: 'sm',
            icon: 'i-lucide-pencil',
            disabled: props.mutating,
            onClick: () => emit('edit', row.original)
          }, () => '编辑'),
          h(UButton, {
            color: 'error',
            variant: 'ghost',
            size: 'sm',
            icon: 'i-lucide-trash-2',
            disabled: props.mutating,
            onClick: () => emit('remove', row.original)
          }, () => '删除')
        ])
  }
]
</script>

<template>
  <UTable
    sticky
    :data="items"
    :columns="departmentColumns"
    :loading="loading"
    empty="暂无部门"
    class="directory-mobile-table min-w-0 flex-1 max-h-[calc(100svh-16rem)]"
  >
    <template #empty>
      <CommonEmptyState icon="i-lucide-building-2" title="暂无部门" :description="emptyDescription" />
    </template>
  </UTable>
</template>

<style scoped>
:deep(.directory-department-label) { padding-inline-start: var(--directory-indent); }
:deep(td) { max-width: 20rem; overflow: hidden; text-overflow: ellipsis; }
:deep(td p) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

@media (max-width: 639px) {
  .directory-mobile-table :deep(.directory-department-label) { padding-inline-start: min(var(--directory-indent), 2rem); }
  .directory-mobile-table { min-width: 0; width: 100%; }
  .directory-mobile-table :deep(table) { width: 100%; table-layout: fixed; }
  .directory-mobile-table :deep(th), .directory-mobile-table :deep(td) { padding: 0.75rem 0.5rem; white-space: normal; overflow-wrap: anywhere; }
  .directory-mobile-table :deep(td p) { white-space: normal; overflow-wrap: anywhere; }
  .directory-mobile-table :deep(td div) { min-width: 0; }
  .directory-mobile-table :deep(td > div.flex) { flex-wrap: wrap; }
  .directory-mobile-table :deep(th:nth-child(2)), .directory-mobile-table :deep(td:nth-child(2)) { display: none; }
  .directory-mobile-table :deep(th:nth-child(3)), .directory-mobile-table :deep(td:nth-child(3)) { display: none; }
  .directory-mobile-table :deep(th:nth-child(4)), .directory-mobile-table :deep(td:nth-child(4)) { display: none; }
  .directory-mobile-table :deep(th:nth-child(5)), .directory-mobile-table :deep(td:nth-child(5)) { display: none; }
  .directory-mobile-table :deep(th:nth-child(6)) { width: 7rem; }
}
</style>
