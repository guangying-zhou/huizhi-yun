<script setup lang="ts">
import RemoteAssetObjectSelect from './RemoteAssetObjectSelect.vue'
import type { ApiResponse, DeliveryItem } from '~/types'

const props = defineProps<{
  open: boolean
  delivery: DeliveryItem | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'created': []
}>()

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const toast = useToast()
const submitting = ref(false)
const relationOptions = [
  { label: '主交付环境', value: 'primary' },
  { label: '备份环境', value: 'backup' },
  { label: '测试环境', value: 'test' },
  { label: '培训环境', value: 'training' },
  { label: '其他', value: 'other' }
]

const state = reactive({
  environment_id: undefined as number | undefined,
  relation_type: 'primary'
})

watch(() => props.open, async (open) => {
  if (open) {
    state.environment_id = undefined
    state.relation_type = 'primary'
  }
})

async function handleSubmit() {
  if (!props.delivery?.id) return
  if (!state.environment_id) {
    toast.add({ title: '缺少环境', description: '请先选择要关联的环境。', color: 'warning' })
    return
  }

  submitting.value = true

  try {
    await $fetch<ApiResponse<{ id: number }>>(`/api/v1/deliveries/${props.delivery.id}/environments`, {
      method: 'POST',
      body: {
        environment_id: state.environment_id,
        relation_type: state.relation_type
      }
    })

    toast.add({ title: '环境已关联', description: '交付与环境关系已保存。', color: 'success', icon: 'i-lucide-check' })
    emit('created')
    isOpen.value = false
  } catch (error) {
    console.error('[DeliveryEnvironmentLink] Failed:', error)
    toast.add({ title: '关联失败', description: '可能已存在相同关联。', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    title="关联交付环境"
    description="将环境视图挂到当前交付，建立客户交付与运行环境的关系。"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <UFormField label="环境视图" required>
          <RemoteAssetObjectSelect
            v-model="state.environment_id"
            kind="environments"
            :enabled="isOpen"
            :exclude-ids="(props.delivery?.linked_environments || []).map(item => item.id)"
          />
        </UFormField>

        <UFormField label="关联类型">
          <USelect v-model="state.relation_type" :items="relationOptions" class="w-full" />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-3">
        <UButton color="neutral" variant="outline" @click="isOpen = false">
          取消
        </UButton>
        <UButton :loading="submitting" icon="i-lucide-link-2" @click="handleSubmit">
          确认关联
        </UButton>
      </div>
    </template>
  </UModal>
</template>
