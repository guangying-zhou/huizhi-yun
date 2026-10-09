<script setup lang="ts">
import { requireAltocJsonMutationResult } from '../utils/altocBusinessObjectPresentation'
import AltocBusinessObjectSelect from './AltocBusinessObjectSelect.vue'
import RemoteObjectSelectMenu from '../../../foundation/app/components/RemoteObjectSelectMenu.vue'
import { contactStarLabels, type W3Record } from '../utils/w3Presentation'
import { createReviewMutationIntent } from '@hzy/foundation/shared/utils/reviewMutationIntent'

const props = defineProps<{
  customer: W3Record
  contacts: W3Record[]
}>()
const emit = defineEmits<{
  changed: [
  ]
}>()
const { loaded, error: permissionError, hasPermission } = usePermissions()
const canEdit = computed(() => loaded.value && !permissionError.value && hasPermission('customer', 'edit'))
const scope = useState<string>('enterprise-cache-scope', () => '')
const { confirm } = useConfirm()
const toast = useToast()
const open = ref(false)
const mode = ref<'parent' | 'primary' | 'star'>('parent')
const selection = ref('')
const target = ref<W3Record | null>(null)
const version = ref(0)
const saving = ref(false)
const error = ref('')
const comparison = ref<W3Record | null>(null)
let generation = 0
let intent = createReviewMutationIntent('w3-customer', ['altoc_customer_version_conflict', 'altoc_customer_write_conflict', 'altoc_customer_hierarchy_invalid', 'altoc_primary_contact_invalid', 'altoc_customer_fields_unavailable'])
const title = computed(() => ({ parent: '设置上级客户', primary: '设置主联系人', star: '编辑联系人星级' })[mode.value])
const starOptions = contactStarLabels.map((label, index) => ({ label, value: String(index + 1) }))
const contactRows = ref<W3Record[]>([])
const contactPage = ref(1)
const { search: contactSearch, debounced: contactSearchDebounced, flush: flushContactSearch } = useDebouncedSearch()
const contactHasMore = ref(false)
const contactsPending = ref(false)
const contactsError = ref('')
let contactGeneration = 0
async function loadContactChoices(append = false) {
  if (append && (contactsPending.value || !contactHasMore.value)) return
  const requestedPage = append ? contactPage.value + 1 : 1
  const epoch = ++contactGeneration
  if (!append) {
    contactRows.value = []
    contactPage.value = 1
    contactHasMore.value = false
  }
  contactsError.value = ''
  contactsPending.value = false
  if (!open.value || mode.value !== 'primary' || !canEdit.value || !scope.value)
    return
  contactsPending.value = true
  try {
    const response = await $fetch<{
      data: {
        items: W3Record[]
        total: number
      }
    }>(`/altoc/api/v1/customers/${props.customer.id}/contacts`, { retry: 0, query: { page: requestedPage, pageSize: 20, ...(contactSearchDebounced.value ? { search: contactSearchDebounced.value } : {}) } })
    if (epoch === contactGeneration) {
      if (!Array.isArray(response.data?.items) || !Number.isSafeInteger(response.data.total) || response.data.total < response.data.items.length) throw Error('Invalid contacts')
      contactRows.value = append ? [...contactRows.value, ...response.data.items.filter(row => !contactRows.value.some(old => old.id === row.id))] : response.data.items
      contactPage.value = requestedPage
      contactHasMore.value = response.data.items.length > 0 && response.data.items.length <= 20 && requestedPage * 20 < response.data.total
    }
  } catch {
    if (epoch === contactGeneration)
      contactsError.value = '联系人选择列表加载失败，请重试'
  } finally {
    if (epoch === contactGeneration)
      contactsPending.value = false
  }
}
watch([open, mode, () => props.customer.id, contactSearchDebounced, scope, canEdit], () => void loadContactChoices())

