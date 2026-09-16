<script setup lang="ts">
interface AppRolePermissionItem {
  appCode: string
  resourceCode: string
  resourceName: string | null
  action: string
  manifestActionId?: number | null
}

interface AppRoleItem {
  roleCode: string
  roleName: string
  appCode: string
  description?: string | null
  status?: string
  permissionCount: number
  permissions?: AppRolePermissionItem[]
}

interface BaselinePermissionItem {
  appCode: string
  resourceCode: string
  action: string
  scopeType: string
  scopeValue: string
}

const props = defineProps<{
  roleCode: string | null
  roleName: string
  appRoles: AppRoleItem[]
  baselinePermissions: BaselinePermissionItem[]
  saving: boolean
}>()

const emit = defineEmits<{
  save: []
}>()

const selectedAppRoleCodes = defineModel<string[]>('selectedAppRoleCodes', { required: true })
const expandedPermissionCards = ref<string[]>([])

const baselinePermissionsByApp = computed(() => {
  const groups = new Map<string, BaselinePermissionItem[]>()
  for (const permission of props.baselinePermissions) {
    const items = groups.get(permission.appCode) || []
    items.push(permission)
    groups.set(permission.appCode, items)
  }

  for (const [appCode, items] of groups.entries()) {
    groups.set(appCode, items.sort((left, right) =>
      left.resourceCode.localeCompare(right.resourceCode)
      || left.action.localeCompare(right.action)
      || left.scopeType.localeCompare(right.scopeType)
      || left.scopeValue.localeCompare(right.scopeValue)
    ))
  }

  return groups
})

const appPermissionGroups = computed(() => {
  const groups = new Map<string, { appCode: string, items: AppRoleItem[], baselinePermissions: BaselinePermissionItem[] }>()
  for (const role of props.appRoles) {
    const group = groups.get(role.appCode) || {
      appCode: role.appCode,
      items: [],
      baselinePermissions: baselinePermissionsByApp.value.get(role.appCode) || []
    }
    group.items.push(role)
    groups.set(role.appCode, group)
  }

  for (const [appCode, permissions] of baselinePermissionsByApp.value.entries()) {
    if (groups.has(appCode)) continue
    groups.set(appCode, {
      appCode,
      items: [],
      baselinePermissions: permissions
    })
  }

  return [...groups.values()]
    .map(group => ({
      ...group,
      items: group.items.sort((left, right) => left.roleCode.localeCompare(right.roleCode))
    }))
    .sort((left, right) => left.appCode.localeCompare(right.appCode))
})

const selectedPermissionCount = computed(() => props.appRoles
  .filter(item => selectedAppRoleCodes.value.includes(item.roleCode))
  .reduce((sum, item) => sum + Number(item.permissionCount || 0), 0))

function isAppRoleSelected(roleCode: string) {
  return selectedAppRoleCodes.value.includes(roleCode)
}

function setAppRoleSelected(roleCode: string, checked: boolean) {
  if (checked) {
    if (!selectedAppRoleCodes.value.includes(roleCode)) {
      selectedAppRoleCodes.value = [...selectedAppRoleCodes.value, roleCode]
    }
    return
  }

  selectedAppRoleCodes.value = selectedAppRoleCodes.value.filter(item => item !== roleCode)
}

function baselinePermissionKey(permission: BaselinePermissionItem) {
  return `${permission.appCode}:${permission.resourceCode}:${permission.action}:${permission.scopeType}:${permission.scopeValue}`
}

function baselinePermissionText(permission: BaselinePermissionItem) {
  return `${permission.appCode} / ${permission.resourceCode} / ${permission.action}`
}

function baselineScopeText(permission: BaselinePermissionItem) {
  return `${permission.scopeType}:${permission.scopeValue}`
}

function appRolePermissionCardKey(appRole: Pick<AppRoleItem, 'roleCode'>) {
  return `app-role:${appRole.roleCode}`
}

function loginUserPermissionCardKey(appCode: string) {
  return `login-user:${appCode}`
}

function isPermissionCardExpanded(key: string) {
  return expandedPermissionCards.value.includes(key)
}

function togglePermissionCard(key: string) {
  expandedPermissionCards.value = isPermissionCardExpanded(key)
    ? expandedPermissionCards.value.filter(item => item !== key)
    : [...expandedPermissionCards.value, key]
}

function permissionCountText(count: number) {
  return `${Number(count || 0)} 项权限`
}

function appRolePermissionText(permission: AppRolePermissionItem) {
  return `${permission.appCode} / ${permission.resourceCode} / ${permission.action}`
}

