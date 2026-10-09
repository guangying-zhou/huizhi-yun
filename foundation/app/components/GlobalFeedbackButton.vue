<script setup lang="ts">
import FeedbackImageEditor from './FeedbackImageEditor.vue'
import { assertFeedbackImage, captureFeedbackDisplay, captureFeedbackViewport, feedbackImageLimits } from '../utils/feedbackImages'
import { collectFeedbackErrors, resetFeedbackCapture } from '../composables/useIssueReporter'
import { feedbackPageURL, feedbackSubmissionURL, redactFeedbackDiagnostic } from '../../shared/utils/feedbackPrivacy'

const props = defineProps<{
  identity: string
  displayName: string
}>()
const { confirm } = useConfirm()
const route = useRoute()
const mediaEnabled = ref(false)
const editingImage = shallowRef<Blob | null>(null)
const capturing = ref(false)
const captureHidden = ref(false)
const images = shallowRef<{ id: string, blob: Blob, url: string }[]>([])
const fileInput = ref<HTMLInputElement>()
function clearImages() {
  images.value.forEach(i => URL.revokeObjectURL(i.url))
  images.value = []
  editingImage.value = null
}
function removeImage(id: string) {
  const item = images.value.find(i => i.id === id)
  if (item) URL.revokeObjectURL(item.url)
  images.value = images.value.filter(i => i.id !== id)
}
function editImage(blob?: Blob) {
  if (!blob || busy.value || draftId.value || !mediaEnabled.value) return
  try {
    assertFeedbackImage(blob)
    if (images.value.length >= feedbackImageLimits.count) throw Error('最多附带 5 张图片。')
    editingImage.value = blob
  } catch (e) { error.value = (e as Error).message }
}
function pasted(e: ClipboardEvent) {
  const file = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'))
  if (file) {
    e.preventDefault()
    editImage(file)
  }
}
function picked(e: Event) {
  const input = e.target as HTMLInputElement
  editImage(input.files?.[0])
  input.value = ''
}
function confirmedImage(blob: Blob) {
  if (images.value.reduce((n, i) => n + i.blob.size, blob.size) > feedbackImageLimits.total) {
    error.value = '图片合计不能超过 15 MiB。'
    return
  }
  images.value = [...images.value, { id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob) }]
  editingImage.value = null
}
async function capture(native = false) {
  if (!native && !await confirm({ title: '截图当前可视区域？', message: '已标记敏感区域会遮挡，但可能有遗漏。请在预览中检查、遮挡后确认附带。', confirmLabel: '开始截图' })) return
  const generation = identityGeneration, path = route.fullPath
  capturing.value = true
  captureHidden.value = true
  error.value = ''
  try {
    // Native picker is invoked in the original button gesture, before awaiting.
    let nativeError: unknown
    const nativeCapture = native
      ? captureFeedbackDisplay().catch((e) => {
          nativeError = e
          return null
        })
      : null
    await nextTick()
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const image = await (nativeCapture || captureFeedbackViewport())
    if (nativeError) throw nativeError
    if (!image) return
    if (generation !== identityGeneration || route.fullPath !== path) return
    editingImage.value = image
  } catch (e) { if (generation === identityGeneration) error.value = (e as Error).message } finally {
    capturing.value = false
    captureHidden.value = false
  }
}
watch(() => route.fullPath, () => {
  identityGeneration++
  clearImages()
  open.value = false
  reset()
})

