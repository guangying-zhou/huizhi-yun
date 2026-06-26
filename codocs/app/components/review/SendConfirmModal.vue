<template>
  <UModal v-model:open="isOpen" title="确认发送" description="请登记实际发送信息">
    <template #body>
      <div class="p-4 space-y-4">
        <UAlert
          color="info"
          icon="i-lucide-send"
          title="发送登记"
          :description="`请在实际完成发送后，再登记《${docTitle || '当前文档'}》的发送信息。`"
        />

        <UFormField label="发送人" required>
          <USelectMenu
            v-model="senderUid"
            :items="senderOptions"
            value-key="value"
            label-key="label"
            class="w-full"
            placeholder="请选择发送人"
          />
        </UFormField>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <UFormField label="接收人" required class="w-full">
            <UInput v-model="receiverName" placeholder="请输入接收人" class="w-full" />
          </UFormField>

          <UFormField label="联系电话" required class="w-full">
            <UInput v-model="receiverPhone" placeholder="请输入联系电话" class="w-full" />
          </UFormField>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <UFormField label="发送途径" required class="w-full">
            <USelectMenu
              v-model="channel"
              :items="channelOptions"
              value-key="value"
              label-key="label"
              class="w-full"
              :search-input="false"
            />
          </UFormField>

          <UFormField :label="requiresTargetAccount ? '对方账号' : '对方账号（选填）'" :required="requiresTargetAccount" class="w-full">
            <UInput
              v-model="targetAccount"
              :disabled="channel === 'usb' || channel === 'other_method'"
              :placeholder="targetAccountPlaceholder"
              class="w-full"
            />
          </UFormField>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <UFormField label="发送日期" required class="w-full">
            <UInput
              v-model="sentDate"
              type="date"
              :max="todayDateString"
              class="w-full"
            />
          </UFormField>

          <UFormField :label="requiresRemark ? '备注（必填）' : '备注'" :required="requiresRemark" class="w-full">
            <UTextarea
              v-model="remark"
              :rows="3"
              :placeholder="requiresRemark ? '请说明具体发送方式' : '可填写发送说明'"
              class="w-full"
            />
          </UFormField>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="outline" @click="isOpen = false">
          取消
        </UButton>
        <UButton color="primary" :loading="submitting" @click="handleConfirm">
          确认发送
        </UButton>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import type { AccountUsersResponse } from '~/types/account'

interface ApiErrorLike {
  data?: {
    message?: string
  }
  message?: string
}

interface SenderOption {
  label: string
  value: string
}

type SendChannel = 'email' | 'wecom' | 'wechat_qq' | 'web_upload' | 'sf_express' | 'other_courier' | 'other_method' | 'usb'

const props = defineProps<{
  open: boolean
  reviewId: number
  docTitle?: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'success'): void
}>()

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const { user } = useAuth()
const toast = useToast()
const submitting = ref(false)
const senderOptions = ref<SenderOption[]>([])
const senderUid = ref('')
const receiverName = ref('')
const receiverPhone = ref('')
const channel = ref<SendChannel>('email')
const sentDate = ref('')
const targetAccount = ref('')
const remark = ref('')
const loadingUsers = ref(false)

const getTodayDateString = () => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const todayDateString = getTodayDateString()

const channelOptions = [
  { label: '邮件', value: 'email' as const },
  { label: '企业微信', value: 'wecom' as const },
  { label: '微信/QQ', value: 'wechat_qq' as const },
  { label: '网页上传', value: 'web_upload' as const },
  { label: '顺丰快递', value: 'sf_express' as const },
  { label: '其他快递', value: 'other_courier' as const },
  { label: '其他方式', value: 'other_method' as const },
  { label: 'U盘', value: 'usb' as const }
]

const requiresTargetAccount = computed(() => channel.value !== 'usb' && channel.value !== 'other_method')
const requiresRemark = computed(() => channel.value === 'other_method')

