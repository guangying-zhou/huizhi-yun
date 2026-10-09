<script setup lang="ts">
import { createAccountNumberReveal } from '../../utils/accountNumberReveal'
import { createHostFinanceClient, type FinanceFetch } from '../../utils/hostFinanceClient'
import { useFinanceModule } from '../../../layer/useFinanceModule'

const props = defineProps<{
  code: string
  allowed: boolean
  available: boolean
}>()
const { apiUrl, sessionScope } = useFinanceModule()
const api = createHostFinanceClient($fetch as FinanceFetch, apiUrl)
const toast = useToast()
const open = ref(false)
const reason = ref('')
// Sensitive value is local to this mounted component, never useState/store/URL.
const state = reactive({ accountNo: '', pending: false, remainingSeconds: 0, error: '' })
const controller = createAccountNumberReveal(state, async (value) => {
  const response = await api.revealAccountNo(props.code, value)
  if (response.data.code !== props.code)
    throw new Error('Unavailable')
  return response.data.accountNo
})
function clear() {
  controller.clear()
  reason.value = ''
}
async function reveal() {
  if (!open.value || !props.allowed || !props.available)
    return
  await controller.reveal(reason.value)
}
async function copy() {
  const value = controller.value()
  if (!value || !props.allowed || !open.value)
    return
  try {
    await navigator.clipboard.writeText(value)
    toast.add({ title: '账号已复制，请妥善保管', color: 'success' })
  } catch {
    toast.add({ title: '无法复制，请检查浏览器剪贴板权限', color: 'error' })
  }
}
watch([() => props.code, () => props.allowed, () => props.available, () => sessionScope?.value], () => {
  clear()
  open.value = false
}, { flush: 'sync' })
watch(open, (value) => {
  if (!value)
    clear()
}, { flush: 'sync' })
onMounted(() => document.addEventListener('visibilitychange', controller.tick))
onScopeDispose(() => {
  clear()
  document.removeEventListener('visibilitychange', controller.tick)
})
</script>

<template>
  <div
    v-if="allowed && available"
    class="space-y-2"
  >
    <UButton
      color="neutral"
      variant="outline"
      @click="open = true"
    >
      查看完整账号
    </UButton>
    <p class="text-xs text-muted">
      每次查看都会被记录，完整账号仅显示 60 秒。
    </p>
  </div>
  <UModal
    v-model:open="open"
    title="查看完整银行账号"
    description="每次查看都会被记录。关闭或 60 秒到期即清除。"
  >
    <template #body>
      <form
        v-if="!state.accountNo"
        class="space-y-4"
        @submit.prevent="reveal"
      >
        <UFormField
          label="查看原因"
          required
        >
          <UTextarea
            v-model="reason"
            :disabled="state.pending"
            minlength="4"
            maxlength="200"
            placeholder="请说明本次查看用途"
            class="w-full"
          />
        </UFormField>
        <UAlert
          v-if="state.error"
          color="error"
          :title="state.error"
        />
        <UButton
          type="submit"
          :disabled="!allowed || !available"
          :loading="state.pending"
        >
          确认查看
        </UButton>
      </form>
      <div
        v-else
        class="space-y-3"
      >
        <p
          class="select-text break-all rounded-lg border border-default p-3 font-mono"
          aria-label="完整银行账号"
        >
          {{ state.accountNo }}
        </p><p
          role="status"
          class="text-sm text-muted"
        >
          {{ state.remainingSeconds }} 秒后清除
        </p><UButton
          color="neutral"
          variant="outline"
          @click="copy"
        >
          复制账号
        </UButton><UButton
          color="neutral"
          @click="open = false"
        >
          关闭并清除
        </UButton>
      </div>
    </template>
  </UModal>
</template>