let identityGeneration = 0
onBeforeUnmount(() => {
  identityGeneration++
  clearImages()
  resetFeedbackCapture('')
})
const open = ref(false)
const busy = ref(false)
const ready = ref(false)
const loading = ref(false)
const error = ref('')
const resultId = ref('')
const draftId = ref('')
const intent = ref('')
const kind = ref('bug')
const priority = ref('mid')
const title = ref('')
const description = ref('')
const pageUrl = ref('')
const browserChecked = ref(false)
const errorsChecked = ref(false)
const errors = ref<string[]>([])
const browser = ref('')
const priorities = computed(() => [{ label: '低', value: 'low' }, { label: '中', value: 'mid' }, { label: '高', value: 'high' }, ...(kind.value === 'bug' ? [{ label: '阻断', value: 'blocking' }] : [])])
watch(kind, () => {
  if (kind.value !== 'bug' && priority.value === 'blocking')
    priority.value = 'mid'
})
function reset() {
  clearImages()
  mediaEnabled.value = false
  busy.value = false
  loading.value = false
  title.value = ''
  description.value = ''
  pageUrl.value = ''
  error.value = ''
  resultId.value = ''
  draftId.value = ''
  intent.value = ''
  browserChecked.value = false
  errorsChecked.value = false
  errors.value = []
  browser.value = ''
  ready.value = false
}
watch(() => props.identity, (identity) => {
  identityGeneration++
  resetFeedbackCapture(identity)
  reset()
  open.value = false
}, { immediate: true })
function message(e: unknown) {
  const status = Number((e as {
    statusCode?: number
    status?: number
  }).statusCode || (e as {
    status?: number
  }).status)
  return status === 403 ? '当前账号没有反馈权限，请联系系统管理员。' : status === 409 ? '这次提交状态已变化。请查看“我的反馈”，避免重复提交。' : status === 400 ? '请检查必填项、长度和页面地址。' : '反馈服务暂不可用，内容已保留，请稍后重试。'
}
async function loadOptions() {
  const generation = identityGeneration
  loading.value = true
  ready.value = false
  error.value = ''
  try {
    const r = await $fetch<{
      data: {
        enabled: boolean
        mediaEnabled?: boolean
      }
    }>('/enterprise/api/feedback/options')
    if (generation !== identityGeneration) return
    ready.value = r.data.enabled
    mediaEnabled.value = r.data.mediaEnabled === true
    if (!ready.value)
      error.value = '反馈入口尚未启用，请联系系统管理员。'
  } catch (e) {
    if (generation === identityGeneration) error.value = message(e)
  } finally {
    if (generation === identityGeneration) loading.value = false
  }
}
async function show() {
  open.value = true
  if (!title.value && !description.value && !draftId.value) {
    pageUrl.value = feedbackPageURL(window.location.href)
    errors.value = collectFeedbackErrors()
    browser.value = redactFeedbackDiagnostic(navigator.userAgent).slice(0, 500)
  }
  await loadOptions()
}
async function close(value: boolean) {
  if (value || busy.value)
    return
  if (!resultId.value && (title.value || description.value) && !await confirm({ title: '关闭反馈？', message: '本次内容会保留在当前页面，刷新或退出登录后清除。', confirmLabel: '关闭' }))
    return
  open.value = false
}
async function submit() {
  const generation = identityGeneration
  busy.value = true
  error.value = ''
  intent.value ||= crypto.randomUUID()
  try {
    if (!draftId.value) {
      const r = await $fetch<{
        data: {
          id: string
        }
      }>('/enterprise/api/feedback/drafts', { method: 'POST', headers: { 'Idempotency-Key': `${intent.value}:draft` }, body: { text: { attachmentIds: images.value.map(i => i.id), kind: kind.value, priority: priority.value, title: title.value, description: description.value, pageUrl: feedbackSubmissionURL(pageUrl.value, window.location.origin), ...(browserChecked.value ? { browser: browser.value } : {}), ...(errorsChecked.value ? { errors: errors.value } : {}) } } })
      if (generation !== identityGeneration) return
      draftId.value = r.data.id
    }
    for (const image of images.value) {
      await $fetch(`/enterprise/api/feedback/${encodeURIComponent(draftId.value)}/attachments/${image.id}`, { method: 'PUT', headers: { 'Idempotency-Key': `${intent.value}:${image.id}`, 'Content-Type': 'image/png' }, body: image.blob })
      if (generation !== identityGeneration) return
    }
    await $fetch(`/enterprise/api/feedback/${encodeURIComponent(draftId.value)}/submit`, { method: 'POST', headers: { 'Idempotency-Key': `${intent.value}:submit` }, body: {} })
    if (generation !== identityGeneration) return
    resultId.value = draftId.value
    clearImages()
  } catch (e) {
    if (generation === identityGeneration) error.value = message(e)
  } finally {
    if (generation === identityGeneration) busy.value = false
  }
}
</script>

