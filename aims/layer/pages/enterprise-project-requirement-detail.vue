<script setup lang="ts">
import { projectPageFailure } from '../../app/utils/projectPageFailure'
import { statusLabel, typeLabel, priorityColor, statusColor, sourceLabel } from '../../app/config/requirement'
import { priorityConfig } from '../../app/config/work-item'
import type { Priority } from '../../app/types/aims'
import ProjectNavbar from '../../app/components/project/ProjectNavbar.vue'
import { useAimsModule } from '../useAimsModule'

type Requirement = { title?: string, reqCode?: string, type?: string, priority?: string, status?: string, source?: string, milestoneName?: string, currentVersion?: string | number, scopeNote?: string, contents?: Array<{ id: number, title: string, contentMd?: string }> }
const route = useRoute()
const { moduleUrl } = useAimsModule()
const projectId = computed(() => String(route.params.id || ''))
const requirementId = computed(() => String(route.params.requirementId || ''))
const item = ref<Requirement | null>(null)
const loading = ref(false)
const error = ref('')
async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const response = await $fetch<{
      code?: number
      data?: Requirement
    }>(moduleUrl(`/api/v1/projects/${projectId.value}/requirements/${requirementId.value}`))
    if (response.code !== 0 || !response.data)
      throw Error('需求详情暂不可用')
    item.value = response.data
  } catch (cause) {
    error.value = projectPageFailure(cause, '需求详情暂不可用')
  } finally {
    loading.value = false
  }
}
onMounted(refresh)
</script>

<template>
  <UDashboardPanel id="enterprise-project-requirement-detail" :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex h-full min-h-0 flex-col">
        <ProjectNavbar />
        <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-12 pt-4 sm:px-6">
          <section class="space-y-5">
            <div>
              <UButton
                :to="moduleUrl(`/projects/${projectId}/requirements`)"
                variant="link"
                color="neutral"
                size="sm"
                icon="i-lucide-arrow-left"
              >
                需求列表
              </UButton><h2 class="mt-1 text-xl font-semibold text-highlighted">
                {{ item?.title || '需求详情' }}
              </h2><p class="mt-1 text-sm text-muted">
                {{ item?.reqCode || '-' }}
              </p>
            </div><UAlert
              v-if="error"
              color="error"
              title="无法读取需求"
              :description="error"
            /><USkeleton v-else-if="loading" class="h-64 w-full" /><template v-else-if="item">
              <UCard>
                <dl class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <dt class="text-sm text-muted">
                      类型
                    </dt><dd>{{ typeLabel[item.type || ''] || item.type || '-' }}</dd>
                  </div><div>
                    <dt class="text-sm text-muted">
                      优先级
                    </dt><dd>
                      <UBadge :color="priorityColor[item.priority || ''] || 'neutral'" variant="subtle">
                        {{ priorityConfig[item.priority as Priority]?.label || item.priority || '-' }}
                      </UBadge>
                    </dd>
                  </div><div>
                    <dt class="text-sm text-muted">
                      状态
                    </dt><dd>
                      <UBadge :color="statusColor[item.status || ''] || 'neutral'" variant="subtle">
                        {{ statusLabel[item.status || ''] || item.status || '-' }}
                      </UBadge>
                    </dd>
                  </div><div>
                    <dt class="text-sm text-muted">
                      来源
                    </dt><dd>{{ sourceLabel[item.source || ''] || item.source || '-' }}</dd>
                  </div><div>
                    <dt class="text-sm text-muted">
                      里程碑
                    </dt><dd>{{ item.milestoneName || '-' }}</dd>
                  </div><div>
                    <dt class="text-sm text-muted">
                      当前版本
                    </dt><dd>{{ item.currentVersion || '-' }}</dd>
                  </div>
                </dl><p v-if="item.scopeNote" class="mt-5 whitespace-pre-wrap text-sm">
                  {{ item.scopeNote }}
                </p>
              </UCard><UCard v-if="item.contents?.length">
                <template #header>
                  <h2 class="font-semibold">
                    需求内容
                  </h2>
                </template><div v-for="content in item.contents" :key="content.id" class="mb-5">
                  <h3 class="font-medium">
                    {{ content.title }}
                  </h3><p class="mt-1 whitespace-pre-wrap text-sm text-muted">
                    {{ content.contentMd || '暂无内容' }}
                  </p>
                </div>
              </UCard>
            </template>
          </section>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
