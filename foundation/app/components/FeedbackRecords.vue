<script setup lang="ts">
import { formatDateTime } from '../utils/format'
import { feedbackKinds, feedbackPriorities, feedbackStates } from '../../shared/utils/feedbackLabels'

const props = withDefaults(defineProps<{
  admin?: boolean
  id?: string
}>(), { admin: false, id: '' })
interface RecordItem {
  id: string
  reporterName: string
  reporterUid: string
  text: {
    title: string
    kind: string
    priority: string
    description: string
    pageUrl: string
    browser?: string
    errors?: string[]
  }
  status: string
  issueIid: number
  issueUrl: string
  createdAt: string
  attachments?: { id: string, status: string, size: number, available: boolean }[]
  notificationPending: number
}
const auth = useAuth()
const imageURL = ref('')
let imageGeneration = 0
function clearImage() {
  imageGeneration++
  if (imageURL.value) URL.revokeObjectURL(imageURL.value)
  imageURL.value = ''
}
onBeforeUnmount(clearImage)
watch([() => auth.user.value, () => auth.tenant.value], clearImage)
async function viewImage(id: string, attachment: string) {
  clearImage()
  const generation = imageGeneration
  try {
    const r = await $fetch<{ data: { image: string } }>(`${base.value}/${encodeURIComponent(id)}/attachments/${attachment}`)
    if (generation !== imageGeneration) return
    const bytes = Uint8Array.from(atob(r.data.image), c => c.charCodeAt(0))
    imageURL.value = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
  } catch { error.value = '图片已过期或暂不可用。' }
}
async function cancelFeedback(id: string) {
  if (!await confirm({ title: '取消反馈投递？', message: '仅尚未建单或图片上传结果未知的反馈可取消。未知的 Issue 创建结果必须继续核对。', tone: 'warning', confirmLabel: '取消投递' })) return
  try {
    await $fetch(`${base.value}/${encodeURIComponent(id)}/cancel`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: {} })
    await load()
  } catch { error.value = '不能取消当前反馈，请核对 GitLab 建单结果。' }
}
async function cleanup(id: string) {
  if (!await confirm({ title: '清理已取消反馈的 GitLab 图片？', message: '仅删除此反馈已确认上传的孤儿图片，不删除 Issue。图片删除后不可恢复。', tone: 'danger', confirmLabel: '清理图片' })) return
  try {
    await $fetch(`${base.value}/${encodeURIComponent(id)}/cleanup-media`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: {} })
    await load()
  } catch { error.value = '图片清理尚未确认，请稍后重试或联系 GitLab 项目管理员。' }
}

