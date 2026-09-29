<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { ConsoleDirectoryProjectMember } from '../types/consoleDirectory'

defineProps<{ items: ConsoleDirectoryProjectMember[], loading?: boolean }>()
const UBadge = resolveComponent('UBadge')
const columns: TableColumn<ConsoleDirectoryProjectMember>[] = [
  {
    accessorKey: 'uid',
    header: '成员',
    cell: ({ row }) => h('div', [
      h('p', { class: 'font-medium text-highlighted' }, row.original.displayName),
      h('p', { class: 'text-xs text-muted' }, row.original.uid)
    ])
  },
  {
    accessorKey: 'role',
    header: '角色',
    cell: ({ row }) => h(UBadge, { color: 'neutral', variant: 'soft' }, () => row.original.role)
  },
  { accessorKey: 'deptName', header: '主部门', cell: ({ row }) => row.original.deptName || row.original.primaryDeptCode || '-' },
  { accessorKey: 'email', header: '邮箱', cell: ({ row }) => row.original.email || '-' },
  { accessorKey: 'joinedAt', header: '加入时间', cell: ({ row }) => row.original.joinedAt || '-' }
]
</script>

<template>
  <UTable
    sticky
    :data="items"
    :columns="columns"
    :loading="loading"
    class="directory-mobile-table rounded-lg border border-default"
  >
    <template #empty>
      <CommonEmptyState icon="i-lucide-users" title="暂无成员" description="该项目尚无目录成员。" />
    </template>
  </UTable>
</template>

<style scoped>
@media (max-width: 639px) {
  .directory-mobile-table { min-width: 0; width: 100%; }
  .directory-mobile-table :deep(table) { width: 100%; table-layout: fixed; }
  .directory-mobile-table :deep(th), .directory-mobile-table :deep(td) { padding: 0.75rem 0.5rem; white-space: normal; overflow-wrap: anywhere; }
  .directory-mobile-table :deep(td p) { white-space: normal; overflow-wrap: anywhere; }
  .directory-mobile-table :deep(td div) { min-width: 0; }
  .directory-mobile-table :deep(td > div.flex) { flex-wrap: wrap; }
  .directory-mobile-table :deep(th:nth-child(3)), .directory-mobile-table :deep(td:nth-child(3)) { display: none; }
  .directory-mobile-table :deep(th:nth-child(4)), .directory-mobile-table :deep(td:nth-child(4)) { display: none; }
  .directory-mobile-table :deep(th:nth-child(5)), .directory-mobile-table :deep(td:nth-child(5)) { display: none; }
  .directory-mobile-table :deep(th:nth-child(2)) { width: 5rem; }
}
</style>
