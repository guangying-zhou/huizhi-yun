<script setup lang="ts">
interface SystemRoleDiff {
  systemRole: {
    roleCode: string
    roleName: string
  }
  tenantRole: {
    id: number
    isOverridden: boolean
  } | null
  summary: {
    permissionMissingCount: number
    permissionExtraCount: number
    permissionChangedCount: number
    scopeMissingCount: number
    scopeExtraCount: number
    scopeChangedCount: number
  }
}

const props = defineProps<{
  diff: SystemRoleDiff | null
}>()
</script>

<template>
  <UCard v-if="props.diff">
    <template #header>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">
            Diff
          </p>
          <h2 class="text-lg font-semibold text-highlighted">
            {{ props.diff.systemRole.roleName }}
          </h2>
          <p class="font-mono text-xs text-muted">
            {{ props.diff.systemRole.roleCode }}
          </p>
        </div>
        <UBadge
          :color="props.diff.tenantRole?.isOverridden ? 'warning' : 'neutral'"
          variant="soft"
        >
          {{ props.diff.tenantRole?.isOverridden ? '已覆盖' : '标准' }}
        </UBadge>
      </div>
    </template>

    <div class="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
      <div class="diff-stat">
        <span>perm missing</span>
        <strong>{{ props.diff.summary.permissionMissingCount }}</strong>
      </div>
      <div class="diff-stat">
        <span>perm extra</span>
        <strong>{{ props.diff.summary.permissionExtraCount }}</strong>
      </div>
      <div class="diff-stat">
        <span>perm changed</span>
        <strong>{{ props.diff.summary.permissionChangedCount }}</strong>
      </div>
      <div class="diff-stat">
        <span>scope missing</span>
        <strong>{{ props.diff.summary.scopeMissingCount }}</strong>
      </div>
      <div class="diff-stat">
        <span>scope extra</span>
        <strong>{{ props.diff.summary.scopeExtraCount }}</strong>
      </div>
      <div class="diff-stat">
        <span>scope changed</span>
        <strong>{{ props.diff.summary.scopeChangedCount }}</strong>
      </div>
    </div>
  </UCard>
</template>

<style scoped>
.diff-stat {
  display: grid;
  gap: 0.25rem;
  border: 1px solid rgb(226 232 240);
  border-radius: 0.5rem;
  padding: 0.75rem;
  background: rgb(248 250 252);
}

.diff-stat span {
  font-size: 0.6875rem;
  color: rgb(100 116 139);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.diff-stat strong {
  font-size: 1.25rem;
  color: rgb(15 23 42);
}
</style>
