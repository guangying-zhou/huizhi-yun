<script setup lang="ts">
import { useAimsModule } from '../useAimsModule'
import { deliverableStatusBadge, deliverableTypeBadge, qualityStatusBadge } from '../../app/utils/projectDeliverablePresentation'

type Deliverable = { id: number, name: string, description?: string | null, deliverableType?: string, status?: string, qualityStatus?: string, acceptanceCriteria?: string | null, documentTitle?: string | null, targetTitle?: string | null, matterTitle?: string | null, submittedAt?: string | null, evidenceNote?: string | null }
const route = useRoute()
const { moduleUrl } = useAimsModule()
const projectId = computed(() => String(route.params.id || ''))
const deliverableId = computed(() => String(route.params.deliverableId || ''))
const item = ref<Deliverable | null>(null)
const loading = ref(false)
const error = ref('')
let requestSequence = 0
async function refresh() {
  const request = ++requestSequence
  loading.value = true
  error.value = ''
  item.value = null
  try {
    const result = await $fetch<{ code: number, data?: Deliverable }>(moduleUrl(`/api/v1/projects/${projectId.value}/deliverables/${deliverableId.value}`))
    if (request !== requestSequence) return
    if (result.code !== 0 || !result.data) throw new Error('交付物详情暂不可用')
    item.value = result.data
  } catch (cause) {
    if (request !== requestSequence) return
    item.value = null
    error.value = cause instanceof Error ? cause.message : '交付物详情暂不可用'
  } finally {
    if (request === requestSequence) loading.value = false
  }
}
watch([projectId, deliverableId], refresh)
onMounted(refresh)
</script>

<template>
  <section class="space-y-5">
    <UButton :to="moduleUrl(`/projects/${projectId}/output`)" variant="link" color="neutral" icon="i-lucide-arrow-left">返回项目产出</UButton>
    <h1 class="text-2xl font-semibold text-highlighted">{{ item?.name || '交付物详情' }}</h1>
    <UAlert v-if="error" color="error" title="无法读取交付物" :description="error" />
    <USkeleton v-else-if="loading" class="h-48 w-full" />
    <UCard v-else-if="item">
      <dl class="grid gap-5 sm:grid-cols-2">
        <div><dt class="text-sm text-muted">类型</dt><dd><UBadge :color="deliverableTypeBadge(item.deliverableType).color" variant="soft">{{ deliverableTypeBadge(item.deliverableType).label }}</UBadge></dd></div>
        <div><dt class="text-sm text-muted">提交状态</dt><dd><UBadge :color="deliverableStatusBadge(item.status).color" variant="soft">{{ deliverableStatusBadge(item.status).label }}</UBadge></dd></div>
        <div><dt class="text-sm text-muted">质量状态</dt><dd><UBadge :color="qualityStatusBadge(item.qualityStatus, item.status).color" variant="soft">{{ qualityStatusBadge(item.qualityStatus, item.status).label }}</UBadge></dd></div>
        <div><dt class="text-sm text-muted">关联目标</dt><dd>{{ item.targetTitle || item.matterTitle || '-' }}</dd></div>
        <div><dt class="text-sm text-muted">文档</dt><dd>{{ item.documentTitle || '-' }}</dd></div>
        <div><dt class="text-sm text-muted">提交时间</dt><dd>{{ item.submittedAt || '-' }}</dd></div>
      </dl>
      <div v-if="item.description || item.acceptanceCriteria || item.evidenceNote" class="mt-6 space-y-3 text-sm">
        <p v-if="item.description">{{ item.description }}</p>
        <p v-if="item.acceptanceCriteria"><strong>验收标准：</strong>{{ item.acceptanceCriteria }}</p>
        <p v-if="item.evidenceNote"><strong>提交说明：</strong>{{ item.evidenceNote }}</p>
      </div>
    </UCard>
  </section>
</template>
