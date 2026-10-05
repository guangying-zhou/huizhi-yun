<script setup lang="ts">
import ProjectNavbar from '../../app/components/project/ProjectNavbar.vue'
import { useAimsModule } from '../useAimsModule'

type Document = Record<string, unknown> & {
  id: number
  title?: string
  documentSource?: string
  codocsUuid?: string | null
}
const route = useRoute()
const { moduleUrl } = useAimsModule()
const projectId = computed(() => String(route.params.id || ''))
const documentId = computed(() => String(route.params.documentId || ''))
const item = ref<Document | null>(null)
const loading = ref(true)
const error = ref('')
function value(...keys: string[]) {
  for (const key of keys) {
    const v = item.value?.[key]
    if (v !== undefined && v !== null && String(v).trim())
      return String(v)
  }
  return '-'
}
async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const r = await $fetch<{
      code?: number
      data?: Document
    }>(moduleUrl(`/api/v1/projects/${projectId.value}/documents/${documentId.value}`))
    if (r.code !== 0 || !r.data)
      throw Error('文档详情暂不可用')
    item.value = r.data
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '文档详情暂不可用'
  } finally {
    loading.value = false
  }
}
watch([projectId, documentId], refresh)
onMounted(refresh)
</script>

<template>
  <UDashboardPanel id="enterprise-project-document-detail" :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex h-full min-h-0 flex-col">
        <ProjectNavbar>
          <template #actions>
            <UButton
              v-if="!error&&!loading&&item&&value('documentSource')==='codocs'&&value('codocsUuid')!=='-'"
              :to="moduleUrl(`/projects/${projectId}/documents/${documentId}/open`)"
              size="sm"
              icon="i-lucide-book-open"
            >
              安全打开
            </UButton>
          </template>
        </ProjectNavbar>
        <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-12 pt-4 sm:px-6">
          <section class="space-y-5">
            <UButton
              :to="moduleUrl(`/projects/${projectId}/documents`)"
              variant="link"
              color="neutral"
              size="sm"
              icon="i-lucide-arrow-left"
            >
              文档列表
            </UButton><UAlert
              v-if="error"
              color="error"
              title="无法读取文档"
              :description="error"
            /><USkeleton v-else-if="loading" class="h-48 w-full" /><template v-else-if="item">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <h2 class="text-xl font-semibold text-highlighted">
                    {{ item.title||'文档详情' }}
                  </h2><p class="text-sm text-muted">
                    {{ value('docCategory') }}
                  </p>
                </div>
              </div><UCard>
                <dl class="grid gap-5 sm:grid-cols-2">
                  <div>
                    <dt class="text-sm text-muted">
                      来源
                    </dt><dd>{{ value('documentSource') }}</dd>
                  </div><div>
                    <dt class="text-sm text-muted">
                      创建人
                    </dt><dd>{{ value('createdBy') }}</dd>
                  </div><div>
                    <dt class="text-sm text-muted">
                      创建时间
                    </dt><dd>{{ value('createdAt') }}</dd>
                  </div><div>
                    <dt class="text-sm text-muted">
                      Codocs 标识
                    </dt><dd>{{ value('codocsUuid') }}</dd>
                  </div>
                </dl>
              </UCard>
            </template>
          </section>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
