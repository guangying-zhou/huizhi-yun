<script setup lang="ts">
import ContentPageHeader from '@hzy/foundation/app/components/ContentPageHeader.vue'
import CommonEmptyState from '@hzy/foundation/app/components/common/EmptyState.vue'
import UserTreeSelector from '@hzy/foundation/app/components/UserTreeSelector.vue'
import { selectableProjectCategoryOptions } from '../../app/config/project'
import { useAimsModule } from '../useAimsModule'

definePageMeta({
  hostContentInset: false })
const {
    moduleUrl } = useAimsModule(), router = useRouter(), route = useRoute(), toast = useToast()
const editId = computed(() => /^[1-9]\d*$/.test(String(route.query.editId || '')) ? String(route.query.editId) : '')
const editVersion = ref('')
const initialLoading = ref(false), initialError = ref(''), comparison = ref('')
let readGeneration = 0
const {
  loaded, error: permissionError, loadPermissions, hasPermission } = usePermissions()
const canCreate = computed(() => loaded.value && hasPermission('portfolios', 'admin'))
const form = reactive({
  code: '', name: '', description: '', ownerUid: '', deptCode: '', domainCode: '', gitGroup: '', defaultCategory: '', displayOrder: 0 })
const owner = computed({
  get: () => form.ownerUid ? [form.ownerUid] : [], set: (uids: string[]) => {
    form.ownerUid = uids[0] || ''
  } })
const category = computed({
  get: () => form.defaultCategory || 'none', set: (value: string) => {
    form.defaultCategory = value === 'none' ? '' : value
  } })
const saving = ref(false), error = ref('')
const pending = ref<{
  key: string
  body: Record<string, unknown> } | null>(null)
async function save() {
  if (saving.value || initialLoading.value || initialError.value || (editId.value && !editVersion.value) || !canCreate.value || !form.code.trim() || !form.name.trim()) return
  pending.value ||= {
    key: crypto.randomUUID(), body: {
      ...form, ...(editId.value ? { expectedVersion: editVersion.value } : {}), defaultCategory: editId.value ? form.defaultCategory : form.defaultCategory || undefined } }
  saving.value = true
  error.value = ''
  try {
    const res = await $fetch<{
      code: number }>(moduleUrl(editId.value ? `/api/v1/portfolios/${editId.value}` : '/api/v1/portfolios'), {
      method: editId.value ? 'PUT' : 'POST', headers: {
        'Idempotency-Key': pending.value.key }, body: pending.value.body })
    if (res.code !== 0) throw Error('项目集创建响应无效')
    pending.value = null
    toast.add({
      title: editId.value ? '项目集已更新' : '项目集已创建', color: 'success' })
    await router.push(moduleUrl('/admin/projects'))
  } catch (cause) {
    const status = (cause as {
      statusCode?: number }).statusCode || 0
    error.value = status === 409
      ? '项目集已被他人修改，请刷新比较后重新确认。草稿已保留。'
      : !status || status >= 500
          ? '保存结果未确认，可能已提交，重试将沿用同一请求安全续行。草稿已保留。'
          : (cause as {
              data?: {
                message?: string } }).data?.message || '创建失败，请检查输入和权限'
    if (status && status < 500) pending.value = null
  } finally {
    saving.value = false
  }
}
async function loadPortfolio(preserveDraft = false) {
  const current = ++readGeneration
  const requestedId = editId.value
  if (!editId.value || !canCreate.value) return
  initialLoading.value = true
  initialError.value = ''
  try {
    const response = await $fetch<{ code: number, data: { items: (typeof form & { editVersion: string })[] } }>(moduleUrl('/api/v1/admin/projects'), { query: { tree: 'true', portfolioId: editId.value, page: 1, pageSize: 1 } })
    const item = response.data?.items[0]
    if (response.code !== 0 || !item || !/^[a-f0-9]{64}$/.test(item.editVersion)) throw Error('项目集不存在')
    if (current !== readGeneration || requestedId !== editId.value || !canCreate.value) return
    editVersion.value = item.editVersion
    if (preserveDraft) {
      comparison.value = `当前项目集：${item.code} · ${item.name}。服务器版本已刷新，草稿保留，请比较后再保存。`
      return
    }
    for (const key of Object.keys(form) as (keyof typeof form)[]) Object.assign(form, { [key]: item[key] })
  } catch {
    if (current === readGeneration) initialError.value = '项目集暂不可用，请重试'
  } finally {
    if (current === readGeneration) initialLoading.value = false
  }
}
watch([editId, canCreate], () => {
  initialLoading.value = false
  initialError.value = ''
  editVersion.value = ''
  comparison.value = ''
  pending.value = null
  if (!editId.value) Object.assign(form, { code: '', name: '', description: '', ownerUid: '', deptCode: '', domainCode: '', gitGroup: '', defaultCategory: '', displayOrder: 0 })
  void loadPortfolio()
}, { immediate: true })
onMounted(() => void loadPermissions())
</script>

