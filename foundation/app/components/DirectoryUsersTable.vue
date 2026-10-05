<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { ConsoleDirectoryUser } from '../types/consoleDirectory'
import { resolveAvatarSrc } from '../composables/useAvatar'

const props = withDefaults(defineProps<{
  items: ConsoleDirectoryUser[]
  loading: boolean
  actionLabel?: string
  actionIcon?: string
  emptyDescription?: string
}>(), { actionLabel: '查看', actionIcon: 'i-lucide-eye', emptyDescription: '调整筛选条件后重试。' })
const emit = defineEmits<{ select: [user: ConsoleDirectoryUser] }>()
const UAvatar = resolveComponent('UAvatar')
const UBadge = resolveComponent('UBadge')
const UButton = resolveComponent('UButton')
function statusMeta(user: ConsoleDirectoryUser) {
  if (user.status === 1) return { label: '正常', color: 'success' as const }
  if (user.status === -1) return { label: '已删除', color: 'error' as const }
  return { label: '停用', color: 'neutral' as const }
}

function getDisplayName(user: ConsoleDirectoryUser) {
  return user.realName || user.displayName || user.nickname || user.username || user.uid
}

const userColumns: TableColumn<ConsoleDirectoryUser>[] = [
  {
    accessorKey: 'uid',
    header: '用户',
    cell: ({ row }) => {
      const user = row.original
      return h('div', { class: 'flex items-center gap-3' }, [
        h(UAvatar, { src: resolveAvatarSrc(user.avatar) || undefined, alt: getDisplayName(user), size: 'sm' }),
        h('div', [
          h('p', { class: 'font-medium text-highlighted' }, getDisplayName(user)),
          h('p', { class: 'text-xs text-muted' }, user.uid)
        ])
      ])
    }
  },
  {
    accessorKey: 'deptCode',
    header: '主部门',
    cell: ({ row }) => {
      const user = row.original
      if (!user.deptCode) return '未分配'
      return h('div', [
        h('p', { class: 'text-highlighted' }, user.deptName || user.deptCode),
        h('p', { class: 'text-xs text-muted' }, user.deptCode)
      ])
    }
  },
  { accessorKey: 'email', header: '邮箱', cell: ({ row }) => row.original.email || '-' },
  { accessorKey: 'mobileTail4', header: '手机尾号', cell: ({ row }) => row.original.mobileTail4 || '-' },
  { accessorKey: 'userType', header: '类型', cell: ({ row }) => row.original.userType || 'employee' },
  {
    accessorKey: 'status',
    header: '状态',
    cell: ({ row }) => {
      const meta = statusMeta(row.original)
      return h(UBadge, { color: meta.color, variant: 'soft' }, () => meta.label)
    }
  },
  {
    id: 'actions',
    header: '',
    cell: ({ row }) => h(UButton, {
      color: 'neutral',
      variant: 'ghost',
      size: 'sm',
      icon: props.actionIcon,
      onClick: () => emit('select', row.original)
    }, () => props.actionLabel)
  }
]
</script>

<template>
  <UTable
    sticky
    :data="items"
    :columns="userColumns"
    :loading="loading"
    empty="暂无用户"
    class="directory-mobile-table min-w-0 flex-1 max-h-[calc(100svh-22rem)] rounded-lg border border-default"
  >
    <template #empty>
      <CommonEmptyState
        icon="i-lucide-users"
        title="暂无目录用户"
        :description="emptyDescription"
      />
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
  .directory-mobile-table :deep(th:nth-child(6)) { width: 4.5rem; }
  .directory-mobile-table :deep(th:nth-child(7)) { width: 4.5rem; }
}
</style>
