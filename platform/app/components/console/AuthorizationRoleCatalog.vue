<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

type RolePolicyStatus = 'not_enabled' | 'synced' | 'system_updated' | 'tenant_overridden' | 'drifted' | 'unknown'

interface SystemRoleItem {
  roleCode: string
  roleName: string
  roleType: string
  appCode: string | null
  description: string | null
  permissionCount: number
  scopeCount: number
  policyRevision: number
  policyHash: string | null
  policyUpdatedAt: string | null
  appCodes?: string[]
  enabled: boolean
  tenantRoleId: number | null
  tenantRoleStatus: string | null
  isOverridden: boolean
  tenantSourcePolicyHash: string | null
  tenantEffectivePolicyHash: string | null
  tenantPolicyRevision: number | null
  tenantPolicyUpdatedAt: string | null
  policyStatus: RolePolicyStatus
}

interface RoleAssignmentSummary {
  id: number
  roleId: number
  subjectId: number
  subjectCode: string
  subjectDisplayName: string
}

const props = defineProps<{
  roles: SystemRoleItem[]
  loading: boolean
  pendingAction: boolean
  pendingPermissions: boolean
  pendingPermissionRoleCode: string | null
  roleAuthorizedUsers: (role: SystemRoleItem) => RoleAssignmentSummary[]
  roleAppText: (role: SystemRoleItem) => string
  rolePolicyStatusLabel: (status: RolePolicyStatus) => string
  rolePolicyStatusColor: (status: RolePolicyStatus) => 'success' | 'warning' | 'info' | 'error' | 'neutral'
  rolePolicyStatusHint: (status: RolePolicyStatus) => string
  roleHasPolicyDiff: (role: SystemRoleItem) => boolean
}>()

const emit = defineEmits<{
  select: [role: SystemRoleItem]
  assign: [role: SystemRoleItem]
  showPermissions: [role: SystemRoleItem]
  showDiff: [role: SystemRoleItem]
  sync: [role: SystemRoleItem, force?: boolean]
}>()

const roleColumns: TableColumn<SystemRoleItem>[] = [
  { id: 'role', header: '角色' },
  { id: 'app', header: '应用' },
  { id: 'permissions', header: '权限' },
  { id: 'users', header: '已授权用户' },
  { id: 'policy', header: '策略状态' },
  { id: 'actions', header: '操作' }
]

function selectForAssignment(role: SystemRoleItem) {
  emit('select', role)
  emit('assign', role)
}
</script>

