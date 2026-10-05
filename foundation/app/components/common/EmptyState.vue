<script setup lang="ts">
withDefaults(defineProps<{
  icon?: string
  title: string
  description?: string
}>(), {
  icon: 'i-lucide-inbox',
  description: ''
})
</script>

<template>
  <div class="flex flex-col items-center justify-center py-12 text-center">
    <UIcon :name="icon" class="size-10 text-(--ui-text-muted) mb-3" />
    <p class="text-sm font-medium text-(--ui-text-dimmed)">
      {{ title }}
    </p>
    <p v-if="description" class="text-xs text-(--ui-text-muted) mt-1 max-w-xs">
      {{ description }}
    </p>
    <div v-if="$slots.default" class="mt-4">
      <slot />
    </div>
  </div>
</template>
