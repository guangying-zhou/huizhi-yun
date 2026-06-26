<script setup lang="ts">
import { renderSafeMarkdown } from '~/utils/safeMarkdown'

const showModal = ref(false)
const content = ref('')
const loading = ref(false)

async function openHelp() {
  showModal.value = true
  if (content.value) return
  loading.value = true
  try {
    const md = await $fetch<string>('/PIVR.md', { responseType: 'text' })
    content.value = renderSafeMarkdown(md)
  } catch (err) {
    console.error('[PivrHelp] Failed to load PIVR.md:', err)
    content.value = '<p class="text-error">加载失败，请重试</p>'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UTooltip text="PIVR 模型说明">
    <UButton
      icon="i-lucide-help-circle"
      color="neutral"
      variant="ghost"
      size="sm"
      square
      @click="openHelp"
    />
  </UTooltip>

  <UModal
    v-model:open="showModal"
    :ui="{ content: 'sm:max-w-4xl max-h-[85vh]' }"
  >
    <template #header>
      <div class="flex items-center justify-between w-full">
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-book-open" class="size-5 text-primary" />
          <h3 class="text-lg font-semibold">
            PIVR 项目管理生命周期模型
          </h3>
        </div>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="sm"
          square
          @click="showModal = false"
        />
      </div>
    </template>
    <template #body>
      <div v-if="loading" class="flex justify-center py-12">
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
      </div>
      <!-- Markdown is rendered through safeMarkdown before injection. -->
      <!-- eslint-disable vue/no-v-html -->
      <div
        v-if="!loading"
        class="pivr-markdown max-w-none overflow-y-auto px-6 py-4"
        style="max-height: calc(85vh - 130px);"
        v-html="content"
      />
      <!-- eslint-enable vue/no-v-html -->
    </template>
  </UModal>
</template>

<style>
.pivr-markdown {
  font-size: 0.9375rem;
  line-height: 1.7;
  color: var(--ui-text-highlighted);
}
.pivr-markdown h1, .pivr-markdown h2, .pivr-markdown h3, .pivr-markdown h4 {
  font-weight: 700;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
  color: var(--ui-text-highlighted);
}
.pivr-markdown h1 { font-size: 1.5rem; }
.pivr-markdown h2 { font-size: 1.25rem; border-bottom: 1px solid var(--ui-border); padding-bottom: 0.3em; }
.pivr-markdown h3 { font-size: 1.1rem; }
.pivr-markdown h4 { font-size: 1rem; }
.pivr-markdown p { margin: 0.75em 0; }
.pivr-markdown ul, .pivr-markdown ol { margin: 0.5em 0; padding-left: 1.5em; }
.pivr-markdown li { margin: 0.25em 0; }
.pivr-markdown ul { list-style-type: disc; }
.pivr-markdown ol { list-style-type: decimal; }
.pivr-markdown strong { font-weight: 700; }
.pivr-markdown em { font-style: italic; }
.pivr-markdown code {
  background: var(--ui-bg-elevated);
  padding: 0.15em 0.35em;
  border-radius: 0.25rem;
  font-size: 0.875em;
}
.pivr-markdown pre {
  background: var(--ui-bg-elevated);
  padding: 1em;
  border-radius: 0.5rem;
  overflow-x: auto;
  margin: 0.75em 0;
}
.pivr-markdown pre code {
  background: transparent;
  padding: 0;
}
.pivr-markdown table {
  width: 100%;
  border-collapse: collapse;
  margin: 0.75em 0;
  font-size: 0.875rem;
}
.pivr-markdown th, .pivr-markdown td {
  border: 1px solid var(--ui-border);
  padding: 0.5em 0.75em;
  text-align: left;
}
.pivr-markdown th {
  background: var(--ui-bg-elevated);
  font-weight: 600;
}
.pivr-markdown hr {
  border: none;
  border-top: 1px solid var(--ui-border);
  margin: 1.5em 0;
}
.pivr-markdown blockquote {
  border-left: 3px solid var(--ui-border);
  padding-left: 1em;
  margin: 0.75em 0;
  color: var(--ui-text-muted);
}
</style>
