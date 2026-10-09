<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { ConsoleDirectoryCommitteeMember, ConsoleCommitteeMemberRole } from '../types/consoleDirectory'
import { resolveAvatarSrc } from '../composables/useAvatar'

withDefaults(defineProps<{ items: ConsoleDirectoryCommitteeMember[], loading?: boolean, canEdit?: boolean, mutating?: boolean, roleRevision?: number, memberUpdatingUid?: string, emptyDescription?: string }>(), { canEdit: false, mutating: false, roleRevision: 0, emptyDescription: '调整筛选条件后重试。' })
const emit = defineEmits<{ updateRole: [item: ConsoleDirectoryCommitteeMember, role: ConsoleCommitteeMemberRole], remove: [item: ConsoleDirectoryCommitteeMember] }>()
const roleOptions: Array<{ label: string, value: ConsoleCommitteeMemberRole }> = [
  { label: '主任', value: 'leader' },
  { label: '秘书', value: 'manager' },
  { label: '委员', value: 'member' },
  { label: '观察员', value: 'observer' }
]
function roleLabel(value: ConsoleCommitteeMemberRole) {
  return roleOptions.find(option => option.value === value)?.label || value
}

function formatDate(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date)
}

const columns: TableColumn<ConsoleDirectoryCommitteeMember>[] = [
  { accessorKey: 'uid', header: '成员' },
  { accessorKey: 'role', header: '角色' },
  { accessorKey: 'deptName', header: '主部门' },
  { accessorKey: 'joinedAt', header: '加入时间' },
  { id: 'actions', header: '' }
]
</script>

<template>
  <UTable
    :data="items"
    :columns="columns"
    :loading="loading"
    class="directory-mobile-table min-w-[720px] rounded-lg border border-default"
  >
    <template #uid-cell="{ row }">
      <div class="flex items-center gap-2" :class="row.original.userStatus !== 'active' ? 'opacity-60' : ''">
        <UAvatar
          :src="resolveAvatarSrc(row.original.avatar) || undefined"
          :alt="row.original.displayName"
          size="sm"
        />
        <div>
          <div class="flex items-center gap-2">
            <p class="font-medium text-highlighted">
              {{ row.original.displayName }}
            </p>
            <UBadge
              v-if="row.original.userStatus !== 'active'"
              color="warning"
              variant="soft"
              size="xs"
            >
              账号已停用、授权不生效
            </UBadge>
          </div>
          <p class="text-xs text-muted">
            {{ row.original.uid }}
          </p>
        </div>
      </div>
    </template>

    <template #role-cell="{ row }">
      <USelect
        v-if="canEdit"
        :key="`${row.original.uid}:${row.original.role}:${roleRevision}`"
        :model-value="row.original.role"
        :items="roleOptions"
        class="w-28"
        :disabled="mutating || memberUpdatingUid === row.original.uid || row.original.userStatus !== 'active'"
        @update:model-value="emit('updateRole', row.original, $event as ConsoleCommitteeMemberRole)"
      />
      <UBadge v-else color="neutral" variant="soft">
        {{ roleLabel(row.original.role) }}
      </UBadge>
    </template>

    <template #deptName-cell="{ row }">
      {{ row.original.deptName || row.original.primaryDeptCode || '-' }}
    </template>

    <template #joinedAt-cell="{ row }">
      {{ formatDate(row.original.joinedAt) }}
    </template>

    <template #actions-cell="{ row }">
      <div class="flex justify-end">
        <UButton
          v-if="canEdit"
          color="error"
          variant="ghost"
          size="xs"
          icon="i-lucide-user-minus"
          :loading="memberUpdatingUid === row.original.uid"
          :disabled="mutating"
          :aria-label="`移除${row.original.displayName}`"
          @click="emit('remove', row.original)"
        >
          移除
        </UButton>
      </div>
    </template>

    <template #empty>
      <CommonEmptyState
        icon="i-lucide-user-round-x"
        title="暂无委员会成员"
        :description="emptyDescription"
      />
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
  .directory-mobile-table :deep(th:nth-child(2)) { width: 7rem; }
  .directory-mobile-table :deep(th:nth-child(5)) { width: 3rem; }
}
</style>
