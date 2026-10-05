<script setup lang="ts">
import type { FeatureReleaseEvidence } from '~/utils/productFeatureReleaseEvidence'

defineProps<{ productCode: string, evidence: FeatureReleaseEvidence | null }>()
const labels = { planned: '计划中', delivered: '已交付', deferred: '已顺延' }
</script>

<template>
  <div class="space-y-1 border-t border-default pt-2 text-sm whitespace-normal">
    <p class="font-medium">
      最新发布快照
    </p>
    <p v-if="!evidence" class="text-muted">
      暂无发布记录
    </p>
    <template v-else>
      <p v-if="evidence.membership === 'included'">
        包含此功能 · 冻结状态：{{ labels[evidence.frozen_status!] }}
      </p>
      <p v-else-if="evidence.membership === 'absent'">
        未包含此功能
      </p>
      <p v-else class="text-muted">
        历史导入缺少快照，无法确认是否包含
      </p>
      <div class="flex flex-wrap gap-1">
        <UBadge v-if="evidence.current" color="success" variant="subtle">
          当前有效发布
        </UBadge>
        <UBadge v-else color="neutral" variant="subtle">
          非当前发布
        </UBadge>
        <UBadge v-if="evidence.withdrawn" color="warning" variant="subtle">
          已撤回
        </UBadge>
        <UBadge v-if="evidence.superseded" color="neutral" variant="subtle">
          已被更正
        </UBadge>
      </div>
      <UButton :to="`/products/${encodeURIComponent(productCode)}/versions/${evidence.version_id}/releases/${evidence.record_id}`" variant="link" size="sm">
        查看发布记录
      </UButton>
    </template>
  </div>
</template>
