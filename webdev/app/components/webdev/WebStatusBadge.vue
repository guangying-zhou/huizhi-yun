<script setup lang="ts">
const props = withDefaults(defineProps<{
  status?: string
  variant?: 'soft' | 'subtle' | 'solid' | 'outline'
}>(), {
  status: 'idle',
  variant: 'soft'
})

const meta = computed(() => webdevStatusMeta(props.status))
const spinning = computed(() => props.status === 'running' || props.status === 'deploying')
</script>

<template>
  <UBadge
    :color="meta.color"
    :variant="variant"
    class="gap-1"
  >
    <UIcon
      :name="meta.icon"
      class="size-3.5"
      :class="spinning ? 'animate-spin' : ''"
    />
    {{ meta.label }}
  </UBadge>
</template>
