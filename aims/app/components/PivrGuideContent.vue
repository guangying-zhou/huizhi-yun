<script setup lang="ts">
import { renderSafeMarkdown } from '~/utils/safeMarkdown'

const runtimeConfig = useRuntimeConfig()
const content = ref('')
const loading = ref(true)
const errorMessage = ref('')

const documentUrl = computed(() => {
  const base = String(runtimeConfig.app.baseURL || '/').replace(/\/?$/, '/')
  return `${base}PIVR.md`
})

async function loadContent() {
  loading.value = true
  errorMessage.value = ''

  try {
    const markdown = await $fetch<string>(documentUrl.value, { responseType: 'text' })
    content.value = renderSafeMarkdown(markdown)
  } catch (error) {
    console.error('[PivrGuide] Failed to load PIVR.md:', error)
    errorMessage.value = '使用指南加载失败，请稍后重试。'
  } finally {
    loading.value = false
  }
}

onMounted(loadContent)
</script>

<template>
  <div
    v-if="loading"
    class="flex min-h-64 items-center justify-center text-muted"
    role="status"
  >
    <UIcon name="i-lucide-loader-circle" class="mr-2 size-5 animate-spin" />
    正在加载使用指南
  </div>

  <div v-else-if="errorMessage" class="py-8">
    <UAlert
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      title="加载失败"
      :description="errorMessage"
    >
      <template #actions>
        <UButton
          label="重新加载"
          color="error"
          variant="soft"
          size="sm"
          icon="i-lucide-refresh-cw"
          @click="loadContent"
        />
      </template>
    </UAlert>
  </div>

  <!-- Markdown is rendered through safeMarkdown before injection. -->
  <!-- eslint-disable vue/no-v-html -->
  <article
    v-else
    class="pivr-guide-markdown max-w-none"
    v-html="content"
  />
  <!-- eslint-enable vue/no-v-html -->
</template>

<style>
.pivr-guide-markdown {
  font-size: 0.9375rem;
  line-height: 1.75;
  color: var(--ui-text-highlighted);
}
.pivr-guide-markdown h1,
.pivr-guide-markdown h2,
.pivr-guide-markdown h3,
.pivr-guide-markdown h4 {
  color: var(--ui-text-highlighted);
  font-weight: 700;
  margin-top: 1.6em;
  margin-bottom: 0.55em;
  scroll-margin-top: 1rem;
}
.pivr-guide-markdown h1 {
  font-size: 1.5rem;
  margin-top: 0;
}
.pivr-guide-markdown h2 {
  border-bottom: 1px solid var(--ui-border);
  font-size: 1.25rem;
  padding-bottom: 0.35em;
}
.pivr-guide-markdown h3 { font-size: 1.1rem; }
.pivr-guide-markdown h4 { font-size: 1rem; }
.pivr-guide-markdown p { margin: 0.8em 0; }
.pivr-guide-markdown ul,
.pivr-guide-markdown ol {
  margin: 0.55em 0;
  padding-left: 1.5em;
}
.pivr-guide-markdown li { margin: 0.25em 0; }
.pivr-guide-markdown ul { list-style-type: disc; }
.pivr-guide-markdown ol { list-style-type: decimal; }
.pivr-guide-markdown strong { font-weight: 700; }
.pivr-guide-markdown em { font-style: italic; }
.pivr-guide-markdown code {
  background: var(--ui-bg-elevated);
  border-radius: 0.25rem;
  font-size: 0.875em;
  padding: 0.15em 0.35em;
}
.pivr-guide-markdown pre {
  background: var(--ui-bg-elevated);
  border-radius: 0.5rem;
  margin: 0.8em 0;
  overflow-x: auto;
  padding: 1em;
}
.pivr-guide-markdown pre code {
  background: transparent;
  padding: 0;
}
.pivr-guide-markdown table {
  border-collapse: collapse;
  font-size: 0.875rem;
  margin: 0.8em 0;
  width: 100%;
}
.pivr-guide-markdown th,
.pivr-guide-markdown td {
  border: 1px solid var(--ui-border);
  padding: 0.55em 0.75em;
  text-align: left;
  vertical-align: top;
}
.pivr-guide-markdown th {
  background: var(--ui-bg-elevated);
  font-weight: 600;
}
.pivr-guide-markdown hr {
  border: 0;
  border-top: 1px solid var(--ui-border);
  margin: 1.6em 0;
}
.pivr-guide-markdown blockquote {
  border-left: 3px solid var(--ui-border);
  color: var(--ui-text-muted);
  margin: 0.8em 0;
  padding-left: 1em;
}

@media (max-width: 639px) {
  .pivr-guide-markdown {
    font-size: 0.875rem;
  }
  .pivr-guide-markdown table {
    display: block;
    overflow-x: auto;
    white-space: nowrap;
  }
}
</style>
