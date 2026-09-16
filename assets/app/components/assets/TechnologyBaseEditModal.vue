<script setup lang="ts">
import type { ApiResponse, TechnologyBaseItem } from '~/types'

const props = defineProps<{
  open: boolean
  base: TechnologyBaseItem | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'updated': []
}>()

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const { loadDictionaries, getOptions } = useAssetDictionaries()
await loadDictionaries()

const toast = useToast()
const submitting = ref(false)
const baseTypeOptions = computed(() => getOptions('technology_base_type'))
const baseStatusOptions = computed(() => getOptions('technology_base_status'))
const assetLevelOptions = computed(() => getOptions('asset_level'))

const state = reactive({
  base_code: '',
  base_name: '',
  base_type: '',
  status: '',
  service_targets: '',
  asset_level: '',
  notes: ''
})

function hydrate() {
  state.base_code = props.base?.base_code || ''
  state.base_name = props.base?.base_name || ''
  state.base_type = props.base?.base_type || 'platform'
  state.status = props.base?.status || 'active'
  state.service_targets = props.base?.service_targets || ''
  state.asset_level = props.base?.asset_level || ''
  state.notes = props.base?.notes || ''
}

watch(() => props.open, (open) => {
  if (open) {
    hydrate()
  }
})

watch(() => props.base, () => {
  if (props.open) {
    hydrate()
  }
})

async function handleSubmit() {
  if (!props.base?.id) {
    return
  }

  if (!state.base_name.trim()) {
    toast.add({ title: '缺少底座名称', description: '请先填写技术底座名称。', color: 'warning' })
    return
  }

  submitting.value = true

  try {
    await $fetch<ApiResponse<{ id: number }>>(`/api/v1/technology-bases/${props.base.id}`, {
      method: 'PATCH',
      body: {
        base_code: state.base_code.trim() || null,
        base_name: state.base_name.trim(),
        base_type: state.base_type || null,
        status: state.status || null,
        service_targets: state.service_targets.trim() || null,
        asset_level: state.asset_level || null,
        notes: state.notes.trim() || null
      }
    })

    toast.add({
      title: '技术底座已更新',
      description: '主要信息已保存。',
      color: 'success',
      icon: 'i-lucide-check'
    })

    emit('updated')
    isOpen.value = false
  } catch (error) {
    console.error('[TechnologyBaseEdit] Failed:', error)
    toast.add({
      title: '更新失败',
      description: '请检查录入内容后重试。',
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
    title="编辑技术底座"
    description="维护底座编号、类型、状态和服务对象。"
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <div class="grid gap-4 md:grid-cols-2">
          <UFormField label="底座编号">
            <UInput
              v-model="state.base_code"
              placeholder="留空保持原编号"
              class="w-full"
            />
          </UFormField>

          <UFormField label="底座名称" required>
            <UInput
              v-model="state.base_name"
              class="w-full"
            />
          </UFormField>

          <UFormField label="底座类型">
            <USelect
              v-model="state.base_type"
              :items="baseTypeOptions"
              class="w-full"
            />
          </UFormField>

          <UFormField label="当前状态">
            <USelect
              v-model="state.status"
              :items="baseStatusOptions"
              class="w-full"
            />
          </UFormField>

          <UFormField label="资产分级">
            <USelect
              v-model="state.asset_level"
              :items="assetLevelOptions"
              class="w-full"
            />
          </UFormField>
        </div>

        <UFormField label="服务对象">
          <UTextarea
            v-model="state.service_targets"
            :rows="3"
            class="w-full"
          />
        </UFormField>

        <UFormField label="备注">
          <UTextarea
            v-model="state.notes"
            :rows="4"
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
        <UButton :loading="submitting" icon="i-lucide-save" @click="handleSubmit">
          保存
        </UButton>
      </div>
    </template>
  </UModal>
</template>
