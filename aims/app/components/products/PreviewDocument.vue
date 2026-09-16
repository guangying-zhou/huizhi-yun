<script setup lang="ts">
import MarkdownContent from '../MarkdownContent.vue'

const props = defineProps<{ productCode: string, bizId: string, documentUuid: string, disabled?: boolean }>()
const open = ref(false), loading = ref(false)
const data = ref<{ uuid: string, title: string, content: string, updatedAt: string }>()
const error = ref<unknown>(null)
const alert = useApiErrorAlert(error, { fallbackTitle: '文档正文读取失败' })
let generation = 0
watch([open, () => props.productCode, () => props.bizId, () => props.documentUuid], load)
async function load() {
  const request = ++generation
  data.value = undefined
  error.value = null
  loading.value = false
  if (!open.value) return
  const product = props.productCode, bizId = props.bizId, uuid = props.documentUuid
  loading.value = true
  try {
    const response = await $fetch<{ code: number, data: { uuid: string, title: string, content: string, updatedAt: string } }, string>(`/api/v1/products/${encodeURIComponent(product)}/roadmaps/documents/content`, { query: { bizId }, retry: 0, timeout: 30000 })
    const value = response.data
    if (response.code !== 0 || value?.uuid !== uuid || typeof value.title !== 'string' || typeof value.content !== 'string' || typeof value.updatedAt !== 'string') throw new Error('文档正文响应不完整')
    if (request === generation) data.value = value
  } catch (cause) {
    if (request === generation) error.value = cause
  } finally {
    if (request === generation) loading.value = false
  }
}
</script>

<template>
  <UButton
    color="neutral"
    variant="ghost"
    :disabled="disabled"
    @click="open = true"
  >
    阅读文档
  </UButton>
  <UModal
    v-model:open="open"
    title="产品文档预览"
    description="只读查看 Codocs 当前正文。"
    :ui="{ content: 'sm:max-w-4xl' }"
  >
    <template #body>
      <div class="min-w-0 space-y-4">
        <p v-if="loading" role="status" class="text-sm text-muted">
          正在读取文档…
        </p>
        <UAlert v-if="alert" v-bind="alert" />
        <template v-if="data">
          <h2 class="break-words text-lg font-semibold">
            {{ data.title }}
          </h2>
          <p class="text-xs text-muted">
            更新于 {{ data.updatedAt }}
          </p>
          <div class="max-h-[60vh] overflow-auto break-words">
            <MarkdownContent v-if="data.content.trim()" :markdown="data.content" />
            <CommonEmptyState
              v-else
              icon="i-lucide-file"
              title="文档暂无正文"
              description="可在 Codocs 中编辑内容。"
            />
          </div>
        </template>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="outline"
          :loading="loading"
          @click="load"
        >
          重新读取
        </UButton>
        <UButton color="neutral" @click="open = false">
          关闭
        </UButton>
      </div>
    </template>
  </UModal>
</template>
