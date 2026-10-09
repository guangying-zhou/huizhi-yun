<script setup lang="ts">
import ContentPageHeader from '@hzy/foundation/app/components/ContentPageHeader.vue'
import CommonEmptyState from '@hzy/foundation/app/components/common/EmptyState.vue'
import UserTreeSelector from '@hzy/foundation/app/components/UserTreeSelector.vue'
import ProjectPortfolioSelect from '../../app/components/project/ProjectPortfolioSelect.vue'
import ProjectAccessControlFields from '../../app/components/project/ProjectAccessControlFields.vue'
import { useAimsModule } from '../useAimsModule'
import { projectNameError } from '../../shared/projectName'
import { methodologyOptions, selectableProjectCategoryOptions } from '../../app/config/project'
import type { ProjectCategory, ProjectConfidentialityLevel, ProjectSecurityLevel } from '../../app/types/aims'

definePageMeta({
  hostContentInset: false })
const {
    moduleUrl } = useAimsModule(), route = useRoute(), router = useRouter()
const {
  loaded, error: permissionError, loadPermissions, hasPermission } = usePermissions()
const canCreate = computed(() => loaded.value && hasPermission('projects', 'create'))
const returnPath = computed(() => moduleUrl(route.query.returnTo === 'admin' ? '/admin/projects' : '/projects'))
const saving = ref(false), error = ref(''), nameTouched = ref(false)
const form = reactive({
  projectCode: '', name: '', shortName: '', internalCode: '', description: '', category: 'product_dev' as ProjectCategory, methodology: 'PIVR', portfolioId: /^[1-9]\d*$/.test(String(route.query.portfolioId || '')) ? Number(route.query.portfolioId) : null as number | null, domainCode: '', deptCode: '', leaderUid: '', securityLevel: 'company' as ProjectSecurityLevel, confidentialityLevel: 'L0' as ProjectConfidentialityLevel, accessWhitelist: [] as string[] | null, startDate: '', endDate: '', serviceLineCode: '', servicePeriodSeq: null as number | null, servicePeriodStart: '', servicePeriodEnd: '', servicePeriodLabel: '' })
const leader = computed({
  get: () => form.leaderUid ? [form.leaderUid] : [], set: (uids: string[]) => {
    form.leaderUid = uids[0] || ''
  } })
const portfolio = computed({
  get: () => form.portfolioId ? String(form.portfolioId) : '', set: (value: string) => {
    form.portfolioId = value ? Number(value) : null
  } })
const nameError = computed(() => projectNameError(form.name)), nameFieldError = computed(() => nameTouched.value && nameError.value ? nameError.value : false)
const pending = ref<{
  key: string
  body: Record<string, unknown> } | null>(null)
async function submit() {
  nameTouched.value = true
  if (saving.value || !canCreate.value || nameError.value || !form.projectCode.trim() || !form.shortName.trim() || !form.leaderUid.trim()) return
  if (form.category === 'maintenance' && (!form.serviceLineCode.trim() || !form.servicePeriodSeq || !form.servicePeriodStart || !form.servicePeriodEnd)) {
    error.value = '请填写服务线、服务期序号和起止日期'
    return
  }
  pending.value ||= {
    key: crypto.randomUUID(), body: {
      ...form, accessWhitelist: form.securityLevel === 'whitelist' ? form.accessWhitelist : undefined, ...(form.category === 'maintenance'
        ? {}
        : {
            serviceLineCode: undefined, servicePeriodSeq: undefined, servicePeriodStart: undefined, servicePeriodEnd: undefined, servicePeriodLabel: undefined }) } }
  saving.value = true
  error.value = ''
  try {
    const response = await $fetch<{
      code?: number
      data?: {
        idempotent?: boolean
        receiptId?: string
        result?: {
          id?: number } } }>(moduleUrl('/api/v1/projects'), {
      method: 'POST', headers: {
        'Idempotency-Key': pending.value.key }, body: pending.value.body })
    const id = response.data?.result?.id
    if (response.code !== 0 || (!id && !(response.data?.idempotent && response.data.receiptId))) throw Error('项目创建响应无效')
    pending.value = null
    await router.push(route.query.returnTo === 'admin' ? returnPath.value : id ? moduleUrl(`/projects/${id}`) : moduleUrl('/projects'))
  } catch (cause) {
    const failure = cause as {
      statusCode?: number
      data?: {
        message?: string } }
    error.value = !failure.statusCode || failure.statusCode >= 500 ? '保存结果未确认，可能已提交，重试将沿用同一请求安全续行。草稿已保留。' : failure.data?.message || '项目创建失败，请检查权限和输入'
    if (failure.statusCode && failure.statusCode < 500) pending.value = null
  } finally {
    saving.value = false
  }
}
onMounted(() => void loadPermissions())
</script>