watch(() => props.roleCode, () => {
  expandedPermissionCards.value = []
})
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="font-medium text-highlighted">
            默认应用权限角色
          </div>
          <p class="mt-0.5 text-sm text-muted">
            企业启用该角色时，会继承这里选择的应用权限角色。
          </p>
        </div>
        <div class="text-right text-xs text-muted">
          <div>已选 {{ selectedAppRoleCodes.length }} 个</div>
          <div>{{ selectedPermissionCount }} 项权限</div>
        </div>
      </div>
    </template>

    <div
      v-if="!roleCode"
      class="rounded-lg border border-dashed border-default px-4 py-10 text-center text-sm text-muted"
    >
      先创建或选择一个企业角色，再配置默认应用权限角色。
    </div>

    <div
      v-else
      class="space-y-4"
    >
      <div class="rounded-lg bg-muted/40 px-3 py-2 text-sm text-muted">
        当前企业角色：
        <span class="font-medium text-highlighted">{{ roleName }}</span>
        <span class="mono text-dimmed">({{ roleCode }})</span>
      </div>

      <div
        v-if="appPermissionGroups.length === 0"
        class="rounded-lg border border-dashed border-default px-4 py-8 text-center text-sm text-muted"
      >
        当前还没有可绑定的应用权限角色。
      </div>

      <div
        v-for="group in appPermissionGroups"
        :key="group.appCode"
        class="space-y-2"
      >
        <div class="mono text-xs font-medium text-muted">
          {{ group.appCode }}
        </div>
        <div class="grid gap-2 md:grid-cols-2">
          <div
            v-if="group.baselinePermissions.length"
            class="app-role-card app-role-login-card"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <UIcon
                    name="i-lucide-user-round-check"
                    class="size-4 text-primary"
                  />
                  <span class="font-medium text-highlighted">登录用户</span>
                  <UBadge
                    color="info"
                    variant="soft"
                    size="sm"
                  >
                    默认继承
                  </UBadge>
                </div>
                <p class="mt-1 text-xs text-muted">
                  所有未排除的登录用户默认获得 {{ group.appCode }} 的这些权限。
                </p>
              </div>
              <UButton
                color="neutral"
                variant="soft"
                size="xs"
                :trailing-icon="isPermissionCardExpanded(loginUserPermissionCardKey(group.appCode)) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                @click="togglePermissionCard(loginUserPermissionCardKey(group.appCode))"
              >
                {{ permissionCountText(group.baselinePermissions.length) }}
              </UButton>
            </div>

            <div
              v-if="isPermissionCardExpanded(loginUserPermissionCardKey(group.appCode))"
              class="permission-detail-panel"
            >
              <div
                v-for="permission in group.baselinePermissions"
                :key="`login-detail-${baselinePermissionKey(permission)}`"
                class="permission-detail-item"
              >
                <span class="font-medium text-highlighted">{{ baselinePermissionText(permission) }}</span>
                <span class="mono text-xs text-dimmed">{{ baselineScopeText(permission) }}</span>
              </div>
            </div>
          </div>

          <div
            v-for="appRole in group.items"
            :key="appRole.roleCode"
            class="app-role-card"
            :class="{ 'is-selected': isAppRoleSelected(appRole.roleCode) }"
          >
            <div class="flex items-start gap-3">
              <input
                type="checkbox"
                class="mt-1 size-4 shrink-0 rounded border-default"
                :checked="isAppRoleSelected(appRole.roleCode)"
                @change="setAppRoleSelected(appRole.roleCode, ($event.target as HTMLInputElement).checked)"
              >
              <div class="min-w-0 flex-1">
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <span class="block truncate font-medium text-highlighted">{{ appRole.roleName }}</span>
                    <span class="mono block truncate text-xs text-dimmed">{{ appRole.roleCode }}</span>
                  </div>
                  <UButton
                    color="neutral"
                    variant="soft"
                    size="xs"
                    :trailing-icon="isPermissionCardExpanded(appRolePermissionCardKey(appRole)) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                    @click.stop="togglePermissionCard(appRolePermissionCardKey(appRole))"
                  >
                    {{ permissionCountText(appRole.permissionCount) }}
                  </UButton>
                </div>
                <p
                  v-if="appRole.description"
                  class="mt-2 line-clamp-2 text-xs text-muted"
                >
                  {{ appRole.description }}
                </p>
              </div>
            </div>

            <div
              v-if="isPermissionCardExpanded(appRolePermissionCardKey(appRole))"
              class="permission-detail-panel"
            >
              <div
                v-if="!appRole.permissions?.length"
                class="text-sm text-muted"
              >
                当前应用角色未配置权限明细。
              </div>
              <template v-else>
                <div
                  v-for="permission in appRole.permissions"
                  :key="`${appRole.roleCode}:${appRolePermissionText(permission)}`"
                  class="permission-detail-item"
                >
                  <span class="font-medium text-highlighted">{{ appRolePermissionText(permission) }}</span>
                  <span class="text-xs text-muted">{{ permission.resourceName || permission.resourceCode }}</span>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>

      <UButton
        color="primary"
        icon="i-lucide-save"
        :loading="saving"
        @click="emit('save')"
      >
        保存默认权限组合
      </UButton>
    </div>
  </UCard>
</template>

<style scoped>
.app-role-card {
  min-width: 0;
  border: 1px solid var(--ui-border);
  border-radius: 0.5rem;
  padding: 0.75rem;
  font-size: 0.875rem;
  transition: background-color 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
}

.app-role-card.is-selected {
  border-color: color-mix(in oklab, var(--ui-primary) 34%, var(--ui-border));
  background: color-mix(in oklab, var(--ui-primary) 7%, transparent);
}

.app-role-login-card {
  background: color-mix(in oklab, var(--ui-info) 7%, transparent);
}

.permission-detail-panel {
  display: grid;
  gap: 0.5rem;
  margin-top: 0.75rem;
  border-top: 1px solid var(--ui-border);
  padding-top: 0.75rem;
}

.permission-detail-item {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.125rem;
  border-radius: 0.375rem;
  background: var(--ui-bg-muted);
  padding: 0.5rem 0.625rem;
}
</style>
