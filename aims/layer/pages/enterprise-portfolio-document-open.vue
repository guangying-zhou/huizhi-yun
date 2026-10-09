<script setup lang="ts">
import { projectPageFailure } from '../../app/utils/projectPageFailure'
import MarkdownContent from '../../app/components/MarkdownContent.vue'
import { renderSafeMarkdown } from '../../app/utils/safeMarkdown'
import { useAimsModule } from '../useAimsModule'

// 项目集文档正文查看（Host 原生页，DOC-05 5c-2）。只读：不提供编辑、下载或协作入口。
type OpenResult = {
  document?: { id: number, title: string }
  access?: { relation?: string, confidentialityLevel?: string, lifecycleStage?: string }
  content?: { title?: string, content?: string, updatedAt?: string }
}
const relationLabels: Record<string, string> = { manager: '管理者', contributor: '参与者', viewer: '查看者', inherited: '组内项目成员' }
const levelLabels: Record<string, string> = { L0: 'L0 公开', L1: 'L1 内部', L2: 'L2 机密', L3: 'L3 绝密' }

const route = useRoute()
const { moduleUrl } = useAimsModule()
const portfolioId = computed(() => String(route.params.id || ''))
const documentId = computed(() => String(route.params.docId || ''))
const data = ref<OpenResult | null>(null)
const loading = ref(true)
const error = ref('')

// 与项目内其它正文展示同一个渲染器与净化规则（原始 HTML 被转义，链接与图片地址按协议白名单）。
// 渲染失败或渲染结果为空时回退为纯文本。
const markdown = computed(() => data.value?.content?.content || '')
const renderable = computed(() => {
  if (!markdown.value) return false
  try {
    return renderSafeMarkdown(markdown.value).trim().length > 0
  } catch {
    return false
  }
})

async function refresh() {
  loading.value = true
  error.value = ''
  data.value = null
  try {
    const response = await $fetch<{ code?: number, data?: OpenResult }>(moduleUrl(`/api/v1/portfolios/${portfolioId.value}/documents/${documentId.value}/open`))
    if (response.code !== 0 || !response.data) throw Error('文档内容暂不可用')
    data.value = response.data
  } catch (cause) {
    const failure = cause as { statusCode?: number }
    // 无权查看与文档不存在是同一个回答，页面也不区分。
    error.value = [403, 404].includes(failure.statusCode || 0)
      ? '文档不存在，或你没有查看权限。'
      : failure.statusCode === 409
        ? '文档已变化，请刷新后重试。'
        : projectPageFailure(cause, '文档内容暂不可用')
  } finally {
    loading.value = false
  }
}
watch([portfolioId, documentId], refresh)
onMounted(refresh)
</script>

<template>
  <UDashboardPanel id="enterprise-portfolio-document-open" :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-12 pt-4 sm:px-6">
        <section class="mx-auto max-w-4xl space-y-5">
          <div class="flex flex-wrap items-center gap-2">
            <UButton
              :to="moduleUrl(`/portfolios/${portfolioId}`)"
              variant="link"
              color="neutral"
              size="sm"
              icon="i-lucide-arrow-left"
              class="-ml-2"
            >
              返回项目集文档
            </UButton>
            <UButton
              aria-label="刷新"
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="ghost"
              size="sm"
              square
              class="ml-auto"
              :loading="loading"
              @click="refresh"
            />
          </div>
          <UAlert
            v-if="error"
            color="error"
            icon="i-lucide-circle-alert"
            title="无法打开文档"
            :description="error"
          />
          <USkeleton v-else-if="loading" class="h-80 w-full" />
          <template v-else-if="data">
            <div class="space-y-2">
              <h1 class="break-words text-xl font-semibold text-highlighted">
                {{ data.document?.title || data.content?.title || '文档内容' }}
              </h1>
              <div class="flex flex-wrap items-center gap-2 text-sm text-muted">
                <UBadge color="neutral" variant="subtle" icon="i-lucide-lock">
                  只读
                </UBadge>
                <UBadge v-if="data.access?.confidentialityLevel" :color="['L2', 'L3'].includes(data.access.confidentialityLevel) ? 'warning' : 'neutral'" variant="subtle">
                  {{ levelLabels[data.access.confidentialityLevel] || data.access.confidentialityLevel }}
                </UBadge>
                <span v-if="data.access?.relation">以{{ relationLabels[data.access.relation] || data.access.relation }}身份查看</span>
                <span v-if="data.content?.updatedAt">更新于 {{ data.content.updatedAt }}</span>
              </div>
            </div>
            <UCard>
              <MarkdownContent v-if="renderable" :markdown="markdown" class="portfolio-document-body min-w-0 break-words text-sm text-default" />
              <pre v-else-if="markdown" class="whitespace-pre-wrap break-words font-sans text-sm text-default">{{ markdown }}</pre>
              <CommonEmptyState
                v-else
                icon="i-lucide-file-text"
                title="文档暂无正文"
                description="这份文档还没有内容。"
              />
            </UCard>
          </template>
        </section>
      </div>
    </template>
  </UDashboardPanel>
</template>

<style scoped>
/* 仅本页：长代码行与宽表格在卡片内横向滚动，不撑破窄屏布局。 */
.portfolio-document-body :deep(pre) {
  max-width: 100%;
  overflow-x: auto;
}
.portfolio-document-body :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
}
.portfolio-document-body :deep(img) {
  max-width: 100%;
  height: auto;
}
</style>
