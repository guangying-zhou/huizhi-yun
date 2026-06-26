<script setup lang="ts">
import type { ApiResponse, IpAssetItem } from '~/types'

const props = defineProps<{ open: boolean, asset: IpAssetItem | null }>()
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
const typeOptions = computed(() => getOptions('ip_asset_type'))
const statusOptions = computed(() => getOptions('ip_asset_status'))

const state = reactive({
  ip_name: '',
  ip_type: '',
  registration_no: '',
  right_holder: '',
  apply_date: '',
  effective_date: '',
  expires_at: '',
  status: '',
  owner_uid: '',
  notes: ''
})

function hydrate() {
  state.ip_name = props.asset?.ip_name || ''
  state.ip_type = props.asset?.ip_type || 'software_copyright'
  state.registration_no = props.asset?.registration_no || ''
  state.right_holder = props.asset?.right_holder || ''
  state.apply_date = props.asset?.apply_date || ''
  state.effective_date = props.asset?.effective_date || ''
  state.expires_at = props.asset?.expires_at || ''
  state.status = props.asset?.status || 'active'
  state.owner_uid = props.asset?.owner_uid || ''
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
  if (!state.ip_name.trim()) {
    toast.add({ title: '缺少名称', description: '请先填写知识产权名称。', color: 'warning' })
    return
  }
  submitting.value = true
  try {
    await $fetch<ApiResponse<{ id: number }>>(`/api/v1/ip-assets/${props.asset.id}`, {
      method: 'PATCH',
      body: {
        ip_name: state.ip_name.trim(),
        ip_type: state.ip_type || null,
        registration_no: state.registration_no.trim() || null,
        right_holder: state.right_holder.trim() || null,
        apply_date: state.apply_date || null,
        effective_date: state.effective_date || null,
        expires_at: state.expires_at || null,
        status: state.status || null,
        owner_uid: state.owner_uid.trim() || null,
        notes: state.notes.trim() || null
      }
    })
    toast.add({ title: '知识产权资产已更新', description: '主要信息已保存。', color: 'success', icon: 'i-lucide-check' })
    emit('updated')
    isOpen.value = false
  } catch (error) {
    console.error('[IpAssetEdit] Failed:', error)
    toast.add({ title: '更新失败', description: '请检查录入内容后重试。', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    title="编辑知识产权资产"
    description="维护知识产权状态、权利信息和到期时间。"
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <div class="grid gap-4 md:grid-cols-2">
          <UFormField label="名称" required>
            <UInput
              v-model="state.ip_name"
              class="w-full"
            />
          </UFormField>
          <UFormField label="类型">
            <USelect
              v-model="state.ip_type"
              :items="typeOptions"
              class="w-full"
            />
          </UFormField>
          <UFormField label="状态">
            <USelect
              v-model="state.status"
              :items="statusOptions"
              class="w-full"
            />
          </UFormField>
          <UFormField label="证书编号 / 登记号">
            <UInput
              v-model="state.registration_no"
              class="w-full"
            />
          </UFormField>
          <UFormField label="权利人">
            <UInput
              v-model="state.right_holder"
              class="w-full"
            />
          </UFormField>
          <UFormField label="维护负责人 UID">
            <UInput
              v-model="state.owner_uid"
              class="w-full"
            />
          </UFormField>
          <UFormField label="申请日期">
            <UInput
              v-model="state.apply_date"
              type="date"
              class="w-full"
            />
          </UFormField>
          <UFormField label="授权/有效日期">
            <UInput
              v-model="state.effective_date"
              type="date"
              class="w-full"
            />
          </UFormField>
          <UFormField label="到期日期" class="md:col-span-2">
            <UInput
              v-model="state.expires_at"
              type="date"
              class="w-full"
            />
          </UFormField>
        </div>
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
