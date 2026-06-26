<script setup lang="ts">
import type { ApiResponse } from '~/types'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  'created': [id: number]
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
  digital_code: '',
  digital_name: '',
  digital_type: 'document',
  storage_location: '',
  owner_uid: '',
  access_scope: 'project',
  project_code: '',
  environment_id: '',
  status: 'active',
  notes: ''
})

watch(() => props.open, (open) => {
  if (open) {
    state.digital_code = ''
    state.digital_name = ''
    state.digital_type = 'document'
    state.storage_location = ''
    state.owner_uid = ''
    state.access_scope = 'project'
    state.project_code = ''
    state.environment_id = ''
    state.status = 'active'
    state.notes = ''
  }
})

async function handleSubmit() {
  if (!state.digital_name.trim()) {
    toast.add({ title: '缺少名称', description: '请先填写数字资产名称。', color: 'warning' })
    return
  }

  submitting.value = true

  try {
    const response = await $fetch<ApiResponse<{ id: number }>>('/api/v1/digital-assets', {
      method: 'POST',
      body: {
        digital_code: state.digital_code.trim() || null,
        digital_name: state.digital_name.trim(),
        digital_type: state.digital_type,
        storage_location: state.storage_location.trim() || null,
        owner_uid: state.owner_uid.trim() || null,
        access_scope: state.access_scope,
        project_code: state.project_code.trim() || null,
        environment_id: state.environment_id ? Number(state.environment_id) : null,
        status: state.status,
        notes: state.notes.trim() || null
      }
    })

    toast.add({ title: '数字资产已创建', description: '可以进入详情页继续关联产品。', color: 'success', icon: 'i-lucide-check' })
    emit('created', response.data.id)
    isOpen.value = false
  } catch (error) {
    console.error('[DigitalAssetCreate] Failed:', error)
    toast.add({ title: '创建失败', description: '请检查录入内容后重试。', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    title="新增数字资产"
    description="登记代码、文档、数据、模型和交付物资产。"
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <div class="grid gap-4 md:grid-cols-2">
          <UFormField label="资产编号">
            <UInput
              v-model="state.digital_code"
              placeholder="留空自动生成"
              class="w-full"
            />
          </UFormField>
          <UFormField label="名称" required>
            <UInput
              v-model="state.digital_name"
              placeholder="例如：AI 运维平台主代码仓"
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
            placeholder="例如：Git URL / Codocs 链接 / OSS 路径"
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
          创建
        </UButton>
      </div>
    </template>
  </UModal>
</template>
