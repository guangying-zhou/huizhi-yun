<script setup lang="ts">
defineProps<{
  title: string
  description: string
}>()
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-start justify-between gap-3">
        <div class="space-y-1">
          <p class="text-sm text-muted">
            {{ description }}
          </p>
          <h1 class="text-xl font-semibold">
            {{ title }}
          </h1>
        </div>

        <slot name="right" />
      </div>
    </template>

    <slot />
  </UCard>
</template>
