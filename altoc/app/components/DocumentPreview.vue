<script setup lang="ts">
import { Marked, Renderer } from 'marked'
import type { Tokens } from 'marked'
import mermaid from 'mermaid'

/**
 * 文档预览弹窗 — 从 Codocs 获取 Markdown 内容，用 marked + mermaid 渲染
 */
const props = defineProps<{
  uuid: string
  title: string
}>()

const open = defineModel<boolean>('open', { default: false })

const config = useRuntimeConfig()
const codocsUrl = (config.public as any).codocsBaseUrl || 'http://localhost:3001'

const loading = ref(true)
const content = ref('')
const docInfo = ref<any>(null)
const renderedHtml = ref('')
const contentRef = ref<HTMLElement | null>(null)

// 初始化 mermaid
let mermaidInited = false

function initMermaid() {
  if (mermaidInited) return
  mermaid.initialize({ startOnLoad: false, theme: 'default' })
  mermaidInited = true
}

// mermaid 代码块暂存
const mermaidCodes = new Map<string, string>()
let mermaidCounter = 0

const linkProtocols = new Set(['http:', 'https:', 'mailto:', 'tel:'])
const resourceProtocols = new Set(['http:', 'https:'])

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '\'': '&#39;'
  })[char] || char)
}

function isRelativeUrl(value: string): boolean {
  return value.startsWith('#') || value.startsWith('/') || value.startsWith('./') || value.startsWith('../')
}

function safeUrl(value: string, protocols: Set<string>): string {
  const trimmed = value.trim()
  if (!trimmed) return '#'
  if (isRelativeUrl(trimmed)) return escapeHtml(trimmed)

  try {
    const parsed = new URL(trimmed)
    if (protocols.has(parsed.protocol)) return escapeHtml(trimmed)
  } catch {
    return '#'
  }

  return '#'
}

function resolveCodocsImageUrl(href: string): string {
  const src = href.trim()
  if (src.startsWith('/api/')) return codocsUrl + src
  if (src.startsWith('http://') || src.startsWith('https://')) return src
  if (src.startsWith('/')) return codocsUrl + src
  return codocsUrl + '/' + src
}

// 配置 marked
const renderer = new Renderer()

renderer.html = ({ text }: Tokens.HTML | Tokens.Tag) => escapeHtml(text)

renderer.link = function ({ href, title, tokens }: Tokens.Link) {
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : ''
  return `<a href="${safeUrl(href, linkProtocols)}"${titleAttr}>${this.parser.parseInline(tokens)}</a>`
}

renderer.image = ({ href, title, text }: Tokens.Image) => {
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : ''
  const src = safeUrl(resolveCodocsImageUrl(href), resourceProtocols)
  return `<div class="flex justify-center my-2"><img src="${src}" alt="${escapeHtml(text || '')}"${titleAttr} class="max-w-full rounded"></div>`
}

renderer.code = ({ text, lang }: Tokens.Code) => {
  if (lang === 'mermaid') {
    mermaidCounter++
    const id = `mermaid-block-${mermaidCounter}`
    mermaidCodes.set(id, text)
    return `<div class="mermaid-placeholder my-4 overflow-x-auto flex justify-center border border-default rounded-lg p-4" id="${id}"></div>`
  }
  const escaped = escapeHtml(text)
  return `<pre class="bg-elevated rounded p-3 my-2 overflow-x-auto"><code class="text-sm font-mono">${escaped}</code></pre>`
}

const marked = new Marked({ renderer })

async function renderContent(md: string) {
  if (!md) {
    renderedHtml.value = '<p class="text-muted">文档为空</p>'
    return
  }

  // 重置 mermaid 暂存
  mermaidCodes.clear()
  mermaidCounter = 0

  renderedHtml.value = await marked.parse(md) as string
}

watch(open, async (val) => {
  if (val && props.uuid) {
    loading.value = true
    try {
      const res = await $fetch<any>('/api/v1/documents/preview', { query: { uuid: props.uuid } })
      if (res.code === 0 && res.data) {
        content.value = res.data.content || ''
        docInfo.value = res.data
        await renderContent(content.value)
      } else {
        renderedHtml.value = '<p class="text-error">加载文档内容失败</p>'
      }
    } catch {
      renderedHtml.value = '<p class="text-error">加载文档内容失败</p>'
    } finally {
      // 先让 loading 结束，DOM 中 v-else 渲染出 contentRef
      loading.value = false
      // 等待 DOM 更新后再渲染 mermaid
      if (mermaidCodes.size > 0) {
        await nextTick()
        await nextTick()
        initMermaid()
        for (const [id, code] of mermaidCodes) {
          const el = document.getElementById(id)
          if (!el) continue
          try {
            const renderId = `render-${id}-${Date.now()}`
            const { svg } = await mermaid.render(renderId, code)
            el.innerHTML = svg
          } catch (err) {
            console.warn('[Mermaid] Render failed for', id, ':', err)
            el.innerHTML = '<div class="text-xs text-error p-3 bg-elevated rounded border border-error/20">Mermaid 图表渲染失败</div>'
          }
        }
      }
    }
  }
})

function openInCodocs() {
  window.open(`${codocsUrl}/documents/${props.uuid}`, '_blank')
}
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'max-w-5xl w-[75vw]' }" title="文档预览">
    <template #content>
      <UCard :ui="{ body: 'min-h-[40vh] max-h-[70vh] overflow-y-auto' }">
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-semibold">{{ title }}</span>
            <div class="flex items-center gap-2">
              <UButton
                label="在 Codocs 中编辑"
                icon="i-lucide-external-link"
                size="sm"
                variant="soft"
                color="primary"
                @click="openInCodocs"
              />
              <UButton
                icon="i-lucide-x"
                variant="ghost"
                color="neutral"
                size="xs"
                @click="open = false"
              />
            </div>
          </div>
        </template>

        <div v-if="loading" class="space-y-3 py-4">
          <USkeleton class="h-6 w-3/4" />
          <USkeleton class="h-4 w-full" />
          <USkeleton class="h-4 w-full" />
          <USkeleton class="h-4 w-2/3" />
        </div>

        <!-- Markdown is rendered through a safe marked renderer before injection. -->
        <!-- eslint-disable vue/no-v-html -->
        <div
          v-if="!loading"
          ref="contentRef"
          class="prose prose-sm max-w-none text-sm leading-relaxed"
          v-html="renderedHtml"
        />
        <!-- eslint-enable vue/no-v-html -->

        <template #footer>
          <div class="flex items-center justify-between text-xs text-muted">
            <span v-if="docInfo">最后更新：{{ docInfo.updated_at }}</span>
            <span v-if="docInfo">作者：<UserName :uid="docInfo.owner_uid" /></span>
          </div>
        </template>
      </UCard>
    </template>
  </UModal>
</template>
