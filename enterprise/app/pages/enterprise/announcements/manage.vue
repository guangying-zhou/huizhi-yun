<script setup lang="ts">
import type { Announcement, AnnouncementPage } from '../../../../../console/shared/announcements'

definePageMeta({ name: 'console-host-announcements-manage', navigationOwner: 'console' })

const page = ref(1)
const { data, error, refresh, status } = await useFetch<AnnouncementPage>('/enterprise/api/announcements/manage', { query: { page } })
const { data: departments } = await useFetch<{ code: number, data: { value: string, label: string }[] }>('/enterprise/api/announcements/departments')
const fresh = (): Announcement => ({ id: '', title: '', body: '', level: 'info', startsAt: '', endsAt: '', audience: 'all', departments: [], popup: false, banner: true, bell: false, wecom: false, revision: 0, status: 'published', read: false })
const form = ref(fresh())
const scheduled = computed(() => Boolean(form.value.startsAt) && new Date(form.value.startsAt).getTime() > Date.now())
watch(scheduled, (value) => {
  if (value) {
    form.value.bell = false
    form.value.wecom = false
  }
})
const editing = ref(false)
const saving = ref(false)
const message = ref('')
const saveError = ref('')
let attempt = { intent: '', key: '' }
function localDate(value: string) {
  if (!value) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
function edit(item?: Announcement) {
  form.value = item ? { ...item, departments: [...item.departments], startsAt: localDate(item.startsAt), endsAt: localDate(item.endsAt) } : { ...fresh(), id: crypto.randomUUID(), startsAt: localDate(new Date().toISOString()) }
  editing.value = true
  saveError.value = ''
}
async function save() {
  saving.value = true
  saveError.value = ''
  try {
    const { status: _status, read: _read, delivery: _delivery, ...value } = form.value
    const body = { ...value, startsAt: new Date(value.startsAt).toISOString(), endsAt: value.endsAt ? new Date(value.endsAt).toISOString() : '', departments: value.audience === 'all' ? [] : [...value.departments].sort() }
    if ((body.bell || body.wecom) && new Date(body.startsAt).getTime() > Date.now()) throw new Error('定时公告本轮不支持通知，请关闭铃铛和企业微信选项')
    const intent = JSON.stringify(body)
    if (attempt.intent !== intent) attempt = { intent, key: crypto.randomUUID() }
    const result = await $fetch<{ notificationDelivery?: { pending: number | null } }>('/enterprise/api/announcements/manage', { method: 'POST', body, headers: { 'Idempotency-Key': attempt.key } })
    editing.value = false
    message.value = result.notificationDelivery?.pending !== 0 && result.notificationDelivery ? '公告已发布，仍有通知待完成，请使用原键恢复按钮重试。' : '公告已发布；定时生效的公告本轮不支持推送。'
    await refresh()
  } catch (e) {
    saveError.value = Number((e as { statusCode?: number }).statusCode) === 409 ? '公告已被修改，请重新加载后编辑' : '保存失败，请检查内容、时间及权限后重试'
  } finally {
    saving.value = false
  }
}
async function retryDelivery(item: Announcement) {
  try {
    await $fetch(`/enterprise/api/announcements/${item.id}/deliver`, { method: 'POST', body: {}, headers: { 'Idempotency-Key': `announcement-deliver:${item.id}` } })
    await refresh()
  } catch { message.value = '通知尚未完成，请稍后使用原键恢复重试' }
}
const { confirm } = useConfirm()
async function withdraw(item: Announcement) {
  if (!await confirm({ title: '撤回公告', message: '撤回后员工不再看到此公告，已经发送的通知无法撤回。', confirmLabel: '撤回' })) return
  try {
    await $fetch(`/enterprise/api/announcements/${item.id}/withdraw`, { method: 'POST', body: { revision: item.revision }, headers: { 'Idempotency-Key': `withdraw:${item.id}:${item.revision}` } })
    await refresh()
  } catch { message.value = '撤回失败，请刷新列表后重试。' }
}
</script>

<template>
  <div class="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6">
    <ContentPageHeader
      hosted
      title="系统公告"
      description="管理全员或指定部门的公告。时间按本机时区填写。"
    >
      <template #actions>
        <UButton
          :disabled="Boolean(error)"
          icon="i-lucide-plus"
          @click="edit()"
        >
          发布公告
        </UButton>
      </template>
    </ContentPageHeader>
    <UAlert
      v-if="message"
      :title="message"
      color="neutral"
    />
    <UAlert
      v-if="error"
      color="error"
      :title="error.statusCode === 403 ? '无公告管理权限' : '公告服务暂不可用'"
      :actions="[{ label: '重试', onClick: () => refresh() }]"
    />
    <p v-else-if="status === 'pending'">
      正在加载…
    </p>
    <UCard
      v-for="item in data?.data.items"
      :key="item.id"
    >
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="break-words font-semibold">
            {{ item.title }}
          </h2><p
            v-if="item.delivery && !item.delivery.prepared"
            class="text-sm text-muted"
          >
            等待生效（定时通知不支持）
          </p><p
            v-else-if="item.delivery"
            class="text-sm text-muted"
          >
            通知待投递 {{ item.delivery.pending }} · 已送达 {{ item.delivery.delivered }} · 重试中 {{ item.delivery.retrying }}
          </p><p class="text-sm text-muted">
            {{ item.status === 'withdrawn' ? '已撤回' : '已发布' }} · {{ item.audience === 'all' ? '全员' : '指定部门' }} · {{ new Date(item.startsAt).toLocaleString() }} 生效
          </p>
        </div><div class="flex gap-2">
          <UButton
            v-if="item.delivery?.pending"
            variant="outline"
            @click="retryDelivery(item)"
          >
            原键恢复通知
          </UButton>
          <UButton
            variant="outline"
            @click="edit(item)"
          >
            编辑
          </UButton><UButton
            v-if="item.status === 'published'"
            color="error"
            variant="ghost"
            @click="withdraw(item)"
          >
            撤回
          </UButton>
        </div>
      </div>
    </UCard>
    <p v-if="!error && status !== 'pending' && !data?.data.items.length">
      尚无公告，点击「发布公告」开始。
    </p>
    <div class="flex gap-2">
      <UButton
        :disabled="page === 1"
        variant="outline"
        @click="page--"
      >
        上一页
      </UButton><UButton
        :disabled="!data?.data.hasMore"
        variant="outline"
        @click="page++"
      >
        下一页
      </UButton>
    </div>
    <UModal
      v-model:open="editing"
      title="发布系统公告"
      :dismissible="!saving"
      :ui="{ content: 'sm:max-w-3xl' }"
    >
      <template #body>
        <form
          id="announcement-form"
          class="space-y-4"
          @submit.prevent="save"
        >
          <UFormField
            label="标题"
            required
          >
            <UInput
              v-model="form.title"
              required
              maxlength="160"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="正文（Markdown）"
            required
          >
            <UTextarea
              v-model="form.body"
              required
              :rows="8"
              class="w-full"
            />
          </UFormField>
          <details>
            <summary class="cursor-pointer">
              预览正文
            </summary><SafeMarkdown :content="form.body" />
          </details>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="级别">
              <USelect
                v-model="form.level"
                :items="[{ label: '通知', value: 'info' }, { label: '重要提醒', value: 'warning' }]"
                class="w-full"
              />
            </UFormField><UFormField label="可见范围">
              <USelect
                v-model="form.audience"
                :items="[{ label: '全员', value: 'all' }, { label: '指定部门（不含子部门）', value: 'departments' }]"
                class="w-full"
              />
            </UFormField>
          </div>
          <UFormField
            v-if="form.audience === 'departments'"
            label="选择部门"
            required
          >
            <USelectMenu
              v-model="form.departments"
              multiple
              :items="departments?.data || []"
              value-key="value"
              class="w-full"
              placeholder="选择可见部门"
            /><p
              v-if="!departments"
              class="text-error"
            >
              部门列表不可用，请刷新后重试。
            </p>
          </UFormField>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField
              label="生效时间"
              required
            >
              <UInput
                v-model="form.startsAt"
                type="datetime-local"
                required
                class="w-full"
              />
            </UFormField><UFormField label="失效时间（留空为常驻）">
              <UInput
                v-model="form.endsAt"
                type="datetime-local"
                class="w-full"
              />
            </UFormField>
          </div>
          <UCheckbox
            v-model="form.banner"
            label="显示顶部横幅"
          /><UCheckbox
            v-model="form.popup"
            label="员工首次进入后弹窗，已读后不再弹"
          /><UCheckbox
            v-model="form.bell"
            :disabled="scheduled"
            label="同时推送顶栏铃铛"
          /><UCheckbox
            v-model="form.wecom"
            :disabled="scheduled"
            label="同时推送企业微信"
          />
          <p class="text-sm text-muted">
            修订不清空员工已读记录。需要再次弹窗提醒时，请发布新公告。通知仅发送提示与链接，正文需登录后查看。
          </p>
        </form>
      </template>
      <template #footer>
        <div class="w-full space-y-3">
          <UAlert
            v-if="saveError"
            :title="saveError"
            color="error"
          />
          <div class="flex gap-2">
            <UButton
              type="submit"
              form="announcement-form"
              :loading="saving"
            >
              发布
            </UButton>
            <UButton
              variant="ghost"
              :disabled="saving"
              @click="editing = false"
            >
              取消
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
