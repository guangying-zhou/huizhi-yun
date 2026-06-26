<script setup lang="ts">
import type { ApiResponse, DigitalAssetItem } from '~/types'

const props = defineProps<{ open: boolean, asset: DigitalAssetItem | null }>()
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
const typeOptions = computed(() => getOptions('digital_asset_type'))
const statusOptions = computed(() => getOptions('digital_asset_status'))
const accessScopeOptions = computed(() => getOptions('digital_access_scope'))

const state = reactive({
  digital_name: '',
  digital_type: '',
  storage_location: '',
  owner_uid: '',
  access_scope: '',
  project_code: '',
  environment_id: '',
  status: '',
  notes: ''
})

function hydrate() {
  state.digital_name = props.asset?.digital_name || ''
  state.digital_type = props.asset?.digital_type || 'document'
  state.storage_location = props.asset?.storage_location || ''
  state.owner_uid = props.asset?.owner_uid || ''
  state.access_scope = props.asset?.access_scope || 'project'
  state.project_code = props.asset?.project_code || ''
  state.environment_id = props.asset?.environment_id ? String(props.asset.environment_id) : ''
  state.status = props.asset?.status || 'active'
  state.notes = props.asset?.notes || ''
}

watch(() => props.open, (open) => {
  if (open) hydrate()
})
watch(() => props.asset, () => {
  if (props.open) hydrate()
})

async function handleSubmit() {
  if (!props.asset?.id) return
  if (!state.digital_name.trim()) {
    toast.add({ title: '缺少名称', description: '请先填写数字资产名称。', color: 'warning' })
    return
  }
  submitting.value = true
  try {
    await $fetch<ApiResponse<{ id: number }>>(`/api/v1/digital-assets/${props.asset.id}`, {
      method: 'PATCH',
      body: {
        digital_name: state.digital_name.trim(),
        digital_type: state.digital_type || null,
        storage_location: state.storage_location.trim() || null,
        owner_uid: state.owner_uid.trim() || null,
        access_scope: state.access_scope || null,
        project_code: state.project_code.trim() || null,
        environment_id: state.environment_id ? Number(state.environment_id) : null,
        status: state.status || null,
        notes: state.notes.trim() || null
      }
    })
    toast.add({ title: '数字资产已更新', description: '主要信息已保存。', color: 'success', icon: 'i-lucide-check' })
    emit('updated')
    isOpen.value = false
  } catch (error) {
    console.error('[DigitalAssetEdit] Failed:', error)
    toast.add({ title: '更新失败', description: '请检查录入内容后重试。', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    title="编辑数字资产"
    description="维护存储位置、访问权限、关联项目和状态。"
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <div class="grid gap-4 md:grid-cols-2">
          <UFormField label="名称" required>
            <UInput
              v-model="state.digital_name"
              class="w-full"
            />
          </UFormField>
          <UFormField label="子类型">
            <USelect
              v-model="state.digital_type"
              :items="typeOptions"
              class="w-full"
            />
          </UFormField>
          <UFormField label="当前状态">
            <USelect
              v-model="state.status"
              :items="statusOptions"
              class="w-full"
            />
          </UFormField>
          <UFormField label="访问权限">
            <USelect
              v-model="state.access_scope"
              :items="accessScopeOptions"
              class="w-full"
            />
          </UFormField>
          <UFormField label="负责人 UID">
            <UInput
              v-model="state.owner_uid"
              class="w-full"
            />
          </UFormField>
          <UFormField label="关联项目编码">
            <UInput
              v-model="state.project_code"
              class="w-full"
            />
          </UFormField>
          <UFormField label="关联环境 ID">
            <UInput
              v-model="state.environment_id"
              type="number"
              class="w-full"
            />
          </UFormField>
        </div>
        <UFormField label="存储位置">
          <UInput
            v-model="state.storage_location"
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