onScopeDispose(() => {
  contactGeneration++
})
const selectedContact = ref<{ label: string, value: string } | null>(null)
const contactOptions = computed(() => {
  const rows = contactRows.value.map(row => ({ label: String(row.name), value: String(row.id) }))
  return selectedContact.value && !rows.some(row => row.value === selectedContact.value?.value) ? [selectedContact.value, ...rows] : rows
})
watch(selection, (value) => {
  selectedContact.value = contactOptions.value.find(row => row.value === value) || null
})
function begin(next: typeof mode.value, row?: W3Record) {
  if (!canEdit.value || saving.value)
    return
  if (intent.uncertain) {
    open.value = true
    return
  }
  intent.reset()
  mode.value = next
  target.value = row || null
  version.value = Number((row || props.customer).row_version)
  selection.value = String((next === 'star' ? row?.star_level : next === 'parent' ? props.customer.parent_customer_id : props.customer.primary_contact_id) ?? '')
  error.value = ''
  comparison.value = null
  open.value = true
}
function message(failure: unknown) {
  const f = failure as {
    data?: {
      code?: string
      data?: {
        code?: string
      }
    }
    statusCode?: number
  }
  const code = String(f.data?.data?.code || f.data?.code || '')
  return ({ altoc_customer_version_conflict: '数据已被他人修改，请刷新比较后重试', altoc_customer_write_conflict: '数据已被他人修改，请刷新比较后重试', altoc_customer_hierarchy_invalid: '上级客户不能形成循环，层级不能超过10层', altoc_primary_contact_invalid: '请选择本客户的有效联系人', altoc_customer_fields_unavailable: '所需客户字段尚未启用' } as Record<string, string>)[code] || (f.statusCode === 403 ? '无权修改该客户资料' : f.statusCode === 409 ? '操作条件已变化，请刷新比较后重试' : f.statusCode && f.statusCode < 500 ? '请检查输入与当前状态' : '保存结果未确认，请沿用原请求重试')
}
async function compare(token: number) {
  try {
    const response = await $fetch<{
      data: W3Record
    }>(`/altoc/api/v1/customers/${props.customer.id}`, { retry: 0 })
    if (token === generation)
      comparison.value = mode.value === 'star' ? ((response.data.contacts as W3Record[] || []).find(row => row.code === target.value?.code) || null) : response.data
  } catch {
    if (token === generation)
      error.value += '；最新资料加载失败，请重试刷新比较'
  }
}
async function save() {
  if (!canEdit.value || saving.value || !scope.value)
    return
  const token = generation
  const identity = `${scope.value}|${props.customer.id}`
  if (mode.value === 'parent' && selection.value === String(props.customer.id)) {
    error.value = '不能将客户自身设为上级'
    return
  }
  if (mode.value === 'primary' && !intent.uncertain) {
    const name = contactOptions.value.find(row => row.value === selection.value)?.label || String(props.contacts.find(row => String(row.id) === selection.value)?.name || (selection.value ? '所选联系人' : '无主联系人'))
    open.value = false
    await nextTick()
    const accepted = await confirm({ title: '更换主联系人', tone: 'warning', message: `将“${props.customer.name}”的主联系人设为“${name}”，原主联系人将被替换。` })
    if (token !== generation || !canEdit.value || identity !== `${scope.value}|${props.customer.id}`)
      return
    open.value = true
    if (!accepted)
      return
  }
  saving.value = true
  error.value = ''
  const path = `/altoc/api/v1/customers/${props.customer.id}/${mode.value === 'parent' ? 'parent' : mode.value === 'primary' ? 'primary-contact' : `contacts/${encodeURIComponent(String(target.value?.code))}`}`
  const field = mode.value === 'parent' ? 'parent_customer_id' : mode.value === 'primary' ? 'primary_contact_id' : 'star_level'
  const body = { expectedVersion: version.value, [field]: selection.value ? mode.value === 'star' ? Number(selection.value) : selection.value : null }
  try {
    const done = await intent.submit({ path, method: 'PATCH', body }, async (request, key) => requireAltocJsonMutationResult(await $fetch(request.path, { method: request.method, body: request.body, headers: { 'Idempotency-Key': key }, retry: 0 })))
    if (token !== generation)
      return
    if (done) {
      open.value = false
      toast.add({ title: '客户资料已更新', color: 'success' })
      emit('changed')
    }
  } catch (failure) {
    if (token !== generation)
      return
    error.value = message(failure)
    if (Number((failure as {
      statusCode?: number
    }).statusCode) === 409)
      await compare(token)
  } finally {
    if (token === generation)
      saving.value = false
  }
}
function adopt() {
  if (!comparison.value || intent.uncertain || saving.value)
    return
  version.value = Number(comparison.value.row_version)
  comparison.value = null
  error.value = ''
}
watch([scope, () => props.customer.id, canEdit], () => {
  generation++
  open.value = false
  target.value = null
  comparison.value = null
  selection.value = ''
  contactRows.value = []
  selectedContact.value = null
  contactHasMore.value = false
  contactSearch.value = ''
  flushContactSearch()
  contactPage.value = 1
  contactGeneration++
  saving.value = false
  intent = createReviewMutationIntent('w3-customer', ['altoc_customer_version_conflict', 'altoc_customer_write_conflict', 'altoc_customer_hierarchy_invalid', 'altoc_primary_contact_invalid', 'altoc_customer_fields_unavailable'])
}, { flush: 'sync' })
onScopeDispose(() => {
  generation++
})
defineExpose({ begin })
</script>

