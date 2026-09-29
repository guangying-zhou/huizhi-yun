<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { ConsoleDirectoryCommittee, ConsoleCommitteeStatus } from '../types/consoleDirectory'

const props = withDefaults(defineProps<{ items: ConsoleDirectoryCommittee[], loading?: boolean, canEdit?: boolean, mutating?: boolean, emptyDescription?: string }>(), { canEdit: false, mutating: false, emptyDescription: '调整筛选条件后重试。' })
const emit = defineEmits<{ members: [item: ConsoleDirectoryCommittee], edit: [item: ConsoleDirectoryCommittee], remove: [item: ConsoleDirectoryCommittee] }>()
const UButton = resolveComponent('UButton')
const UBadge = resolveComponent('UBadge')
function statusMeta(value: ConsoleCommitteeStatus) {
  if (value === 'active') return { label: '启用', color: 'success' as const }
  if (value === 'deleted') return { label: '已删除', color: 'error' as const }
  return { label: '停用', color: 'neutral' as const }
}

const columns: TableColumn<ConsoleDirectoryCommittee>[] = [
  {
    accessorKey: 'name',
    header: '委员会',
    cell: ({ row }) => h('div', { class: 'min-w-44' }, [
      h('p', { class: 'font-medium text-highlighted' }, row.original.name),
      h('p', { class: 'text-xs text-muted' }, row.original.committeeCode)
    ])
  },
  {
    accessorKey: 'parentDeptName',
    header: '归属部门',
    cell: ({ row }) => row.original.parentDeptName || row.original.parentDeptCode || '-'
  },
  {
    accessorKey: 'leaderName',
    header: '主任',
    cell: ({ row }) => row.original.leaderName || row.original.leaderUid || '-'
  },
  {
    accessorKey: 'managerName',
    header: '秘书',
    cell: ({ row }) => row.original.managerName || row.original.managerUid || '-'
  },
  {
    accessorKey: 'memberCount',
    header: '成员',
    cell: ({ row }) => h(UButton, {
      color: 'neutral',
      variant: 'soft',
      size: 'xs',
      icon: 'i-lucide-users',
      disabled: props.mutating,
      onClick: () => emit('members', row.original)
    }, () => `${row.original.memberCount} 人`)
  },
  {
    accessorKey: 'status',
    header: '状态',
    cell: ({ row }) => {
      const meta = statusMeta(row.original.status)
      return h(UBadge, { color: meta.color, variant: 'soft' }, () => meta.label)
    }
  },
  {
    id: 'actions',
    header: '',
    cell: ({ row }) => h('div', { class: 'flex justify-end gap-1' }, [
      h(UButton, {
        ...{ 'aria-label': `查看${row.original.name}成员` },
        color: 'neutral',
        variant: 'ghost',
        size: 'xs',
        icon: 'i-lucide-users',
        disabled: props.mutating,
        onClick: () => emit('members', row.original)
      }, () => props.canEdit ? '成员' : '查看'),
      props.canEdit
        ? h(UButton, {
            ...{ 'aria-label': `编辑${row.original.name}` },
            color: 'neutral',
            variant: 'ghost',
            size: 'xs',
            icon: 'i-lucide-pencil',
            disabled: props.mutating || row.original.status === 'deleted',
            onClick: () => emit('edit', row.original)
          }, () => '编辑')
        : null,
      props.canEdit
        ? h(UButton, {
            ...{ 'aria-label': `删除${row.original.name}` },
            color: 'error',
            variant: 'ghost',
            size: 'xs',
            icon: 'i-lucide-trash-2',
            disabled: props.mutating || row.original.status === 'deleted',
            onClick: () => emit('remove', row.original)
          }, () => '删除')
        : null
    ])
  }
]
</script>

<template>
  <div class="overflow-x-auto">
    <UTable
      sticky
      :data="items"
      :columns="columns"
      :loading="loading"
      class="directory-mobile-table min-w-[920px] rounded-lg border border-default"
    >
      <template #empty>
        <CommonEmptyState icon="i-lucide-users-round" title="暂无委员会" :description="emptyDescription" />
      </template>
    </UTable>
  </div>
</template>

<style scoped>
:deep(td) { max-width: 20rem; overflow: hidden; text-overflow: ellipsis; }
:deep(td p) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

@media (max-width: 639px) {
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
  .directory-mobile-table :deep(th:nth-child(6)), .directory-mobile-table :deep(td:nth-child(6)) { display: none; }
  .directory-mobile-table :deep(th:nth-child(7)) { width: 7rem; }
}
</style>