const targetAccountPlaceholder = computed(() => {
  const placeholders: Record<SendChannel, string> = {
    email: '请输入邮箱地址',
    wecom: '请输入企业微信账号',
    wechat_qq: '请输入微信号或 QQ 号码',
    web_upload: '请输入网页平台账号',
    sf_express: '请输入快递单号或寄递信息',
    other_courier: '请输入快递单号或寄递信息',
    other_method: '其他方式无需填写账号',
    usb: ''
  }
  return placeholders[channel.value]
})

const resetForm = () => {
  senderUid.value = String(user.value || '').trim()
  receiverName.value = ''
  receiverPhone.value = ''
  channel.value = 'email'
  sentDate.value = todayDateString
  targetAccount.value = ''
  remark.value = ''
}

const loadUsers = async () => {
  if (senderOptions.value.length || loadingUsers.value) return

  loadingUsers.value = true
  try {
    const response = await $fetch<AccountUsersResponse>('/api/account/users')
    const options = (response.data?.items || [])
      .filter(item => item.uid)
      .map(item => ({
        label: item.realName ? `${item.realName} (${item.uid})` : item.uid,
        value: item.uid
      }))

    const currentUid = String(user.value || '').trim()
    senderOptions.value = options.sort((a, b) => {
      if (a.value === currentUid) return -1
      if (b.value === currentUid) return 1
      return a.label.localeCompare(b.label, 'zh-CN')
    })
  } catch (error) {
    console.error('[ReviewSendModal] Failed to load users:', error)
    toast.add({
      title: '加载发送人失败',
      description: '无法获取公司用户列表',
      color: 'error'
    })
  } finally {
    loadingUsers.value = false
  }
}

watch(isOpen, async (open) => {
  if (open) {
    resetForm()
    await loadUsers()
    return
  }

  resetForm()
})

watch(channel, (value) => {
  if (value === 'usb' || value === 'other_method') {
    targetAccount.value = ''
  }
})

const handleConfirm = async () => {
  if (!senderUid.value) {
    toast.add({
      title: '缺少发送人',
      description: '请选择发送人',
      color: 'warning'
    })
    return
  }

  if (!receiverName.value.trim()) {
    toast.add({
      title: '缺少接收人',
      description: '请填写接收人',
      color: 'warning'
    })
    return
  }

  if (!receiverPhone.value.trim()) {
    toast.add({
      title: '缺少联系电话',
      description: '请填写联系电话',
      color: 'warning'
    })
    return
  }

  if (requiresTargetAccount.value && !targetAccount.value.trim()) {
    toast.add({
      title: '缺少对方账号',
      description: '请填写对方账号或寄递信息',
      color: 'warning'
    })
    return
  }

  if (requiresRemark.value && !remark.value.trim()) {
    toast.add({
      title: '缺少备注说明',
      description: '选择其他方式时请在备注中说明具体发送方式',
      color: 'warning'
    })
    return
  }

  if (!sentDate.value) {
    toast.add({
      title: '缺少发送日期',
      description: '请选择实际发送日期',
      color: 'warning'
    })
    return
  }

  if (sentDate.value > todayDateString) {
    toast.add({
      title: '发送日期无效',
      description: '发送日期不能晚于今天',
      color: 'warning'
    })
    return
  }

  submitting.value = true
  try {
    await $fetch(`/api/reviews/${props.reviewId}/send`, {
      method: 'POST',
      body: {
        senderUid: senderUid.value,
        receiverName: receiverName.value.trim(),
        receiverPhone: receiverPhone.value.trim(),
        channel: channel.value,
        sentDate: sentDate.value,
        targetAccount: requiresTargetAccount.value ? targetAccount.value.trim() : null,
        remark: remark.value.trim() || null
      }
    })

    toast.add({
      title: '发送已确认',
      description: '系统已记录发送信息',
      color: 'success'
    })

    isOpen.value = false
    emit('success')
  } catch (error: unknown) {
    const err = error as ApiErrorLike
    toast.add({
      title: '确认失败',
      description: err.data?.message || err.message || '确认发送失败',
      color: 'error'
    })
  } finally {
    submitting.value = false
  }
}
</script>