<template>
  <UCard
    class="auth-role-list-card min-h-[24rem] shrink-0"
    :ui="{ root: 'flex flex-col', body: 'min-h-0 p-0 sm:p-0' }"
  >
    <UTable
      :data="props.roles"
      :columns="roleColumns"
      :loading="props.loading"
      sticky
      :ui="{
        root: 'auth-role-table-scroll w-full overflow-auto',
        base: 'min-w-[980px] border-separate border-spacing-0',
        th: 'sticky top-0 z-10 text-xs font-semibold text-muted bg-muted whitespace-nowrap',
        td: 'align-middle text-sm whitespace-nowrap border-b border-default',
        tr: 'cursor-default'
      }"
    >
      <template #role-cell="{ row }">
        <div class="min-w-[260px]">
          <div class="flex flex-wrap items-center gap-2">
            <p class="font-semibold text-highlighted">
              {{ row.original.roleName }}
            </p>
            <UBadge
              v-if="row.original.isOverridden"
              color="warning"
              variant="soft"
              size="sm"
            >
              已覆盖
            </UBadge>
          </div>
          <p class="mt-1 font-mono text-xs text-muted">
            {{ row.original.roleCode }}
          </p>
          <p
            v-if="row.original.description"
            class="mt-1 max-w-[360px] truncate text-xs text-muted"
          >
            {{ row.original.description }}
          </p>
        </div>
      </template>

      <template #app-cell="{ row }">
        <UTooltip :text="(row.original.appCodes || []).join(', ') || '该企业角色未配置默认应用角色'">
          <UBadge
            color="neutral"
            variant="soft"
          >
            {{ props.roleAppText(row.original) }}
          </UBadge>
        </UTooltip>
      </template>

      <template #permissions-cell="{ row }">
        <button
          type="button"
          class="auth-role-card__permission-count"
          :disabled="props.pendingPermissions && props.pendingPermissionRoleCode === row.original.roleCode"
          @click.stop="emit('showPermissions', row.original)"
        >
          <UIcon
            v-if="props.pendingPermissions && props.pendingPermissionRoleCode === row.original.roleCode"
            name="i-lucide-loader-circle"
            class="size-3 animate-spin"
          />
          <span>{{ row.original.permissionCount }} 项权限</span>
        </button>
        <span class="ml-1 text-xs text-muted">
          / {{ row.original.scopeCount }} 个范围
        </span>
      </template>

      <template #users-cell="{ row }">
        <div
          v-if="props.roleAuthorizedUsers(row.original).length"
          class="flex max-w-[360px] flex-wrap gap-1.5"
        >
          <UTooltip
            v-for="item in props.roleAuthorizedUsers(row.original).slice(0, 8)"
            :key="`${item.roleId}-${item.subjectId}-${item.id}`"
            :text="item.subjectDisplayName"
          >
            <UBadge
              color="success"
              variant="soft"
              size="sm"
              class="font-mono"
            >
              {{ item.subjectCode }}
            </UBadge>
          </UTooltip>
          <UBadge
            v-if="props.roleAuthorizedUsers(row.original).length > 8"
            color="neutral"
            variant="soft"
            size="sm"
          >
            +{{ props.roleAuthorizedUsers(row.original).length - 8 }}
          </UBadge>
        </div>
        <span
          v-else
          class="text-xs text-muted"
        >
          未授权
        </span>
      </template>

      <template #policy-cell="{ row }">
        <UTooltip :text="props.rolePolicyStatusHint(row.original.policyStatus)">
          <UBadge
            :color="props.rolePolicyStatusColor(row.original.policyStatus)"
            variant="soft"
          >
            {{ props.rolePolicyStatusLabel(row.original.policyStatus) }}
          </UBadge>
        </UTooltip>
      </template>

      <template #actions-cell="{ row }">
        <div class="flex justify-end gap-2">
          <UButton
            color="primary"
            variant="soft"
            size="sm"
            icon="i-lucide-user-plus"
            @click.stop="selectForAssignment(row.original)"
          >
            授权
          </UButton>
          <UButton
            v-if="props.roleHasPolicyDiff(row.original)"
            color="neutral"
            variant="soft"
            size="sm"
            :loading="props.pendingAction"
            @click.stop="emit('showDiff', row.original)"
          >
            差异
          </UButton>
          <UButton
            v-if="row.original.enabled && props.roleHasPolicyDiff(row.original) && row.original.isOverridden"
            color="warning"
            variant="soft"
            size="sm"
            :loading="props.pendingAction"
            @click.stop="emit('sync', row.original, true)"
          >
            确认同步
          </UButton>
          <UButton
            v-else-if="row.original.enabled && props.roleHasPolicyDiff(row.original)"
            color="primary"
            size="sm"
            :loading="props.pendingAction"
            @click.stop="emit('sync', row.original)"
          >
            同步
          </UButton>
        </div>
      </template>
    </UTable>

    <div
      v-if="!props.loading && props.roles.length === 0"
      class="m-4 rounded-lg border border-dashed border-default bg-muted px-4 py-8 text-center text-sm text-muted"
    >
      当前筛选下没有可授权的企业角色。
    </div>
  </UCard>
</template>

<style scoped>
.auth-role-card__permission-count {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 0.25rem;
  color: rgb(2 132 199);
  font: inherit;
  font-weight: 600;
  line-height: 1;
  vertical-align: baseline;
}

.auth-role-card__permission-count:hover {
  color: rgb(3 105 161);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.auth-role-card__permission-count:focus-visible {
  outline: 2px solid rgb(14 165 233 / 0.45);
  outline-offset: 2px;
}

.auth-role-card__permission-count:disabled {
  cursor: wait;
  opacity: 0.75;
  text-decoration: none;
}

.auth-role-list-card {
  min-height: 24rem;
  overflow: hidden;
}

:deep(.auth-role-table-scroll) {
  min-height: 22rem;
  max-height: min(42rem, calc(100dvh - 10rem));
  padding-bottom: 0.5rem;
  scroll-padding-bottom: 0.75rem;
}

@media (max-width: 768px) {
  .auth-role-list-card {
    min-height: 20rem;
  }

  :deep(.auth-role-table-scroll) {
    min-height: 18rem;
    max-height: max(20rem, calc(100dvh - 22rem));
  }
}
</style>
