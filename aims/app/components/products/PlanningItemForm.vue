<script setup lang="ts">
import type { ProductRequestRecord } from '~/types/productRequest'
import type { ProductPlanningDetail } from '~/types/productPlanning'

const props = defineProps<{ productCode: string, workspaceRevision: number, item?: ProductPlanningDetail, initialSources?: ProductRequestRecord[] }>()
const sources = ref<ProductRequestRecord[]>(props.initialSources?.map(item => ({ ...item })) || [])
const emit = defineEmits<{ saved: [], cancel: [] }>()
const title = ref(props.item?.title || props.initialSources?.[0]?.title || ''), scope = ref(props.item?.scope_summary || props.initialSources?.[0]?.problem_statement || ''), category = ref(props.item?.investment_category || 'usability'), urgency = ref(props.item?.urgency_level || props.initialSources?.[0]?.urgency_level || 'P2')
const reason = ref(''), impact = ref('')
const { confirm } = useConfirm()
const busy = ref(false), error = ref<Error | null>(null)
const alert = useApiErrorAlert(error, { fallbackTitle: '规划事项保存失败' })
const expectedRevision = props.workspaceRevision
let retry: { payload: string, key: string } | undefined
async function save() {
  if (busy.value) return
  error.value = null
  if (!title.value.trim() || !scope.value.trim() || (props.item && !reason.value.trim())) {
    error.value = new Error('请填写事项标题、本次建设范围及修改时的原因')
    return
  }
  if (props.item?.requires_impact_note && !impact.value.trim()) {
    error.value = new Error('已选入或交付中的事项修改须说明影响')
    return
  }
  const body = { expectedRevision, title: title.value, scopeSummary: scope.value, investmentCategory: category.value, urgencyLevel: urgency.value, requests: sources.value.map(item => ({ bizId: item.biz_id, revision: item.revision })), ...(props.item ? { expectedItemRevision: props.item.revision, reason: reason.value, impactNote: impact.value } : {}) }
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  busy.value = true
  try {
    if (props.item && !(await confirm({ title: '确认修改规划事项', message: `${props.item.title}\n修改原因：${reason.value}\n影响说明：${impact.value || '未补充'}\n范围或来源变化将使原评估需要复评，已有交付安排需另行协调。`, tone: 'warning', confirmLabel: '确认修改' }))) return
    const result = await $fetch<{ code: number }>(`/api/v1/products/${encodeURIComponent(props.productCode)}/planning-items${props.item ? `/${props.item.biz_id}` : ''}`, { method: props.item ? 'PATCH' : 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    if (result.code !== 0) throw new Error('保存结果不完整，请重试')
    emit('saved')
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('规划事项保存失败')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="save">
    <UAlert v-if="alert" v-bind="alert" />
    <UFormField label="事项标题" name="planningTitle" required>
      <UInput
        v-model="title"
        required
        :maxlength="500"
        :disabled="busy"
        class="w-full"
      />
    </UFormField>
    <UFormField label="本次建设范围" name="planningScope" required>
      <UTextarea
        v-model="scope"
        required
        :maxlength="10000"
        :disabled="busy"
        :rows="5"
        placeholder="本次解决什么问题、包含哪些内容，以及不在本次范围内的内容"
        class="w-full"
      />
    </UFormField>
    <UFormField label="投资类别" name="planningCategory" required>
      <USelect
        v-model="category"
        :items="[{ value: 'reliability', label: '可靠性与技术治理' }, { value: 'usability', label: '体验优化' }, { value: 'growth', label: '新功能与业务增长' }]"
        :disabled="busy"
        class="w-full"
      />
    </UFormField>
    <UFormField label="紧急程度建议" name="planningUrgency" required>
      <USelect
        v-model="urgency"
        :items="['P0', 'P1', 'P2', 'P3']"
        :disabled="busy"
        class="w-full"
      />
    </UFormField>
    <UFormField
      v-if="item"
      label="修改原因"
      name="planningEditReason"
      required
    >
      <UTextarea
        v-model="reason"
        required
        :maxlength="2000"
        :disabled="busy"
        class="w-full"
      />
    </UFormField>
    <UFormField
      v-if="item"
      label="影响说明"
      name="planningEditImpact"
      :required="item.requires_impact_note"
    >
      <UTextarea
        v-model="impact"
        :required="item.requires_impact_note"
        :maxlength="2000"
        :disabled="busy"
        placeholder="对已选范围或交付安排的影响"
        class="w-full"
      />
    </UFormField>
    <ProductsPlanningRequestPicker v-model="sources" :product-code="productCode" :disabled="busy" />
    <p class="text-sm text-muted">
      {{ item ? '修改不会自动调整交付顺序或版本承诺。' : '创建后进入待规划状态。紧急程度建议不等于评分、交付顺序或版本承诺。' }}
    </p>
    <p class="text-xs text-muted">
      若产品空间已变化，请保留输入，取消并刷新后重新确认。
    </p>
    <div class="flex flex-wrap gap-3">
      <UButton type="submit" :loading="busy">
        {{ item ? '保存修改' : '创建事项' }}
      </UButton>
      <UButton
        type="button"
        color="neutral"
        variant="ghost"
        :disabled="busy"
        @click="emit('cancel')"
      >
        取消
      </UButton>
    </div>
  </form>
</template>
