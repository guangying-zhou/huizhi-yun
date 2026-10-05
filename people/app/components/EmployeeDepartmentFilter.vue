<script setup lang="ts">
interface DepartmentNode {
  deptCode: string
  name: string
  orgType?: string
  children?: DepartmentNode[]
}

defineProps<{
  nodes: DepartmentNode[]
  loading: boolean
  selectedDeptCode: string
}>()

const emit = defineEmits<{
  select: [deptCode: string]
}>()
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex shrink-0 items-start gap-2 border-b border-default px-3 py-3">
      <UIcon
        name="i-lucide-network"
        class="mt-0.5 size-4 text-muted"
      />
      <div>
        <div class="text-sm font-medium text-highlighted">
          部门
        </div>
        <div class="mt-0.5 text-xs text-muted">
          选择部门时包含正式下级部门员工
        </div>
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto p-2">
      <UButton
        label="全部部门"
        icon="i-lucide-building-2"
        color="neutral"
        :variant="selectedDeptCode ? 'ghost' : 'soft'"
        block
        class="mb-1 justify-start"
        @click="emit('select', '')"
      />

      <div
        v-if="loading"
        class="space-y-2 px-2 py-3"
      >
        <USkeleton class="h-7 w-full" />
        <USkeleton class="h-7 w-4/5" />
        <USkeleton class="h-7 w-11/12" />
      </div>

      <div
        v-else-if="!nodes.length"
        class="px-3 py-6 text-center text-sm text-muted"
      >
        暂无部门数据
      </div>

      <div
        v-else
        class="space-y-0.5"
      >
        <DeptTreeSelector
          v-for="node in nodes"
          :key="node.deptCode"
          :node="node"
          :selected-dept-code="selectedDeptCode"
          @select="emit('select', $event)"
        />
      </div>
    </div>
  </div>
</template>
