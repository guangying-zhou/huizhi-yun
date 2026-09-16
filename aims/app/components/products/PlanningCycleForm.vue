<script setup lang="ts">
import type { ProductPlanningCycle } from '~/types/productPlanningCycle'

const props = defineProps<{ productCode: string, workspaceRevision: number, cycle?: ProductPlanningCycle }>()
const emit = defineEmits<{ saved: [], cancel: [] }>()
const title = ref(props.cycle?.title || ''), goal = ref(props.cycle?.goal_summary || ''), startsOn = ref(props.cycle?.starts_on || ''), endsOn = ref(props.cycle?.ends_on || ''), interval = ref(props.cycle?.review_interval_days || 14)
const budgetMode = ref(props.cycle ? 'keep' : 'unknown')
const metricMode = ref('keep')
const metricName = ref(props.cycle?.metric_definition?.name || '')
const metricUnit = ref(props.cycle?.metric_definition?.unit || '')
const metricDirection = ref(props.cycle?.metric_definition?.direction || 'increase')
const metricMethod = ref(props.cycle?.metric_definition?.measurement_method || '')
const baseline = ref(props.cycle?.baseline_value ?? ''), target = ref(props.cycle?.target_value ?? '')
const reason = ref('')
const { confirm } = useConfirm()
const budgetOptions = props.cycle ? [{ value: 'keep', label: '保留当前预算' }, { value: 'set', label: '重新设置完整预算' }, { value: 'clear', label: '清除预算，标为未确定' }] : [{ value: 'unknown', label: '预算未确定' }, { value: 'set', label: '填写完整预算' }]
const fields = [{ key: 'totalPersonDays', label: '总容量' }, { key: 'reservePersonDays', label: '应急预留' }, { key: 'reliabilityPersonDays', label: '可靠性与技术治理' }, { key: 'usabilityPersonDays', label: '体验优化' }, { key: 'growthPersonDays', label: '新功能与业务增长' }]
const amounts = reactive<Record<string, string>>(Object.fromEntries(fields.map(field => [field.key, ''])))
const budgetKeys = ['total_person_days', 'reserve_person_days', 'reliability_person_days', 'usability_person_days', 'growth_person_days'] as const
fields.forEach((field, index) => {
  amounts[field.key] = props.cycle?.budget?.[budgetKeys[index]!] ?? ''
})
const busy = ref(false), error = ref<Error | null>(null)
const alert = useApiErrorAlert(error, { fallbackTitle: '周期保存失败' })
const expectedRevision = props.workspaceRevision
const productCode = props.productCode
let retry: { payload: string, key: string } | undefined
onBeforeRouteLeave(() => !busy.value)
async function save() {
  if (busy.value) return
  error.value = null
  if (!title.value.trim() || !goal.value.trim() || !startsOn.value || !endsOn.value || endsOn.value < startsOn.value) {
    error.value = new Error('请填写周期标题、目标和有效期间，结束日期不得早于开始日期')
    return
  }
  if (props.cycle && !reason.value.trim()) {
    error.value = new Error('请填写修改原因')
    return
  }
  const metric = metricMode.value === 'set' ? { name: metricName.value, unit: metricUnit.value, direction: metricDirection.value, measurementMethod: metricMethod.value, baselineValue: baseline.value === '' ? null : baseline.value, targetValue: target.value === '' ? null : target.value } : null
  const body = { metric, expectedRevision, title: title.value, goalSummary: goal.value, startsOn: startsOn.value, endsOn: endsOn.value, reviewIntervalDays: interval.value, budget: budgetMode.value === 'set' ? { ...amounts } : null, ...(props.cycle ? { expectedCycleRevision: props.cycle.revision, reason: reason.value, budgetMode: budgetMode.value } : {}) }
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  busy.value = true
  try {
    if (props.cycle && !(await confirm({ title: '确认修改周期草案', message: `${props.cycle.title}\n修改原因：${reason.value}\n预算：${budgetOptions.find(option => option.value === budgetMode.value)?.label}。${budgetMode.value === 'clear' ? '当前预算将清空并标为未确定。' : ''}\n指标：${metricMode.value === 'set' ? `${metricName.value}（${metricUnit.value}），基线 ${baseline.value || '未知'}，目标 ${target.value || '未知'}；替换当前定义与数值。` : '保留当前指标。'}`, tone: 'warning', confirmLabel: '保存修改' }))) return
    const result = await $fetch<{ code: number }>(`/api/v1/products/${encodeURIComponent(productCode)}/planning-cycles${props.cycle ? `/${props.cycle.biz_id}` : ''}`, { method: props.cycle ? 'PATCH' : 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    if (result.code !== 0) throw new Error('周期保存结果不完整，请重试')
    // Release the route guard only after the command response was accepted.
    busy.value = false
    emit('saved')
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('周期保存失败')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="space-y-6" @submit.prevent="save">
    <UAlert v-if="alert" v-bind="alert" />
    <div class="space-y-4">
      <UFormField label="周期标题" name="cycleTitle" required>
        <UInput
          v-model="title"
          required
          :maxlength="255"
          :disabled="busy"
          class="w-full"
        />
      </UFormField>
      <UFormField label="周期目标" name="cycleGoal" required>
        <UTextarea
          v-model="goal"
          required
          :maxlength="10000"
          :rows="4"
          :disabled="busy"
          placeholder="本周期希望为哪些用户解决什么问题"
          class="w-full"
        />
      </UFormField>
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <UFormField label="开始日期" name="cycleStart" required>
          <UInput
            v-model="startsOn"
            type="date"
            required
            :disabled="busy"
            class="w-full"
          />
        </UFormField>
        <UFormField label="结束日期" name="cycleEnd" required>
          <UInput
            v-model="endsOn"
            type="date"
            required
            :min="startsOn || undefined"
            :disabled="busy"
            class="w-full"
          />
        </UFormField>
      </div>
      <UFormField label="复评间隔（天）" name="cycleInterval" required>
        <UInput
          v-model.number="interval"
          type="number"
          :min="1"
          :max="366"
          :step="1"
          required
          :disabled="busy"
        />
      </UFormField>
    </div>
    <div class="space-y-4 border-t border-default pt-4">
      <UFormField label="容量预算" name="cycleBudgetMode">
        <USelect
          v-model="budgetMode"
          :items="budgetOptions"
          :disabled="busy"
          class="w-full sm:w-64"
        />
      </UFormField>
      <p class="text-sm text-muted">
        预算统一使用人日，包含设计、研发、测试及必要发布准备。三类预算加应急预留不能超过总容量。
      </p>
      <div v-if="budgetMode === 'set'" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <UFormField
          v-for="field in fields"
          :key="field.key"
          :label="`${field.label}（人日）`"
          :name="field.key"
          required
        >
          <UInput
            v-model="amounts[field.key]"
            inputmode="decimal"
            pattern="[0-9]+(\.[0-9]{1,2})?"
            required
            :disabled="busy"
            placeholder="可填 0，最多两位小数"
            class="w-full"
          />
        </UFormField>
      </div>
    </div>
    <div class="space-y-4 border-t border-default pt-4">
      <UFormField label="成功指标" name="cycleMetricMode">
        <USelect
          v-model="metricMode"
          :items="[{ value: 'keep', label: cycle ? '保留当前指标' : '稍后定义指标' }, { value: 'set', label: '设置指标与目标值' }]"
          :disabled="busy"
          class="w-full"
        />
      </UFormField>
      <div v-if="metricMode === 'set'" class="space-y-4">
        <UFormField label="指标名称" name="metricName" required>
          <UInput
            v-model="metricName"
            required
            :maxlength="255"
            :disabled="busy"
            class="w-full"
          />
        </UFormField>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UFormField label="计量单位" name="metricUnit" required>
            <UInput
              v-model="metricUnit"
              required
              :maxlength="64"
              :disabled="busy"
              placeholder="例如：百分比、分钟、次"
              class="w-full"
            />
          </UFormField>
          <UFormField label="改善方向" name="metricDirection" required>
            <USelect
              v-model="metricDirection"
              :items="[{ value: 'increase', label: '提高' }, { value: 'decrease', label: '降低' }, { value: 'maintain', label: '维持' }]"
              :disabled="busy"
              class="w-full"
            />
          </UFormField>
        </div>
        <UFormField label="测量口径" name="metricMethod" required>
          <UTextarea
            v-model="metricMethod"
            required
            :maxlength="2000"
            :disabled="busy"
            placeholder="明确数据来源、统计期间、对象和去重方式"
            class="w-full"
          />
        </UFormField>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UFormField label="基线值" name="metricBaseline">
            <UInput
              v-model="baseline"
              inputmode="decimal"
              pattern="-?[0-9]{1,14}(\.[0-9]{1,6})?"
              :disabled="busy"
              placeholder="未知留空，零值填 0"
              class="w-full"
            />
          </UFormField>
          <UFormField label="目标值" name="metricTarget">
            <UInput
              v-model="target"
              inputmode="decimal"
              pattern="-?[0-9]{1,14}(\.[0-9]{1,6})?"
              :disabled="busy"
              placeholder="未知留空，最多六位小数"
              class="w-full"
            />
          </UFormField>
        </div>
        <p class="text-xs text-muted">
          指标用于验证周期目标，实际观测结果在后续复盘中记录；设置指标时，留空的基线或目标将保存为未知。
        </p>
      </div>
    </div>
    <UFormField
      v-if="cycle"
      label="修改原因"
      name="cycleEditReason"
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
    <p class="text-sm text-muted">
      保存为草案，不会自动开放周期、选入事项或承诺交付。若产品版本已变化，请保留输入并重新核对。
    </p>
    <div class="flex flex-wrap gap-3">
      <UButton type="submit" :loading="busy">
        {{ cycle ? '保存修改' : '保存周期草案' }}
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
