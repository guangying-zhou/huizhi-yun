<script setup lang="ts">
import {
  BUDGET_STATUS_OPTIONS,
  LEAD_PROJECT_TYPE_OPTIONS,
  PROCUREMENT_MODE_OPTIONS,
  SOURCE_TYPE_OPTIONS
} from '~/types/altoc'
import { unwrapApiData } from '~/utils/apiResponse'

const router = useRouter()
const toast = useToast()
const { user: authUser } = useAuth()

const loading = ref(false)
interface LeadCreateResponse {
  id: number | string
}

const form = reactive({
  name: '',
  org_name: '',
  source_type: '',
  source_detail: '',
  need_summary: '',
  project_type: '',
  budget_status: 'unknown',
  estimated_budget: null as number | null,
  procurement_mode: '',
  expected_procurement_date: '',
  source_evidence_url: '',
  contact_name: '',
  contact_mobile: '',
  contact_email: '',
  owner_user_id: authUser.value || '',
  next_action: '',
  next_action_due_at: '',
  remark: ''
})

const sourceOptions = SOURCE_TYPE_OPTIONS.map(o => ({ label: o.label, value: o.value }))
const projectTypeOptions = LEAD_PROJECT_TYPE_OPTIONS.map(o => ({ label: o.label, value: o.value }))
const budgetStatusOptions = BUDGET_STATUS_OPTIONS.map(o => ({ label: o.label, value: o.value }))
const procurementModeOptions = PROCUREMENT_MODE_OPTIONS.map(o => ({ label: o.label, value: o.value }))

function getErrorMessage(err: unknown, fallback: string) {
  const error = err as { data?: { statusMessage?: string, message?: string }, message?: string }
  return error?.data?.statusMessage || error?.data?.message || error?.message || fallback
}

async function handleSubmit() {
  if (!form.name.trim()) {
    toast.add({ title: '请输入线索名称', color: 'error' })
    return
  }
  if (!form.org_name.trim()) {
    toast.add({ title: '请输入组织/公司名称', color: 'error' })
    return
  }
  if (!form.source_type) {
    toast.add({ title: '请选择来源渠道', color: 'error' })
    return
  }
  if (!form.need_summary.trim()) {
    toast.add({ title: '请输入需求摘要', color: 'error' })
    return
  }
  if (!form.contact_name.trim() && !form.contact_mobile.trim() && !form.contact_email.trim() && !form.source_evidence_url.trim()) {
    toast.add({ title: '请提供联系人或来源证据', color: 'error' })
    return
  }
  if (!form.owner_user_id?.trim()) {
    toast.add({ title: '请选择负责人', color: 'error' })
    return
  }
  if (!form.next_action.trim() || !form.next_action_due_at) {
    toast.add({ title: '请输入下一步动作和截止日期', color: 'error' })
    return
  }
  loading.value = true
  try {
    const response = await $fetch<unknown>('/api/v1/leads', {
      method: 'POST',
      body: {
        ...form,
        source_detail: form.source_detail || null,
        project_type: form.project_type || null,
        budget_status: form.budget_status || null,
        estimated_budget: form.estimated_budget,
        procurement_mode: form.procurement_mode || null,
        expected_procurement_date: form.expected_procurement_date || null,
        source_evidence_url: form.source_evidence_url || null,
        next_action_due_at: form.next_action_due_at || null,
        remark: form.remark || null
      }
    })
    const created = unwrapApiData<LeadCreateResponse>(response) as LeadCreateResponse
    toast.add({ title: '线索创建成功', color: 'success' })
    router.push(`/leads/${created.id}`)
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '创建失败'), color: 'error' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="lead-new">
    <template #body>
      <Teleport to="#altoc-layout-header-title">
        <UButton
          icon="i-lucide-arrow-left"
          variant="ghost"
          color="neutral"
          @click="router.back()"
        />
        <h1 class="truncate text-base font-semibold">
          新建线索
        </h1>
      </Teleport>
      <Teleport to="#altoc-layout-header-actions">
        <UButton
          label="保存"
          icon="i-lucide-check"
          color="primary"
          :loading="loading"
          @click="handleSubmit"
        />
      </Teleport>

      <div class="p-6 space-y-6">
        <UCard>
          <template #header>
            <span class="font-semibold">线索信息</span>
          </template>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UFormField label="线索名称" required>
              <UInput v-model="form.name" placeholder="如：XX单位信息化项目" class="w-full" />
            </UFormField>
            <UFormField label="组织/公司名称" required>
              <UInput v-model="form.org_name" placeholder="客户公司名称（尽量准确）" class="w-full" />
            </UFormField>
            <UFormField label="来源渠道" required>
              <USelect
                v-model="form.source_type"
                :items="sourceOptions"
                placeholder="请选择"
                class="w-full"
              />
            </UFormField>
            <UFormField label="来源详情">
              <UInput v-model="form.source_detail" placeholder="如：朋友介绍/展会名称等" class="w-full" />
            </UFormField>
            <UFormField label="来源证据">
              <UInput v-model="form.source_evidence_url" placeholder="公告、官网、项目链接" class="w-full" />
            </UFormField>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <span class="font-semibold">资格确认</span>
          </template>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UFormField label="需求摘要" required class="md:col-span-2">
              <UTextarea
                v-model="form.need_summary"
                placeholder="客户问题、项目背景或可信项目信号"
                :rows="3"
                class="w-full"
              />
            </UFormField>
            <UFormField label="项目类型">
              <USelect
                v-model="form.project_type"
                :items="projectTypeOptions"
                placeholder="选择类型"
                class="w-full"
              />
            </UFormField>
            <UFormField label="预算状态">
              <USelect
                v-model="form.budget_status"
                :items="budgetStatusOptions"
                placeholder="选择状态"
                class="w-full"
              />
            </UFormField>
            <UFormField label="初步预算">
              <UInput
                v-model.number="form.estimated_budget"
                type="number"
                placeholder="选填"
                class="w-full"
              />
            </UFormField>
            <UFormField label="采购方式">
              <USelect
                v-model="form.procurement_mode"
                :items="procurementModeOptions"
                placeholder="选择方式"
                class="w-full"
              />
            </UFormField>
            <UFormField label="预计采购时间">
              <UInput v-model="form.expected_procurement_date" type="date" class="w-full" />
            </UFormField>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <span class="font-semibold">联系人信息</span>
          </template>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UFormField label="联系人">
              <UInput v-model="form.contact_name" placeholder="姓名" class="w-full" />
            </UFormField>
            <UFormField label="手机">
              <UInput v-model="form.contact_mobile" placeholder="手机号码" class="w-full" />
            </UFormField>
            <UFormField label="邮箱">
              <UInput v-model="form.contact_email" placeholder="邮箱" class="w-full" />
            </UFormField>
            <UFormField label="负责人" required>
              <UserPicker v-model="form.owner_user_id" />
            </UFormField>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <span class="font-semibold">下一步</span>
          </template>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UFormField label="下一步动作" required>
              <UInput v-model="form.next_action" placeholder="如：约客户需求沟通" class="w-full" />
            </UFormField>
            <UFormField label="截止日期" required>
              <UInput v-model="form.next_action_due_at" type="date" class="w-full" />
            </UFormField>
            <UFormField label="备注" class="md:col-span-2">
              <UTextarea
                v-model="form.remark"
                placeholder="补充说明"
                :rows="3"
                class="w-full"
              />
            </UFormField>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