<template>
  <UButton
    icon="i-lucide-message-square-plus"
    color="neutral"
    variant="ghost"
    aria-label="反馈问题/需求"
    title="反馈问题/需求"
    @click="show"
  />
  <UModal
    :open="open && !captureHidden"
    title="反馈问题/需求"
    description="发送至研发反馈项目，由系统管理员跟进。"
    :dismissible="!busy"
    :ui="{ content: 'sm:max-w-2xl' }"
    @update:open="close"
  >
    <template #body>
      <div data-feedback-ui class="space-y-4" @paste="pasted">
        <UAlert v-if="error" color="warning" :description="error" />
        <div v-if="resultId" class="space-y-3">
          <UAlert color="success" title="反馈已受理" description="正在创建 GitLab Issue，可在“我的反馈”查看编号和投递状态。" />
          <UButton :to="`/enterprise/feedback/${resultId}`" @click="open = false">
            查看本次反馈
          </UButton>
        </div>
        <FeedbackImageEditor
          v-else-if="editingImage"
          :image="editingImage"
          @confirmed="confirmedImage"
          @cancel="editingImage = null"
        />
        <fieldset v-else class="space-y-4" :disabled="busy || !!draftId">
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="类型">
              <USelect v-model="kind" class="w-full" :items="[{ label: '问题', value: 'bug' }, { label: '需求', value: 'feature' }, { label: '建议', value: 'suggestion' }]" />
            </UFormField>
            <UFormField :label="kind === 'bug' ? '影响程度' : '期望优先级'">
              <USelect v-model="priority" class="w-full" :items="priorities" />
            </UFormField>
          </div>
          <UFormField label="标题" required>
            <UInput v-model="title" class="w-full" :maxlength="160" />
          </UFormField>
          <UFormField label="描述" required>
            <UTextarea
              v-model="description"
              class="w-full"
              :rows="5"
              :maxlength="10000"
              placeholder="发生了什么？期望什么？如何复现？请勿填写密码、Token 或个人敏感资料。"
            />
          </UFormField>
          <UFormField label="页面 URL" hint="提交时删除查询参数和锚点">
            <UInput v-model="pageUrl" class="w-full" :maxlength="2048" />
          </UFormField>
          <div class="space-y-2">
            <p class="text-sm font-medium">
              图片（{{ images.length }}/5）
            </p>
            <p v-if="!mediaEnabled" class="text-sm text-muted">
              图片投递暂未启用，仍可提交文字反馈。
            </p>
            <template v-else>
              <input
                ref="fileInput"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                class="hidden"
                aria-label="上传反馈图片"
                @change="picked"
              >
              <div class="flex flex-wrap gap-2">
                <UButton color="neutral" variant="outline" @click="fileInput?.click()">
                  上传图片
                </UButton>
                <UButton
                  color="neutral"
                  variant="outline"
                  :loading="capturing"
                  @click="capture()"
                >
                  自动截图当前页
                </UButton>
                <UButton color="neutral" variant="ghost" @click="capture(true)">
                  选择标签页截图
                </UButton>
              </div>
              <p class="text-xs text-muted">
                也可在此弹窗粘贴图片。原生截图可能包含其他窗口；请仔细预览。
              </p>
              <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div v-for="image in images" :key="image.id" class="space-y-1 rounded border border-muted p-2">
                  <img :src="image.url" alt="已确认的反馈图片" class="h-24 w-full object-contain">
                  <UButton size="xs" color="neutral" @click="removeImage(image.id)">
                    移除图片
                  </UButton>
                </div>
              </div>
            </template>
          </div>
          <UCheckbox v-model="browserChecked" label="附带浏览器信息" />
          <UCheckbox v-model="errorsChecked" :label="`附带最近错误摘要（${errors.length} 条）`" />
          <details class="text-sm">
            <summary class="cursor-pointer">
              预览可选诊断信息
            </summary><pre class="mt-2 whitespace-pre-wrap break-all rounded bg-elevated p-3">{{ browserChecked ? browser : '未附带浏览器信息' }}
            {{ errorsChecked ? errors.join('\n') || '无最近错误' : '未附带错误摘要' }}</pre>
          </details>
          <p class="text-sm text-muted">
            提交人：{{ displayName }}；身份与接收时间由服务端记录。GitLab 默认显示您的姓名。
          </p>
        </fieldset>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full flex-wrap justify-between gap-2">
        <UButton
          to="/enterprise/feedback"
          color="neutral"
          variant="ghost"
          @click="open = false"
        >
          我的反馈
        </UButton>
        <UButton v-if="resultId" color="neutral" @click="reset(); open = false">
          完成
        </UButton>
        <UButton
          v-else-if="!ready"
          color="neutral"
          :loading="loading"
          @click="loadOptions"
        >
          重试加载
        </UButton>
        <UButton
          v-else
          :loading="busy"
          :disabled="!title.trim() || !description.trim() || !!editingImage || capturing"
          @click="submit"
        >
          {{ draftId ? '重试提交' : '提交反馈' }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
