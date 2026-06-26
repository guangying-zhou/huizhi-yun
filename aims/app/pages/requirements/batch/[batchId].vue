<script setup lang="ts">
/**
 * 审批中心链接跳转页
 * 根据 batchId 查询批次所属项目，然后重定向到对应项目的需求评审页签
 */
definePageMeta({
  layoutHeader: false
})

const route = useRoute()
const router = useRouter()
const toast = useToast()

const batchId = computed(() => Number(route.params.batchId))

onMounted(async () => {
  if (!batchId.value || Number.isNaN(batchId.value)) {
    toast.add({ title: '无效的批次ID', color: 'error' })
    router.replace('/')
    return
  }
  try {
    const res = await $fetch<{ code: number, data: { projectId: number } }>(
      `/api/v1/requirement-reviews/${batchId.value}/resolve`
    )
    if (res.code === 0 && res.data.projectId) {
      router.replace(`/projects/${res.data.projectId}/requirements?tab=review&batchId=${batchId.value}`)
      return
    }
    toast.add({ title: '评审批次不存在', color: 'error' })
    router.replace('/')
  } catch {
    toast.add({ title: '加载失败', color: 'error' })
    router.replace('/')
  }
})
</script>

<template>
  <div class="flex items-center justify-center h-full py-20">
    <UIcon
      name="i-lucide-loader-2"
      class="w-6 h-6 animate-spin text-muted"
    />
    <span class="ml-3 text-sm text-muted">跳转中...</span>
  </div>
</template>
