<script setup lang="ts">
import ContentPageHeader from '@hzy/foundation/app/components/ContentPageHeader.vue'
import CommonEmptyState from '@hzy/foundation/app/components/common/EmptyState.vue'
import EnterpriseAdminProjectEditor from '../../app/components/project/EnterpriseAdminProjectEditor.vue'
import type { AdminProject } from '../../app/types/adminProject'
import { useAimsModule } from '../useAimsModule'

definePageMeta({
  hostContentInset: false })
const route = useRoute(), router = useRouter()
const {
  moduleUrl } = useAimsModule()
const project = ref<AdminProject | null>(null), loading = ref(false), error = ref(''), forbidden = ref(false)
const cacheScope = useState<string>('enterprise-cache-scope', () => '')
let generation = 0
async function load() {
  const current = ++generation
  loading.value = true
  error.value = ''
  project.value = null
  forbidden.value = false
  try {
    const res = await $fetch<{
      code: number
      data: {
        items: AdminProject[] } }>(moduleUrl('/api/v1/admin/projects'), {
      query: {
        projectId: String(route.params.id), page: 1, pageSize: 20 } })
    if (current !== generation) return
    if (res.code !== 0) throw Error('项目响应无效')
    project.value = res.data.items.find(item => String(item.id) === String(route.params.id)) || null
    if (!project.value) error.value = '项目不存在或已不可访问'
  } catch (cause) {
    if (current !== generation) return
    forbidden.value = (cause as {
      statusCode?: number }).statusCode === 403
    error.value = forbidden.value ? '你没有管理员项目编辑权限' : '项目加载失败，请重试'
  } finally {
    if (current === generation) loading.value = false
  }
}
watch(cacheScope, () => void load())
watch(() => route.params.id, () => void load(), {
  immediate: true })
</script>

<template>
  <div class="space-y-4 p-4 sm:p-6">
    <ContentPageHeader hosted title="编辑项目">
      <template #actions>
        <UButton
          :to="moduleUrl('/admin/projects')"
          color="neutral"
          variant="outline"
          icon="i-lucide-arrow-left"
        >
          返回项目管理
        </UButton>
      </template>
    </ContentPageHeader>
    <CommonEmptyState v-if="loading" title="正在加载项目" />
    <CommonEmptyState v-else-if="error" :title="forbidden ? '无权限' : '加载失败'" :description="error">
      <template #actions>
        <UButton v-if="!forbidden" @click="load">
          重试
        </UButton>
      </template>
    </CommonEmptyState>
    <EnterpriseAdminProjectEditor v-else-if="project" :project="project" @saved="router.push(moduleUrl('/admin/projects'))" />
  </div>
</template>
