<script setup lang="ts">
interface RequirementTargetDisplay {
  id: number
  title: string
  milestoneName: string | null
  milestonePivrStage: string | null
  isBaseline: boolean
  requirementCount: number
  taskCount: number
}

defineProps<{
  targets: readonly RequirementTargetDisplay[]
  activeTargetId: number | null
  activeTarget: RequirementTargetDisplay | null
  allRequirementCount: number
}>()

const emit = defineEmits<{
  'update:activeTargetId': [targetId: number | null]
}>()
</script>

<template>
  <div class="flex items-center gap-2 px-5 pt-4 pb-1 border-b border-default bg-elevated/30">
    <UButton
      :color="activeTargetId === null ? 'primary' : 'neutral'"
      :variant="activeTargetId === null ? 'soft' : 'ghost'"
      size="xs"
      icon="i-lucide-folders"
      @click="emit('update:activeTargetId', null)"
    >
      全部
      <UBadge
        color="neutral"
        variant="outline"
        size="xs"
        class="ml-1 font-mono"
      >
        {{ allRequirementCount }}
      </UBadge>
    </UButton>
    <UButton
      v-for="target in targets"
      :key="target.id"
      :color="(activeTargetId === target.id ? (target.isBaseline ? 'primary' : 'warning') : 'neutral') as any"
      :variant="activeTargetId === target.id ? 'soft' : 'ghost'"
      size="xs"
      @click="emit('update:activeTargetId', target.id)"
    >
      <UIcon
        :name="target.isBaseline ? 'i-lucide-anchor' : 'i-lucide-file-diff'"
        class="w-3.5 h-3.5 mr-1"
      />
      {{ target.title }}
      <UBadge
        color="neutral"
        variant="outline"
        size="xs"
        class="ml-1 font-mono"
      >
        T{{ target.taskCount }}/R{{ target.requirementCount }}
      </UBadge>
    </UButton>
    <span v-if="activeTarget" class="text-xs text-muted ml-auto">
      挂载里程碑：{{ activeTarget.milestoneName || '-' }}
      <span v-if="activeTarget.milestonePivrStage" class="font-mono ml-1">
        (PIVR:{{ activeTarget.milestonePivrStage }})
      </span>
    </span>
  </div>
</template>
