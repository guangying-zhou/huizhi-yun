<template>
  <UModal v-model:open="isOpen" title="确认盖章" description="请登记实际盖章信息">
    <template #body>
      <div class="p-4 space-y-4">
        <UAlert
          color="warning"
          icon="i-lucide-stamp"
          title="盖章确认"
          :description="`请核对打印件与系统原文一致后，再确认《${docTitle || '当前文档'}》的盖章信息。`"
        />

        <UFormField label="盖章类型" required>
          <div class="grid grid-cols-2 gap-3">
            <UCheckbox
              v-for="item in sealTypeOptions"
              :key="item.value"
              :model-value="selectedSealTypes.includes(item.value)"
              :label="item.label"
              @update:model-value="toggleSealType(item.value, $event)"
            />
          </div>
        </UFormField>

        <UFormField label="文档页数" required>
          <UInput
            v-model="pageCountInput"
            type="number"
            min="1"
            placeholder="请输入页数"
          />
        </UFormField>

        <UFormField label="备注">
          <UTextarea
            v-model="remark"
            :rows="3"
            placeholder="可填写盖章说明"
            class="w-full"
          />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="outline" @click="isOpen = false">
          取消
        </UButton>
        <UButton color="primary" :loading="submitting" @click="handleConfirm">
          确认盖章
        </UButton>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
interface ApiErrorLike {
  data?: {
    message?: string
  }
  message?: string
}

const props = defineProps<{
  open: boolean
  reviewId: number
  docTitle?: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'success'): void
}>()

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const toast = useToast()
const submitting = ref(false)
const selectedSealTypes = ref<Array<'official' | 'legal' | 'finance' | 'contract'>>([])
const pageCountInput = ref('')
const remark = ref('')

const sealTypeOptions = [
  { label: '公章', value: 'official' as const },
  { label: '法人章', value: 'legal' as const },
  { label: '财务章', value: 'finance' as const },
  { label: '合同章', value: 'contract' as const }
]

const resetForm = () => {
  selectedSealTypes.value = []
  pageCountInput.value = ''
  remark.value = ''
}

const toggleSealType = (value: 'official' | 'legal' | 'finance' | 'contract', checked: boolean | 'indeterminate') => {
  if (checked === true) {
    if (!selectedSealTypes.value.includes(value)) {
      selectedSealTypes.value = [...selectedSealTypes.value, value]
    }
    return
  }

  selectedSealTypes.value = selectedSealTypes.value.filter(item => item !== value)
}

watch(isOpen, (open) => {
  if (!open) {
    resetForm()
  }
})

const handleConfirm = async () => {
  const pageCount = Number(pageCountInput.value)

  if (!selectedSealTypes.value.length) {
    toast.add({
      title: '缺少盖章类型',
      description: '请至少选择一种盖章类型',
      color: 'warning'
    })
    return
  }

  if (!Number.isInteger(pageCount) || pageCount < 1) {
    toast.add({
      title: '页数无效',
      description: '文档页数必须为正整数',
      color: 'warning'
    })
    return
  }

  submitting.value = true
  try {
    await $fetch(`/api/reviews/${props.reviewId}/seal`, {
      method: 'POST',
      body: {
        sealTypes: selectedSealTypes.value,
        pageCount,
        remark: remark.value || null
      }
    })

    toast.add({
      title: '盖章已确认',
      description: '系统已记录盖章信息',
      color: 'success'
    })

    isOpen.value = false
    emit('success')
  } catch (error: unknown) {
    const err = error as ApiErrorLike
    toast.add({
      title: '确认失败',
      description: err.data?.message || err.message || '确认盖章失败',
      color: 'error'
    })
  } finally {
    submitting.value = false
  }
}
</script>
