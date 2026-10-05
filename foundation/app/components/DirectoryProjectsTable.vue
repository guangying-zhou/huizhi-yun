<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { ConsoleDirectoryProject } from '../types/consoleDirectory'

const props = withDefaults(defineProps<{ items: ConsoleDirectoryProject[], loading?: boolean, readOnly?: boolean, detailEnabled?: boolean, mutating?: boolean, emptyDescription?: string }>(), { readOnly: true, detailEnabled: true, mutating: false, emptyDescription: '调整筛选条件后重试。' })
const emit = defineEmits<{ select: [item: ConsoleDirectoryProject], members: [item: ConsoleDirectoryProject], edit: [item: ConsoleDirectoryProject], remove: [item: ConsoleDirectoryProject] }>()
const UBadge = resolveComponent('UBadge')
const UButton = resolveComponent('UButton')
const ULink = resolveComponent('ULink')
function statusMeta(statusValue: number, statusKey?: string) {
  if (statusValue === 1) return { label: '正常', color: 'success' as const }
  if (statusValue === -1) return { label: '已删除', color: 'error' as const }
  if (statusKey === 'archived') return { label: '归档', color: 'neutral' as const }
  return { label: '停用', color: 'neutral' as const }
}

function projectType(project: ConsoleDirectoryProject) {
  if (project.isTemplate) return '模板'
  if (project.isGroup) return '项目组'
  return '项目'
}

const columns: TableColumn<ConsoleDirectoryProject>[] = [
  {
    accessorKey: 'name',
    header: '项目',
    cell: ({ row }) => h('div', { class: 'flex items-center gap-2' }, [
      h(resolveComponent('UIcon'), {
        name: row.original.isGroup ? 'i-lucide-folder-tree' : 'i-lucide-folder-kanban',
        class: 'size-4 shrink-0 text-muted'
      }),
      h('div', [
        h('div', { class: 'flex items-center gap-1.5' }, [
          h('p', { class: 'font-medium text-highlighted' }, row.original.name),
          row.original.isTemplate
            ? h(UBadge, { color: 'primary', variant: 'subtle', size: 'xs' }, () => '模板')
            : null
        ]),
        h('p', { class: 'text-xs text-muted' }, row.original.projectCode)
      ])
    ])
  },
  {
    accessorKey: 'type',
    header: '类型',
    cell: ({ row }) => h(UBadge, { color: 'neutral', variant: 'soft' }, () => projectType(row.original))
  },
  { accessorKey: 'parentId', header: '父级', cell: ({ row }) => row.original.parentId || '-' },
  { accessorKey: 'deptCode', header: '部门', cell: ({ row }) => row.original.deptCode || '-' },
  { accessorKey: 'leaderUid', header: '负责人', cell: ({ row }) => row.original.leaderUid || row.original.ownerUid || '-' },
  {
    accessorKey: 'repoUrl',
    header: '仓库',
    cell: ({ row }) => props.readOnly
      ? (row.original.repoUrl || '-')
      : row.original.repoUrl && /^https?:\/\//i.test(row.original.repoUrl)
        ? h(ULink, { to: row.original.repoUrl, target: '_blank', class: 'text-primary hover:underline' }, () => '打开')
        : '-'
  },
  {
    accessorKey: 'status',
    header: '状态',
    cell: ({ row }) => {
      const meta = statusMeta(row.original.status, row.original.statusKey)
      return h(UBadge, { color: meta.color, variant: 'soft' }, () => meta.label)
    }
  },
  {
    id: 'members',
    header: '成员',
    cell: ({ row }) => h(UButton, {
      color: 'neutral',
      variant: 'ghost',
      size: 'xs',
      icon: 'i-lucide-users',
      onClick: () => emit('members', row.original),
      disabled: props.mutating
    }, () => props.readOnly ? '查看' : '成员')
  },
  {
    id: 'actions',
    header: '',
    cell: ({ row }) => props.readOnly
      ? h(UButton, { color: 'neutral', variant: 'ghost', size: 'xs', icon: 'i-lucide-eye', onClick: () => emit('select', row.original) }, () => '查看')
      : h('div', { class: 'flex justify-end gap-1' }, [
          props.detailEnabled ? h(UButton, { color: 'neutral', variant: 'ghost', size: 'xs', icon: 'i-lucide-eye', onClick: () => emit('select', row.original) }, () => '查看') : null,
          h(UButton, {
            color: 'neutral',
            variant: 'ghost',
            size: 'xs',
            icon: 'i-lucide-pencil',
            disabled: props.mutating || row.original.status === -1,
            onClick: () => emit('edit', row.original)
          }, () => '编辑'),
          h(UButton, {
            color: 'error',
            variant: 'ghost',
            size: 'xs',
            icon: 'i-lucide-trash-2',
            disabled: props.mutating || row.original.status === -1,
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
    :columns="columns"
    :loading="loading"
    class="directory-mobile-table min-w-0 flex-1 max-h-[calc(100svh-24rem)] rounded-lg border border-default"
  >
    <template #empty>
      <CommonEmptyState icon="i-lucide-folder-kanban" title="暂无项目注册" :description="emptyDescription" />
    </template>
  </UTable>
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
  .directory-mobile-table :deep(th:nth-child(7)), .directory-mobile-table :deep(td:nth-child(7)) { display: none; }
  .directory-mobile-table :deep(th:nth-child(8)) { width: 4rem; }
  .directory-mobile-table :deep(th:nth-child(9)) { width: 7rem; }
}
</style>
