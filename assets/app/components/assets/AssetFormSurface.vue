<script setup lang="ts">
import { onBeforeRouteLeave } from 'vue-router'
import ContentPageHeader from '../../../../foundation/app/components/ContentPageHeader.vue'

const props = defineProps<{
  open: boolean
  page?: boolean
  title: string
  description?: string
  draft: string
  busy: boolean
  ui?: Record<string, string>
}>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const { confirm } = useConfirm()
const initialDraft = ref(props.draft)
const saved = ref(false)
onMounted(() => {
  initialDraft.value = props.draft
})

onBeforeRouteLeave(async () => {
  if (!props.page || saved.value) return true
  if (props.busy) return false
  if (props.draft === initialDraft.value) return true
  return confirm({
    title: '离开表单',
    message: `「${props.title}」有未保存修改，离开将丢失这些修改。是否继续？`,
    tone: 'warning',
    confirmLabel: '放弃修改并离开',
    cancelLabel: '继续编辑'
  })
})

defineExpose({ markSaved: () => {
  saved.value = true
} })
</script>

<template>
  <section v-if="page" class="min-w-0 space-y-6 p-4 sm:p-6">
    <ContentPageHeader :title="title" :description="description" hosted>
      <template #actions>
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="outline"
          :disabled="busy"
          @click="emit('update:open', false)"
        >
          返回
        </UButton>
      </template>
    </ContentPageHeader>
    <div class="w-full max-w-[720px]">
      <slot name="body" />
      <div class="mt-6 border-t border-default pt-4">
        <slot name="footer" />
      </div>
    </div>
  </section>
  <UModal
    v-else
    :open="open"
    :title="title"
    :description="description"
    :ui="ui"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <slot name="body" />
    </template>
    <template #footer>
      <slot name="footer" />
    </template>
  </UModal>
</template>
