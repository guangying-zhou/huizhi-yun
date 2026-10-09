<script setup lang="ts">
export interface ObjectiveDraft {
  title: string
  description: string
  startsOn: string
  endsOn: string
  ownerUid: string
  metric: { name: string, unit: string, measurementDefinition: string, direction: string, baselineValue: string, targetValue: string }
}
const draft = defineModel<ObjectiveDraft>({ required: true })
defineProps<{ saving: boolean, metricValid: boolean }>()
</script>

<template>
  <div class="space-y-4">
    <UCard>
      <template #header>
        <h2 class="font-semibold">
          目标信息
        </h2>
      </template>
      <div class="space-y-4">
        <UFormField label="目标标题" required>
          <UInput
            v-model="draft.title"
            :disabled="saving"
            :maxlength="255"
            class="w-full"
            placeholder="例如：降低登录失败率"
          />
        </UFormField>
        <UFormField label="目标说明">
          <UTextarea
            v-model="draft.description"
            :disabled="saving"
            :maxlength="10000"
            class="w-full"
          />
        </UFormField>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UFormField label="开始日期" required>
            <UInput
              v-model="draft.startsOn"
              type="date"
              :disabled="saving"
              class="w-full"
            />
          </UFormField>
          <UFormField label="结束日期" required>
            <UInput
              v-model="draft.endsOn"
              type="date"
              :min="draft.startsOn"
              :disabled="saving"
              class="w-full"
            />
          </UFormField>
        </div>
        <UFormField label="负责人" required>
          <UserTreeSelector
            :model-value="draft.ownerUid ? [draft.ownerUid] : []"
            selection-mode="single"
            :disabled="saving"
            @update:model-value="(uids) => { draft.ownerUid = uids[0] || '' }"
          />
          <p class="mt-1 text-sm text-muted">
            请选择当前有效的产品成员。
          </p>
        </UFormField>
      </div>
    </UCard>
    <UCard>
      <template #header>
        <h2 class="font-semibold">
          指标口径
        </h2>
      </template>
      <div class="space-y-4">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UFormField label="指标名称" required>
            <UInput
              v-model="draft.metric.name"
              :disabled="saving"
              :maxlength="255"
              class="w-full"
              placeholder="例如：登录失败率"
            />
          </UFormField>
          <UFormField label="单位" required>
            <UInput
              v-model="draft.metric.unit"
              :disabled="saving"
              :maxlength="64"
              class="w-full"
              placeholder="例如：%、次、天"
            />
          </UFormField>
        </div>
        <UFormField label="测量口径" required>
          <UTextarea
            v-model="draft.metric.measurementDefinition"
            :disabled="saving"
            :maxlength="2000"
            class="w-full"
            placeholder="说明数据来源、计算方法及统计周期"
          />
        </UFormField>
        <UFormField label="改善方向" required>
          <USelect
            v-model="draft.metric.direction"
            :disabled="saving"
            :items="[{ label: '提高', value: 'increase' }, { label: '降低', value: 'decrease' }]"
            class="w-full sm:w-48"
          />
        </UFormField>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UFormField label="基线值" required>
            <UInput
              v-model="draft.metric.baselineValue"
              inputmode="decimal"
              :disabled="saving"
              class="w-full"
            />
          </UFormField>
          <UFormField label="目标值" required>
            <UInput
              v-model="draft.metric.targetValue"
              inputmode="decimal"
              :disabled="saving"
              class="w-full"
            />
          </UFormField>
        </div>
        <p class="text-sm text-muted">
          数值最多支持 14 位整数、6 位小数。提高目标须大于基线，降低目标须小于基线。实际结果通过后续观测录入。
        </p>
        <p v-if="draft.metric.baselineValue && draft.metric.targetValue && !metricValid" class="text-sm text-warning">
          请补全指标口径，并检查数值格式及改善方向。
        </p>
      </div>
    </UCard>
  </div>
</template>