<template>
  <div class="space-y-4 p-4 sm:p-6">
    <ContentPageHeader hosted :title="editId ? '编辑项目集' : '新建项目集'">
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
    <CommonEmptyState v-if="permissionError" title="权限加载失败">
      <template #actions>
        <UButton @click="loadPermissions({ force: true })">
          重试
        </UButton>
      </template>
    </CommonEmptyState>
    <CommonEmptyState v-else-if="!loaded" title="正在加载权限" />
    <CommonEmptyState v-else-if="!canCreate" title="无权限" description="需要项目组合管理权限才能新建项目集" />
    <CommonEmptyState v-else-if="initialLoading" title="正在加载项目集" />
    <CommonEmptyState v-else-if="initialError" title="加载失败" :description="initialError">
      <template #actions>
        <UButton @click="loadPortfolio()">
          重试
        </UButton>
      </template>
    </CommonEmptyState>
    <section v-else class="mx-auto w-full max-w-[720px] space-y-4">
      <UAlert
        v-if="error"
        color="error"
        title="创建未完成"
        :description="error"
      />
      <UButton
        v-if="editId && error"
        color="neutral"
        variant="outline"
        @click="loadPortfolio(true)"
      >
        刷新比较（保留草稿）
      </UButton>
      <UAlert
        v-if="comparison"
        color="info"
        title="服务器当前信息"
        :description="comparison"
      />
      <UCard>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="项目集编码" required>
            <UInput v-model="form.code" :disabled="!!pending" class="w-full" />
          </UFormField>
          <UFormField label="项目集名称" required>
            <UInput v-model="form.name" :disabled="!!pending" class="w-full" />
          </UFormField>
          <UFormField label="负责人">
            <UserTreeSelector
              v-model="owner"
              selection-mode="single"
              :disabled="!!pending"
              width-class="w-full"
            />
          </UFormField>
          <UFormField label="部门编码">
            <UInput v-model="form.deptCode" :disabled="!!pending" class="w-full" />
          </UFormField>
          <UFormField label="业务领域编码">
            <UInput v-model="form.domainCode" :disabled="!!pending" class="w-full" />
          </UFormField>
          <UFormField label="默认项目分类">
            <USelect
              v-model="category"
              :items="[{ label: '不预设', value: 'none' }, ...selectableProjectCategoryOptions]"
              :disabled="!!pending"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Git 群组" help="填写已授权群组路径，可留空">
            <UInput v-model="form.gitGroup" :disabled="!!pending" class="w-full" />
          </UFormField>
          <UFormField label="显示顺序">
            <UInput
              v-model.number="form.displayOrder"
              type="number"
              :disabled="!!pending"
              class="w-full"
            />
          </UFormField>
          <UFormField label="说明" class="sm:col-span-2">
            <UTextarea v-model="form.description" :disabled="!!pending" class="w-full" />
          </UFormField>
        </div>
      </UCard>
      <div class="flex justify-end">
        <UButton :loading="saving" :disabled="!form.code.trim() || !form.name.trim()" @click="save">
          {{ pending ? '原键重试' : editId ? '保存项目集' : '创建项目集' }}
        </UButton>
      </div>
    </section>
  </div>
</template>
