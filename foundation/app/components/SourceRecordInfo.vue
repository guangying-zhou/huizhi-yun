<script setup lang="ts">
defineProps<{ source: Record<string, unknown> }>()
</script>

<template>
  <section class="space-y-1 border-t border-muted pt-3 text-sm text-muted">
    <h2 class="font-medium">
      记录信息
    </h2>
    <p class="break-words">
      来源：{{ source.system || 'WizBiz' }} {{ source.table || '—' }} #{{ source.pk || '—' }}，批次 {{ source.batchCode || '—' }}，导入于 {{ source.importedAt || '—' }}
    </p>
  </section>
</template>
