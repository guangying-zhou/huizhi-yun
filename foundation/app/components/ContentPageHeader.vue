<script setup lang="ts">
const props = withDefaults(defineProps<{
  title: string
  hosted: boolean
  description?: string
  breadcrumb?: string
}>(), {
  description: '',
  breadcrumb: ''
})
</script>

<template>
  <header v-if="props.hosted" class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div class="min-w-0">
      <p v-if="breadcrumb" class="mb-1 text-xs text-muted">
        {{ breadcrumb }}
      </p>
      <h1 class="text-xl font-semibold text-highlighted">
        {{ props.title }}
      </h1>
      <p v-if="props.description" class="mt-1 line-clamp-1 text-sm text-muted">
        {{ props.description }}
      </p>
    </div>
    <div v-if="$slots.actions" class="flex shrink-0 flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
