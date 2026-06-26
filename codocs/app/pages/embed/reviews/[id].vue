<template>
  <div class="min-h-screen bg-default p-4">
    <div v-if="loading" class="flex items-center justify-center py-10">
      <UIcon name="i-lucide-loader-2" class="animate-spin text-2xl" />
    </div>

    <div v-else-if="review" class="space-y-4">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <h1 class="truncate text-base font-semibold">
            {{ review.document_title }}
          </h1>
          <p class="text-sm text-muted">
            {{ review.review_type }} · {{ review.initiator_real_name || review.initiator_uid }}
          </p>
        </div>
        <WorkflowBadge :status="workflowBadgeStatus" />
      </div>

      <UCard>
        <div class="space-y-2 text-sm">
          <div class="flex justify-between gap-4">
            <span class="text-muted">归档目标</span>
            <span>{{ review.target_category }}</span>
          </div>
          <div v-if="extra?.sendTo" class="flex justify-between gap-4">
            <span class="text-muted">发送给</span>
            <span>{{ extra.sendTo }}</span>
          </div>
          <div v-if="extra?.sendReason">
            <span class="text-muted">发文事由</span>
            <p class="mt-1 whitespace-pre-wrap">
              {{ extra.sendReason }}
            </p>
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  layout: false
})

const route = useRoute()
const loading = ref(true)
const review = ref<Record<string, unknown> | null>(null)
const workflowBadgeStatus = computed(() => {
  return (review.value?.workflow_status || review.value?.status || null) as 'running' | 'approved' | 'rejected' | 'cancelled' | 'suspended' | null
})

const extra = computed(() => {
  const value = review.value?.extra
  if (!value) return null
  return typeof value === 'string' ? JSON.parse(value) : value
})

onMounted(async () => {
  try {
    const { data } = await $fetch<{ data: Record<string, unknown> }>(`/api/reviews/${route.params.id}`)
    review.value = data
  } finally {
    loading.value = false
  }
})
</script>
