<script setup lang="ts">
import { onBeforeRouteLeave } from 'vue-router'
import ContentPageHeader from './ContentPageHeader.vue'

const props = defineProps<{ open: boolean, page?: boolean, title: string, draft: string, busy: boolean, ui?: Record<string, string> }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const { confirm } = useConfirm()
const original = props.draft
const saved = ref(false)
if (props.page) onBeforeRouteLeave(async () => {
  if (!props.page || saved.value) return true
  if (props.busy) return false
  return props.draft === original || await confirm({ title: '离开表单', message: `「${props.title}」有未保存修改，离开将丢失这些修改。是否继续？`, tone: 'warning', confirmLabel: '放弃修改并离开', cancelLabel: '继续编辑' })
})
defineExpose({ markSaved: () => {
  saved.value = true
} })
</script>

<template>
  <section v-if="page" class="space-y-6 p-4 sm:p-6">
    <ContentPageHeader hosted :title="title">
      <template #actions>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-arrow-left"
          :disabled="busy"
          @click="emit('update:open', false)"
        >
          返回
        </UButton>
      </template>
    </ContentPageHeader>
    <div class="w-full" style="max-width: 720px">
      <slot name="body" />
      <div class="mt-6 flex justify-end gap-2 border-t border-default pt-4">
        <slot name="footer" />
      </div>
    </div>
  </section>
  <USlideover
    v-else
    :open="open"
    :title="title"
    :ui="ui"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <slot name="body" />
    </template>
    <template #footer>
      <slot name="footer" />
    </template>
  </USlideover>
</template>