<template>
  <div class="space-y-4 p-4 sm:p-6">
    <ContentPageHeader hosted title="登记项目">
      <template #actions>
        <UButton
          :to="returnPath"
          color="neutral"
          variant="outline"
          icon="i-lucide-arrow-left"
        >
          返回项目
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
    <CommonEmptyState v-else-if="!canCreate" title="无权限" description="需要项目创建权限才能登记项目" />
    <section v-else class="mx-auto w-full max-w-[720px] space-y-4">
      <UAlert
        v-if="error"
        color="error"
        title="登记未完成"
        :description="error"
      />
      <UCard>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="项目编码" required>
            <UInput v-model="form.projectCode" :disabled="!!pending" class="w-full" />
          </UFormField>
          <UFormField
            label="项目名称"
            required
            :error="nameFieldError"
            help="只能包含汉字、英文和数字"
          >
            <UInput
              v-model="form.name"
              :disabled="!!pending"
              class="w-full"
              @blur="nameTouched = true"
            />
          </UFormField>
          <UFormField label="项目简称" required>
            <UInput v-model="form.shortName" :disabled="!!pending" class="w-full" />
          </UFormField>
          <UFormField label="内部代号">
            <UInput v-model="form.internalCode" :disabled="!!pending" class="w-full" />
          </UFormField>
          <UFormField label="负责人" required>
            <UserTreeSelector
              v-model="leader"
              selection-mode="single"
              :disabled="!!pending"
              width-class="w-full"
            />
          </UFormField>
          <UFormField label="项目集">
            <ProjectPortfolioSelect v-model="portfolio" :disabled="!!pending" />
          </UFormField>
          <UFormField label="部门编码">
            <UInput v-model="form.deptCode" :disabled="!!pending" class="w-full" />
          </UFormField>
          <UFormField label="业务领域编码">
            <UInput v-model="form.domainCode" :disabled="!!pending" class="w-full" />
          </UFormField>
          <UFormField label="项目分类">
            <USelect
              v-model="form.category"
              :items="selectableProjectCategoryOptions"
              :disabled="!!pending"
              class="w-full"
            />
          </UFormField>
          <UFormField label="方法论">
            <USelect
              v-model="form.methodology"
              :items="methodologyOptions"
              :disabled="!!pending"
              class="w-full"
            />
          </UFormField>
          <UFormField label="开始日期">
            <UInput
              v-model="form.startDate"
              type="date"
              :disabled="!!pending"
              class="w-full"
            />
          </UFormField>
          <UFormField label="结束日期">
            <UInput
              v-model="form.endDate"
              type="date"
              :disabled="!!pending"
              class="w-full"
            />
          </UFormField>
          <UFormField label="说明" class="sm:col-span-2">
            <UTextarea v-model="form.description" :disabled="!!pending" class="w-full" />
          </UFormField>
        </div>
      </UCard>
      <UCard v-if="form.category === 'maintenance'">
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="服务线" required>
            <UInput v-model="form.serviceLineCode" :disabled="!!pending" class="w-full" />
          </UFormField><UFormField label="服务期序号" required>
            <UInput
              v-model.number="form.servicePeriodSeq"
              type="number"
              min="1"
              :disabled="!!pending"
              class="w-full"
            />
          </UFormField><UFormField label="服务期开始" required>
            <UInput
              v-model="form.servicePeriodStart"
              type="date"
              :disabled="!!pending"
              class="w-full"
            />
          </UFormField><UFormField label="服务期结束" required>
            <UInput
              v-model="form.servicePeriodEnd"
              type="date"
              :disabled="!!pending"
              class="w-full"
            />
          </UFormField><UFormField label="服务期名称">
            <UInput v-model="form.servicePeriodLabel" :disabled="!!pending" class="w-full" />
          </UFormField>
        </div>
      </UCard>
      <UCard>
        <ProjectAccessControlFields
          v-model:security-level="form.securityLevel"
          v-model:confidentiality-level="form.confidentialityLevel"
          v-model:access-whitelist="form.accessWhitelist"
          show-confidentiality
          :disabled="!!pending"
        />
      </UCard>
      <div class="flex justify-end">
        <UButton :loading="saving" :disabled="!form.projectCode.trim() || !form.name.trim() || !form.shortName.trim() || !form.leaderUid.trim()" @click="submit">
          {{ pending ? '原键重试' : '创建项目' }}
        </UButton>
      </div>
    </section>
  </div>
</template>
