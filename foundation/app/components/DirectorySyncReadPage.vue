<script setup lang="ts">
import ContentPageHeader from './ContentPageHeader.vue'
import type { DirectorySyncJob, DirectorySyncEvent } from '../types/consoleDirectorySync'

const props = defineProps<{ apiPath: string, pagePath: string, consolePath: string, jobCode?: string }>()
usePageTitle(props.jobCode ? '同步任务详情' : '目录同步')
const detail = computed(() => Boolean(props.jobCode))
const path = computed(() => detail.value ? `${props.apiPath}/${encodeURIComponent(props.jobCode || '')}` : props.apiPath)
interface SyncPage<T> { items: T[], total: number, page: number, pageSize: number }
const route = useRoute()
const router = useRouter()
const { user } = useAuth()
const scopeKey = useState<string>('enterprise-cache-scope', () => '')
const pageSize = 20
const page = computed(() => Math.max(1, Number(route.query.page) || 1))
const eventPage = computed(() => Math.max(1, Number(route.query.eventPage) || 1))
const data = ref<DirectorySyncJob | SyncPage<DirectorySyncJob> | null>(null)
const eventData = ref<SyncPage<DirectorySyncEvent> | null>(null)
const pending = ref(false)
const eventsPending = ref(false)
const failure = ref<{ statusCode: number } | null>(null)
let generation = 0
let controller: AbortController | undefined
const job = computed(() => detail.value && data.value && 'jobCode' in data.value ? data.value : undefined)
const jobs = computed(() => !detail.value && data.value && 'items' in data.value ? data.value.items : [])
const total = computed(() => data.value && 'total' in data.value ? data.value.total : 0)
const backPath = computed(() => {
  const value = typeof route.query.returnTo === 'string' ? route.query.returnTo : ''
  try { const url = new URL(value, 'https://host.invalid'); return url.origin === 'https://host.invalid' && url.pathname === props.pagePath ? `${url.pathname}${url.search}` : props.pagePath } catch { return props.pagePath }
})
const consoleLink = computed(() => detail.value ? `${props.consolePath}/${encodeURIComponent(props.jobCode || '')}` : props.consolePath)
function changePage(next: number) { return router.push({ path: route.path, query: { ...route.query, [detail.value ? 'eventPage' : 'page']: String(next) } }) }
async function refreshAll() {
  const epoch = ++generation
  controller?.abort(); controller = new AbortController()
  data.value = null; eventData.value = null; failure.value = null; eventsPending.value = false
  if (!user.value || !scopeKey.value) { pending.value = false; return }
  pending.value = true
  try {
    const result = await $fetch<{ code: number, data: DirectorySyncJob | SyncPage<DirectorySyncJob> }>(path.value, { query: detail.value ? {} : { page: page.value, pageSize }, signal: controller.signal })
    if (epoch !== generation) return
    data.value = result.data
    if (!detail.value && page.value > Math.max(1, Math.ceil(total.value / pageSize))) { void changePage(Math.max(1, Math.ceil(total.value / pageSize))); return }
    if (detail.value && job.value) {
      eventsPending.value = true
      const events = await $fetch<{ code: number, data: SyncPage<DirectorySyncEvent> }>(`${path.value}/events`, { query: { page: eventPage.value, pageSize }, signal: controller.signal })
      if (epoch !== generation) return
      eventData.value = events.data
      const last = Math.max(1, Math.ceil(events.data.total / pageSize))
      if (eventPage.value > last) void changePage(last)
    }
  } catch (error) {
    if (epoch === generation) { data.value = null; eventData.value = null; failure.value = { statusCode: Number((error as { statusCode?: number }).statusCode) || 503 } }
  } finally { if (epoch === generation) { pending.value = false; eventsPending.value = false } }
}
await refreshAll()
watch([() => route.fullPath, () => props.jobCode, user, scopeKey], refreshAll, { flush: 'sync' })
onScopeDispose(() => { generation++; controller?.abort() })
</script>

<template>
  <UDashboardPanel id="enterprise-directory-sync">
    <template #body>
      <ContentPageHeader hosted :title="detail ? '同步任务详情' : '目录同步'" description="查看同步状态、数量与时间。详细诊断和同步操作在控制台处理。">
        <template #actions>
          <UButton
            v-if="detail"
            :to="backPath"
            color="neutral"
            variant="ghost"
            label="返回列表"
          />
          <UButton
            :to="consoleLink"
            external
            color="neutral"
            variant="outline"
            label="在控制台查看详情"
          />
          <UButton
            icon="i-lucide-refresh-cw"
            aria-label="刷新同步记录"
            :loading="pending || eventsPending"
            @click="refreshAll"
          />
        </template>
      </ContentPageHeader>
      <CommonEmptyState v-if="failure?.statusCode === 403" title="无权限" description="你没有查看目录同步的权限。" />
      <UAlert
        v-else-if="failure"
        color="error"
        title="同步记录加载失败"
        description="请稍后重试或在控制台查看详情。"
      />
      <USkeleton v-else-if="pending" class="h-48" />
      <div v-else-if="detail && job">
        <DirectorySyncJobDetails
          :job="job"
          :events="eventData?.items || []"
          :events-pending="eventsPending"
          redacted
        />
        <div class="flex flex-wrap items-center justify-between gap-2 mt-4">
          <span class="text-sm text-muted">共 {{ eventData?.total || 0 }} 条事件</span>
          <UPagination :page="eventPage" :items-per-page="pageSize" :total="eventData?.total || 0" :sibling-count="0" @update:page="changePage" />
        </div>
      </div>
      <CommonEmptyState v-else-if="detail" title="未找到同步任务" />
      <UCard v-else>
        <template #header>
          <h2 class="font-semibold">
            最近同步任务
          </h2>
          <p class="text-sm text-muted">
            共 {{ total }} 条任务。
          </p>
        </template>
        <DirectorySyncJobsTable
          :jobs="jobs"
          :loading="pending"
          :detail-path="pagePath"
          :return-to="route.fullPath"
          redacted
        />
        <template #footer>
          <UPagination :page="page" :items-per-page="pageSize" :total="total" :sibling-count="0" @update:page="changePage" />
        </template>
      </UCard>
    </template>
  </UDashboardPanel>
</template>
