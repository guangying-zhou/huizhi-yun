<script setup lang="ts">
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import ContentPageHeader from '../../../../foundation/app/components/ContentPageHeader.vue'

const props = defineProps<{ open: boolean, page?: boolean, title: string, draft: string, busy: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const { confirm } = useConfirm()
const original = ref(props.draft)
const saved = ref(false)
onMounted(() => {
  original.value = props.draft
})
watch(() => [props.page, props.open] as const, ([page, open]) => {
  if (page && open) {
    original.value = props.draft
    saved.value = false
  }
})
async function canLeave() {
  if (!props.page || saved.value || props.draft === original.value) return true
  if (props.busy) return false
  return confirm({ title: '离开表单', message: `「${props.title}」有未保存修改，离开将丢失这些修改。是否继续？`, tone: 'warning', confirmLabel: '放弃修改并离开', cancelLabel: '继续编辑' })
}
onBeforeRouteUpdate(canLeave)
onBeforeRouteLeave(canLeave)
defineExpose({ markSaved: () => {
  saved.value = true
} })
</script>

<template>
  <section v-if="page" class="min-w-0 space-y-6 p-4 sm:p-6">
    <ContentPageHeader hosted :title="title">
      <template #actions>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-arrow-left"
          :disabled="busy"
          @click="emit('update:open', false)"
        >
          返回工作项
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
