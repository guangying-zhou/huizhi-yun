<script setup lang="ts">
import SourceRecordInfo from '../../../foundation/app/components/SourceRecordInfo.vue'

defineProps<{ source: Record<string, unknown> }>()
</script>

<template>
  <SourceRecordInfo :source="source" />
</template>
