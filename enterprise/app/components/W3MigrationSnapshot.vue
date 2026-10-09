<script setup lang="ts">
import { w3SnapshotRows, type W3Record } from '../utils/w3Presentation'
import { formatMoney } from '../../../foundation/app/utils/format'

const props = defineProps<{ snapshot: W3Record, current?: W3Record, currency?: string }>()
const rows = computed(() => w3SnapshotRows(props.snapshot, props.current))
function display(key: string, value: unknown) {
  return value === null || value === undefined ? '—' : key.includes('amount') ? formatMoney(String(value), { currency: props.currency || 'CNY' }) : String(value)
}
</script>

<template>
  <section class="space-y-3 rounded-lg border border-muted bg-elevated p-4">
    <h2 class="font-semibold">
      原系统数据（截至 {{ String(snapshot.snapshot_at || '').slice(0, 10) || '未知日期' }}）
    </h2>
    <p class="text-sm text-muted">
      {{ snapshot.source_note || '原系统缓存，口径不保证一致' }}
    </p>
    <dl class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div
        v-for="row in rows"
        :key="row.key"
        class="min-w-0"
      >
        <dt class="text-sm text-muted">
          {{ row.label }}
        </dt>
        <dd class="flex flex-wrap items-center gap-2 tabular-nums">
          <span>{{ display(row.key, row.value) }}</span>
          <span class="text-sm text-muted">现值：{{ row.tracked ? display(row.key, row.current) : '一期未跟踪' }}</span>
          <UBadge
            v-if="row.different"
            color="warning"
            variant="subtle"
          >
            与现值不同
          </UBadge>
        </dd>
      </div>
    </dl>
  </section>
</template>
