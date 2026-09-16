<script setup lang="ts">
import type { WorkflowStatus } from '../types/workflow'

const props = defineProps<{
  /** 直接传入状态（优先） */
  status?: WorkflowStatus | null
  /** 或通过 biz_key 自动查询 */
  appCode?: string
  resourceCode?: string
  bizId?: string
  actionCode?: string
}>()

const resolvedStatus = ref<WorkflowStatus | null>(props.status || null)
const instanceId = ref<number | null>(null)

// 如果没有直接传 status，通过 biz_key 查询
if (!props.status && props.appCode && props.resourceCode && props.bizId && props.actionCode) {
  onMounted(async () => {
    try {
      const res = await fetchInstanceByBiz({
        app_code: props.appCode!,
        resource_code: props.resourceCode!,
        biz_id: props.bizId!,
        action_code: props.actionCode!
      })
      if (res.code === 0 && res.data) {
        resolvedStatus.value = res.data.status
        instanceId.value = res.data.instance_id
      }
    } catch {
      // silent
    }
  })
}

// 监听外部 status 变化
watch(() => props.status, (val) => {
  if (val !== undefined) resolvedStatus.value = val
})

const badgeConfig = computed(() => {
  switch (resolvedStatus.value) {
    case 'running':
      return { label: '审批中', color: 'warning' as const, icon: 'i-lucide-clock' }
    case 'approved':
      return { label: '已通过', color: 'success' as const, icon: 'i-lucide-check-circle' }
    case 'rejected':
      return { label: '已驳回', color: 'error' as const, icon: 'i-lucide-x-circle' }
    case 'cancelled':
      return { label: '已撤销', color: 'neutral' as const, icon: 'i-lucide-ban' }
    case 'suspended':
      return { label: '已暂停', color: 'info' as const, icon: 'i-lucide-pause-circle' }
    default:
      return null
  }
})
</script>

<template>
  <UBadge
    v-if="badgeConfig"
    :color="badgeConfig.color"
    variant="subtle"
    size="sm"
    class="cursor-default"
  >
    <UIcon :name="badgeConfig.icon" class="size-3.5 mr-1" />
    {{ badgeConfig.label }}
  </UBadge>
</template>