const submitting = ref('')
const submitKeys = new Map<string, string>()
const statusFilter = ref('all')
const kindFilter = ref('all')
const filtered = computed(() => statusFilter.value !== 'all' || kindFilter.value !== 'all')
const statusOptions = [{ label: '全部状态', value: 'all' }, ...Object.entries(feedbackStates).map(([value, label]) => ({ value, label }))]
const kindOptions = [{ label: '全部类型', value: 'all' }, ...Object.entries(feedbackKinds).map(([value, label]) => ({ value, label }))]
const { page, pageSize, resetFilters } = useListPage({ pageSize: 20, filters: { status: statusFilter, kind: kindFilter }, defaults: { status: 'all', kind: 'all' }, syncUrl: !props.id })
usePageTitle(computed(() => props.admin ? '反馈管理' : props.id ? '反馈详情' : '我的反馈'))
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(load))
onBeforeUnmount(() => {
  loadGeneration++
  clearRefresh()
})
let loadGeneration = 0
const items = ref<RecordItem[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref('')
const { confirm } = useConfirm()
const base = computed(() => props.admin ? '/api/v1/console/feedback' : '/enterprise/api/feedback')
async function load() {
  const generation = ++loadGeneration
  clearImage()
  loading.value = true
  error.value = ''
  try {
    if (props.id) {
      const r = await $fetch<{
        data: RecordItem
      }>(`${base.value}/${encodeURIComponent(props.id)}`)
      if (generation !== loadGeneration) return
      items.value = [r.data]
      total.value = 1
    } else {
      const r = await $fetch<{
        data: {
          items: RecordItem[]
          total: number
        }
      }>(base.value, { query: { page: page.value, pageSize, status: statusFilter.value === 'all' ? undefined : statusFilter.value, kind: kindFilter.value === 'all' ? undefined : kindFilter.value } })
      if (generation !== loadGeneration) return
      items.value = r.data.items
      total.value = r.data.total
    }
  } catch (e) {
    if (generation !== loadGeneration) return
    total.value = 0
    const status = Number((e as {
      statusCode?: number
    }).statusCode)
    error.value = status === 403 ? '您没有查看反馈的权限。' : status === 404 ? '反馈不存在或您无权查看。' : '反馈服务暂不可用，请稍后重试。'
    items.value = []
  } finally {
    if (generation === loadGeneration) loading.value = false
  }
}
async function submitDraft(id: string) {
  if (submitting.value) return
  if (!await confirm({ title: '提交这条反馈？', message: '将按草稿中已确认的内容创建 GitLab Issue。', confirmLabel: '提交' })) return
  const key = submitKeys.get(id) || crypto.randomUUID()
  submitKeys.set(id, key)
  submitting.value = id
  try {
    await $fetch(`${base.value}/${encodeURIComponent(id)}/submit`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: {} })
    await load()
  } catch {
    error.value = '提交未完成，请刷新查看状态或重试；本次内容仍保留。'
  } finally {
    submitting.value = ''
  }
}
async function retry(id: string) {
  if (!await confirm({ title: '重试创建 Issue？', message: '仅对明确失败的反馈重新投递。结果未知的反馈会由系统核对。', confirmLabel: '重试' }))
    return
  try {
    await $fetch(`${base.value}/${encodeURIComponent(id)}/retry`, { method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, body: {} })
    await load()
  } catch {
    error.value = '重试未完成。请刷新查看状态；需要显式重试权限。'
  }
}
watch([page, statusFilter, kindFilter, () => props.id, () => props.admin], load, { immediate: true })
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-xl font-semibold">
        {{ admin ? '反馈管理' : id ? '反馈详情' : '我的反馈' }}
      </h1>
    </div>
    <div v-if="!id" class="flex flex-wrap items-end gap-3">
      <UFormField label="状态">
        <USelect
          v-model="statusFilter"
          :items="statusOptions"
          class="w-full sm:w-64"
          aria-label="筛选状态"
        />
      </UFormField>
      <UFormField label="类型">
        <USelect
          v-model="kindFilter"
          :items="kindOptions"
          class="w-full sm:w-40"
          aria-label="筛选类型"
        />
      </UFormField>
      <UButton
        v-if="filtered"
        color="neutral"
        variant="ghost"
        @click="resetFilters"
      >
        重置筛选
      </UButton>
    </div>
    <UAlert v-if="error" color="warning" :description="error" />
    <p v-else-if="loading" role="status" class="text-muted">
      正在加载反馈…
    </p>
    <CommonEmptyState
      v-else-if="!items.length"
      icon="i-lucide-message-square"
      :title="filtered ? '暂无符合条件的反馈' : '暂无反馈'"
      :description="filtered ? '请调整状态或类型筛选后重试。' : '点击右上角“反馈问题/需求”提交，随后可在这里查看处理进度。'"
    >
      <UButton
        v-if="filtered"
        color="neutral"
        variant="outline"
        @click="resetFilters"
      >
        清除筛选
      </UButton>
    </CommonEmptyState>
    <UCard v-for="item in (loading || error ? [] : items)" :key="item.id">
      <div class="space-y-3 break-words">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <h2 class="font-semibold">
            {{ item.text.title }}
          </h2><UBadge color="neutral" variant="subtle">
            {{ feedbackStates[item.status] || '状态待确认' }}
          </UBadge>
        </div>
        <UBadge color="info" variant="subtle">
          {{ feedbackKinds[item.text.kind] || '其他反馈' }}
        </UBadge>
        <p class="text-sm text-muted">
          {{ item.reporterName }} · {{ formatDateTime(item.createdAt, { second: undefined }) }} · 优先级：{{ feedbackPriorities[item.text.priority] || '未设置' }}
        </p>
        <p class="whitespace-pre-wrap">
          {{ item.text.description }}
        </p>
        <p class="break-all text-sm text-muted">
          页面：{{ item.text.pageUrl || '未提供' }}
        </p>
        <div v-if="item.attachments?.length" class="space-y-2">
          <p v-for="attachment in item.attachments" :key="attachment.id" class="text-sm">
            图片：{{ ({ staged: '已暂存', uploading: '上传结果待核对', uploaded: '已上传', failed: '上传失败', unknown: '上传结果待核对', expired: '本地图片已清理' } as Record<string, string>)[attachment.status] || attachment.status }}
            <UButton
              v-if="attachment.available"
              size="xs"
              color="neutral"
              @click="viewImage(item.id, attachment.id)"
            >
              查看图片
            </UButton>
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <UButton
            v-if="admin && ['draft', 'pending', 'failed', 'unknown'].includes(item.status)"
            color="neutral"
            variant="outline"
            @click="cancelFeedback(item.id)"
          >
            取消投递
          </UButton>
          <UButton
            v-if="admin && item.status === 'cancelled'"
            color="warning"
            variant="outline"
            @click="cleanup(item.id)"
          >
            清理孤儿图片
          </UButton>
          <UButton
            v-if="item.issueUrl"
            :to="item.issueUrl"
            external
            target="_blank"
            rel="noopener noreferrer"
            variant="outline"
          >
            已建单 #{{ item.issueIid }}
          </UButton>
          <UButton v-if="!id" :to="`/enterprise/feedback/${item.id}`" variant="ghost">
            查看详情
          </UButton>
          <UButton
            v-if="!admin && item.status === 'draft' && item.reporterUid === String(auth.user.value || '')"
            :loading="submitting === item.id"
            @click="submitDraft(item.id)"
          >
            继续提交
          </UButton>
          <UButton
            v-if="admin && item.status === 'failed'"
            color="warning"
            variant="outline"
            @click="retry(item.id)"
          >
            重试建单
          </UButton>
        </div>
        <p v-if="item.notificationPending" class="text-sm text-muted">
          管理员通知还有待投递项，后台会自动重试。
        </p>
        <p v-if="item.issueUrl" class="text-sm text-muted">
          GitLab 项目权限独立；无法打开时请联系系统管理员。
        </p>
      </div>
    </UCard>
    <div v-if="!id && !error" class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-muted" role="status">
        共 {{ total }} 条
      </p>
      <UPagination
        v-if="total > pageSize"
        v-model:page="page"
        :total="total"
        :items-per-page="pageSize"
        :sibling-count="0"
        :show-edges="false"
        :disabled="loading"
      />
    </div>
    <UModal
      :open="!!imageURL"
      title="反馈图片"
      description="已确认并经过处理的图片"
      @update:open="clearImage"
    >
      <template #body>
        <img
          :src="imageURL"
          alt="反馈图片"
          class="max-h-[70vh] w-full object-contain"
          data-feedback-private
        >
      </template>
    </UModal>
  </div>
</template>
