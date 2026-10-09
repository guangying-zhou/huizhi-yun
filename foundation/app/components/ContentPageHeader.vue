<script setup lang="ts">
const props = withDefaults(defineProps<{
  title: string
  hosted: boolean
  description?: string
  // Retained for caller compatibility; navigation stays outside the title row.
  breadcrumb?: string
}>(), {
  description: '',
  breadcrumb: ''
})
// Hosted page headers are the authoritative page name, including reactive detail names.
useHead(() => props.hosted ? { title: props.title } : {}, { tagPriority: 'high' })
</script>

<template>
  <header v-if="props.hosted" class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
      <h1 data-host-page-title class="max-w-full shrink-0 break-words text-xl font-semibold text-highlighted">
        {{ props.title }}
      </h1>
      <UTooltip
        v-if="props.description"
        :text="props.description"
        :ui="{ content: 'h-auto max-w-[calc(100vw-2rem)] sm:max-w-lg', text: 'whitespace-normal break-words' }"
        class="min-w-0 basis-full sm:flex-1 sm:basis-0"
      >
        <span class="block truncate text-sm text-muted" :title="props.description" tabindex="0">
          {{ props.description }}
        </span>
      </UTooltip>
    </div>
    <div v-if="$slots.actions" class="flex max-w-full shrink-0 flex-wrap items-center gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
