<script setup lang="ts">
interface RolePermissionRole {
  roleCode: string
  roleName: string
  appCode: string | null
}

interface RolePermissionGroup {
  key: string
  appCode: string
  resourceCode: string
  resourceName: string
  actions: string[]
}

const props = defineProps<{
  open: boolean
  title: string
  sourceText: string
  source: 'system' | 'tenant'
  role: RolePermissionRole | null
  error: string
  loading: boolean
  groups: RolePermissionGroup[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

function permissionActionColor(action: string) {
  if (action === 'admin') return 'error'
  if (action === 'edit') return 'warning'
  if (action === 'view') return 'success'
  return 'neutral'
}
</script>

<template>
  <UModal
    :open="props.open"
    :title="props.title"
    :description="props.sourceText"
    :ui="{ content: 'max-w-3xl' }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-4">
        <div
          v-if="props.role"
          class="rounded-lg border border-default bg-muted px-4 py-3"
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="font-semibold text-highlighted">
                {{ props.role.roleName }}
              </p>
              <p class="font-mono text-xs text-muted">
                {{ props.role.roleCode }}
              </p>
            </div>
            <div class="flex flex-wrap gap-2">
              <UBadge
                color="neutral"
                variant="soft"
              >
                {{ props.role.appCode || 'platform' }}
              </UBadge>
              <UBadge
                :color="props.source === 'tenant' ? 'success' : 'neutral'"
                variant="soft"
              >
                {{ props.sourceText }}
              </UBadge>
            </div>
          </div>
        </div>

        <UAlert
          v-if="props.error"
          color="error"
          variant="soft"
          icon="i-lucide-circle-alert"
          title="权限列表加载失败"
          :description="props.error"
        />

        <div
          v-if="props.loading"
          class="permission-state"
        >
          <UIcon
            name="i-lucide-loader-circle"
            class="size-4 animate-spin"
          />
          正在加载权限...
        </div>

        <div
          v-else-if="props.groups.length > 0"
          class="grid gap-3"
        >
          <div
            v-for="group in props.groups"
            :key="group.key"
            class="permission-group"
          >
            <div class="min-w-0">
              <p class="font-semibold text-highlighted">
                {{ group.resourceName }}
              </p>
              <p class="font-mono text-xs text-muted">
                {{ group.appCode }}:{{ group.resourceCode }}
              </p>
            </div>
            <div class="flex flex-wrap justify-end gap-2">
              <UBadge
                v-for="action in group.actions"
                :key="action"
                :color="permissionActionColor(action)"
                variant="soft"
              >
                {{ action }}
              </UBadge>
            </div>
          </div>
        </div>

        <div
          v-else-if="!props.error"
          class="permission-state"
        >
          当前角色没有权限项。
        </div>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
.permission-group {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.75rem;
  align-items: center;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.5rem;
  background: white;
  padding: 0.75rem;
}

.permission-state {
  display: flex;
  min-height: 8rem;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border: 1px dashed rgb(203 213 225);
  border-radius: 0.5rem;
  background: rgb(248 250 252);
  color: rgb(100 116 139);
  font-size: 0.875rem;
}

@media (max-width: 768px) {
  .permission-group {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
