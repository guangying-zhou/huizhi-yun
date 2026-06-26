<template>
  <div class="space-y-4">
    <!-- Section Header -->
    <div class="border-b pb-3 mb-4">
      <h4 class="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
        <UIcon name="i-heroicons-phone" class="w-5 h-5 text-green-500" />
        Contact Information
      </h4>
      <p class="text-sm text-gray-600 dark:text-gray-400 mt-1">
        Configure contact information displayed in the footer
      </p>
    </div>

    <!-- Contact Information Configuration -->
    <div class="space-y-4">
      <!-- Email -->
      <div class="space-y-2">
        <label class="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <UIcon name="i-heroicons-envelope" class="w-4 h-4 text-blue-500" />
          Email
        </label>
        <div class="flex items-center gap-2">
          <UInput
            v-model="localData.contacts.email.value"
            placeholder="your@email.com"
            type="email"
            size="sm"
            class="flex-1"
            
            @input="updateData"
          />
        </div>
      </div>

      <!-- Phone -->
      <div class="space-y-2">
        <label class="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <UIcon name="i-heroicons-phone" class="w-4 h-4 text-green-500" />
          Phone
        </label>
        <div class="flex items-center gap-2">
          <UInput
            v-model="localData.contacts.phone.value"
            placeholder="+1 (555) 123-4567"
            type="tel"
            size="sm"
            class="flex-1"
            
            @input="updateData"
          />
        </div>
      </div>

      <!-- Mobile -->
      <div class="space-y-2">
        <label class="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <UIcon name="i-heroicons-device-phone-mobile" class="w-4 h-4 text-purple-500" />
          Mobile
        </label>
        <div class="flex items-center gap-2">
          <UInput
            v-model="localData.contacts.mobile.value"
            placeholder="+1 (555) 987-6543"
            type="tel"
            size="sm"
            class="flex-1"
            
            @input="updateData"
          />
        </div>
      </div>

      <!-- Telegram -->
      <div class="space-y-2">
        <label class="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <UIcon name="i-simple-icons-telegram" class="w-4 h-4 text-blue-400" />
          Telegram
        </label>
        <div class="flex items-center gap-2">
          <div class="flex-1 flex items-center">
            <span class="text-sm text-gray-500 mr-1">@</span>
            <UInput
              v-model="localData.contacts.telegram.value"
              placeholder="yourusername"
              size="sm"
              class="flex-1"
              
              @input="updateData"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Preview -->
  <div class="mt-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
      <h5 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">Preview</h5>
      <div class="flex flex-wrap items-center gap-2">
        <template v-for="(contact, key) in localData.contacts" :key="key">
          <div
            v-if="contact.value"
            class="flex items-center gap-1 px-2 py-1 bg-white dark:bg-gray-700 rounded border border-gray-200 dark:border-gray-600 text-xs"
            :title="`${key}: ${getContactValue(key, contact.value)}`"
          >
            <UIcon
              :name="getContactIcon(key)"
              class="w-3 h-3"
              :class="getContactColor(key)"
            />
            <span class="text-gray-600 dark:text-gray-300">{{ getContactLabel(key, contact.value) }}</span>
          </div>
        </template>
        <div v-if="!hasAnyContacts" class="text-sm text-gray-500 dark:text-gray-400">
          No contact information set
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface ContactInfo {
  value: string
}

interface ContactData {
  contacts: {
    email: ContactInfo
    phone: ContactInfo
    mobile: ContactInfo
    telegram: ContactInfo
  }
}

interface Props {
  data: Record<string, any>
}

const props = defineProps<Props>()
const emit = defineEmits<{
  update: [sectionKey: string, data: Record<string, any>]
}>()

// 默认数据结构
const defaultData: ContactData = {
  contacts: {
    email: { value: '' },
    phone: { value: '' },
    mobile: { value: '' },
    telegram: { value: '' }
  }
}

// 本地数据
const localData = ref<ContactData>({
  ...defaultData,
  ...props.data.contact
})

// 计算属性
const hasAnyContacts = computed(() => {
  return Object.values(localData.value.contacts).some(contact => !!contact.value)
})

// 更新数据
const updateData = () => {
  emit('update', 'contact', localData.value)
}

// 获取联系方式图标
const getContactIcon = (type: string): string => {
  const iconMap: Record<string, string> = {
    email: 'i-heroicons-envelope',
    phone: 'i-heroicons-phone',
    mobile: 'i-heroicons-device-phone-mobile',
    telegram: 'i-simple-icons-telegram'
  }
  return iconMap[type] || 'i-heroicons-phone'
}

// 获取联系方式颜色
const getContactColor = (type: string): string => {
  const colorMap: Record<string, string> = {
    email: 'text-blue-500',
    phone: 'text-green-500',
    mobile: 'text-purple-500',
    telegram: 'text-blue-400'
  }
  return colorMap[type] || 'text-gray-500'
}

// 获取联系方式标签
const getContactLabel = (type: string, value: string): string => {
  if (type === 'telegram') {
    return `@${value}`
  }
  return value
}

// 获取联系方式完整值
const getContactValue = (type: string, value: string): string => {
  switch (type) {
    case 'email':
      return `mailto:${value}`
    case 'phone':
    case 'mobile':
      return `tel:${value}`
    case 'telegram':
      return `https://t.me/${value}`
    default:
      return value
  }
}

// 监听props变化
watch(() => props.data.contact, (newData) => {
  if (newData) {
    localData.value = {
      ...defaultData,
      ...newData
    }
  }
}, { deep: true, immediate: true })
</script>