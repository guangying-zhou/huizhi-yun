<script setup lang="ts">
defineProps<{ busy?: boolean }>()
const emit = defineEmits<{ submit: [value: { tenantCode: string, approvalReference: string, effectiveFrom: string, effectiveUntil: string, amount: string, currency: string }] }>()
const form = reactive({ tenantCode: '', approvalReference: '', effectiveFrom: '', effectiveUntil: '', amount: '', currency: 'CNY' })
const error = ref('')
function submit() {
  error.value = ''
  const from = new Date(`${form.effectiveFrom}:00Z`), until = new Date(`${form.effectiveUntil}:00Z`)
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(until.getTime()) || until <= from) {
    error.value = '结束时间必须晚于开始时间。'
    return
  }
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(form.amount)) {
    error.value = '金额最多保留两位小数。'
    return
  }
  emit('submit', { ...form, tenantCode: form.tenantCode.trim(), approvalReference: form.approvalReference.trim(), effectiveFrom: from.toISOString(), effectiveUntil: until.toISOString() })
}
</script>

<template>
  <form
    class="space-y-4"
    @submit.prevent="submit"
  >
    <UAlert
      color="info"
      variant="soft"
      title="创建即批准报价"
      description="提交后记录您的批准身份、依据、服务期间和金额，企业确认后才可确认收款。已批准内容不可直接修改。"
    />
    <UFormField
      label="企业编码"
      required
    >
      <UInput
        v-model="form.tenantCode"
        name="tenantCode"
        required
        maxlength="64"
        class="w-full"
      />
    </UFormField>
    <UFormField
      label="批准依据"
      description="填写已确认的报价或合同编号，便于核对。"
      required
    >
      <UInput
        v-model="form.approvalReference"
        name="approvalReference"
        required
        maxlength="255"
        class="w-full"
      />
    </UFormField>
    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField
        label="服务开始（UTC）"
        required
      >
        <UInput
          v-model="form.effectiveFrom"
          name="effectiveFrom"
          type="datetime-local"
          required
          class="w-full"
        />
      </UFormField>
      <UFormField
        label="服务结束（UTC，不含此时刻）"
        required
      >
        <UInput
          v-model="form.effectiveUntil"
          name="effectiveUntil"
          type="datetime-local"
          required
          class="w-full"
        />
      </UFormField>
      <UFormField
        label="批准金额"
        required
      >
        <UInput
          v-model="form.amount"
          name="amount"
          inputmode="decimal"
          required
          placeholder="0.00"
          class="w-full"
        />
      </UFormField>
      <UFormField
        label="币种"
        required
      >
        <USelect
          v-model="form.currency"
          :items="['CNY', 'USD', 'EUR']"
          class="w-full"
        />
      </UFormField>
    </div>
    <UAlert
      v-if="error"
      color="error"
      :title="error"
    />
    <div class="flex justify-end">
      <UButton
        type="submit"
        :loading="busy"
        label="批准并创建全量订单"
      />
    </div>
  </form>
</template>
