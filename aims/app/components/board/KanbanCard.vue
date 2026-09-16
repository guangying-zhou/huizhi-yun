<script setup lang="ts">
import type { WorkItem } from '~/types/aims'

defineProps<{
  item: WorkItem
}>()
</script>

<template>
  <div class="cursor-grab active:cursor-grabbing">
    <WorkItemCard :item="item" />
  </div>
</template>
