<script setup lang="ts">
import type { AlertItem, ApiResponse } from '~/types'

const props = defineProps<{
  open: boolean
  alert: AlertItem | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'handled': []
}>()

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const { loadDictionaries, getOptions } = useAssetDictionaries()
await loadDictionaries()

const toast = useToast()
const submitting = ref(false)
const alertStatusOptions = computed(() => getOptions('alert_status'))

const state = reactive({
  status: 'acknowledged',
  next_remind_at: '',
  resolution: ''
})

watch(() => props.open, (open) => {
  if (open) {
    state.status = props.alert?.status === 'resolved' ? 'resolved' : 'acknowledged'
    state.next_remind_at = ''
    state.resolution = ''
  }
})

async function handleSubmit() {
  if (!props.alert?.id) {
    return
  }

  submitting.value = true

  try {
    await $fetch<ApiResponse<{ id: number }>>(`/api/v1/alerts/${props.alert.id}/actions`, {
      method: 'POST',
      body: {
        status: state.status.trim() || 'acknowledged',
        next_remind_at: state.next_remind_at || null,
        resolution: state.resolution.trim() || null
      }
    })

    toast.add({
      title: '预警已处理',
      description: props.alert.alert_no ? `${props.alert.alert_no} 已更新。` : '预警状态已更新。',
      color: 'success',
      icon: 'i-lucide-check'
    })

    emit('handled')
    isOpen.value = false
  } catch (error) {
    console.error('[AlertHandle] Failed:', error)
    toast.add({
      title: '处理失败',
      description: '请稍后重试。',
      color: 'error',
      icon: 'i-lucide-circle-alert'
    })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    title="处理预警"
    :description="alert?.title || '更新预警状态、提醒时间和处理说明。'"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <div class="grid gap-4 md:grid-cols-2">
          <UFormField label="处理状态">
            <USelect
              v-model="state.status"
              :items="alertStatusOptions"
              placeholder="请选择处理状态"
              class="w-full"
            />
          </UFormField>

          <UFormField label="下次提醒">
            <UInput
              v-model="state.next_remind_at"
              type="datetime-local"
              class="w-full"
            />
          </UFormField>
        </div>

        <UFormField label="处理说明">
          <UTextarea
            v-model="state.resolution"
            :rows="4"
            placeholder="记录续费安排、清理计划或忽略原因"
            class="w-full"
          />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-3">
        <UButton color="neutral" variant="outline" @click="isOpen = false">
          取消
        </UButton>
        <UButton :loading="submitting" icon="i-lucide-check-check" @click="handleSubmit">
          保存处理结果
        </UButton>
      </div>
    </template>
  </UModal>
</template>