<template>
  <div
    v-if="canEdit"
    class="flex flex-wrap gap-2"
  >
    <UButton
      color="neutral"
      variant="outline"
      @click="begin('parent')"
    >
      设置上级客户
    </UButton>
    <UButton
      v-if="Object.hasOwn(customer, 'primary_contact_id')"
      color="neutral"
      variant="outline"
      @click="begin('primary')"
    >
      设置或清空主联系人
    </UButton>
  </div>
  <UModal
    v-model:open="open"
    :title="title"
    description="修改会复核客户范围、引用与版本；失败保留当前选择。"
    :dismissible="!saving"
    :close="!saving"
  >
    <template #body>
      <form
        class="space-y-4"
        @submit.prevent="save"
      >
        <UFormField :label="title">
          <AltocBusinessObjectSelect
            v-if="mode === 'parent'"
            v-model="selection"
            kind="customers"
            :enabled="open && canEdit && !saving && !intent.uncertain"
          />
          <div
            v-else-if="mode === 'primary'"
            class="space-y-2"
          >
            <RemoteObjectSelectMenu
              v-model="selection"
              v-model:search-term="contactSearch"
              :items="contactOptions"
              :loading="contactsPending"
              :error="contactsError"
              :has-more="contactHasMore"
              :disabled="saving || intent.uncertain"
              placeholder="搜索本客户联系人"
              @load-more="loadContactChoices(true)"
              @retry="loadContactChoices(contactRows.length > 0)"
              @flush="flushContactSearch"
            />
          </div>
          <USelectMenu
            v-else
            v-model="selection"
            value-key="value"
            :items="mode === 'star' ? starOptions : contactOptions"
            :disabled="saving || intent.uncertain"
            placeholder="未设置"
            class="w-full"
          />
          <UButton
            v-if="selection"
            color="neutral"
            variant="link"
            :disabled="saving || intent.uncertain"
            @click="selection = ''"
          >
            清空（可选）
          </UButton>
        </UFormField>
        <UAlert
          v-if="error"
          color="error"
          title="保存失败"
          :description="error"
        />
        <p
          v-if="intent.uncertain"
          class="text-sm text-warning"
        >
          保存结果未确认，重试将沿用同一请求安全续行；请勿修改选择。
        </p>
        <div
          v-if="comparison"
          class="space-y-2 rounded border border-default p-3 text-sm"
        >
          <p>原版本 v{{ version }} → 最新 v{{ comparison.row_version }}；草稿选择已保留。</p>
          <p>最新值：{{ mode === 'star' ? comparison.star_level ?? '未设置' : mode === 'parent' ? comparison.parent_customer_id ?? '无上级' : comparison.primary_contact_id ?? '无主联系人' }}</p>
          <UButton
            color="neutral"
            variant="outline"
            :disabled="intent.uncertain"
            @click="adopt"
          >
            使用最新版本，保留选择
          </UButton>
        </div>
        <UButton
          v-if="error"
          color="neutral"
          variant="link"
          :disabled="saving"
          @click="compare(generation)"
        >
          刷新比较
        </UButton>
        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            color="neutral"
            variant="outline"
            :disabled="saving"
            @click="open = false"
          >
            取消
          </UButton><UButton
            type="submit"
            :loading="saving"
            :disabled="!canEdit || !!comparison"
          >
            {{ intent.uncertain ? '重试原请求' : '保存' }}
          </UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
