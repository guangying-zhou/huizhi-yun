<template>
  <div ref="pickerRef" class="relative w-full">
    <!-- Current Icon Display -->
    <div 
      class="flex items-center justify-between h-8 px-2.5 border border-gray-300 dark:border-gray-600 rounded-md bg-transparent dark:bg-transparent cursor-pointer hover:border-gray-400 dark:hover:border-gray-500 transition-colors text-xs leading-none"
      @click="showPicker = !showPicker"
    >
      <div class="flex items-center gap-1.5">
        <UIcon v-if="modelValue" :name="modelValue" class="w-4 h-4" />
        <span v-else class="text-gray-500 text-xs">Select Icon</span>
      </div>
      <UIcon name="i-lucide-chevron-down" class="w-4 h-4 text-gray-400" />
    </div>

    <!-- Icon Picker Dropdown -->
    <div
      v-if="showPicker"
      ref="dropdownRef"
      :class="[
        'absolute z-50 bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-80 overflow-hidden',
        dropdownPosition === 'top' ? 'bottom-full mb-2 origin-bottom-left' : 'top-full mt-2 origin-top-left',
        dropdownDoubleWidth
          ? 'left-0 right-auto'
          : (dropdownFullWidth ? 'left-0 right-0' : 'left-0 right-auto'),
        !dropdownFullWidth && !dropdownDoubleWidth && dropdownWidthClass
      ]"
      :style="dropdownDoubleWidth ? dropdownStyle : undefined"
    >
      
      
      <div class="max-h-56 overflow-y-auto p-1">
        <!-- <div class="text-xs text-gray-500 mb-2">Icons: {{ filteredIcons.length }}</div> -->
        <div class="grid grid-cols-6 gap-2">
          <button 
            v-for="icon in filteredIcons"
            :key="icon.value"
            type="button"
            class="flex flex-col items-center p-1 rounded cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 border border-transparent transition-colors focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-gray-500"
            :class="{ 'bg-gray-200 dark:bg-gray-600 border-gray-300 dark:border-gray-500': modelValue === icon.value }"
            @click="selectIcon(icon.value)"
            :title="icon.label"
          >
            <div class="w-5 h-4 flex items-center justify-center">
              <UIcon :name="icon.value" class="w-4 h-4 pointer-events-none" />
            </div>
            <!-- Icon name hidden as requested -->
          </button>
        </div>
      </div>
      
      <div class="flex justify-between p-1 border-t border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-700">
        <UButton variant="ghost" size="xs" @click="clearIcon">Clear</UButton>
        <UButton variant="ghost" size="xs" @click="showPicker = false">Close</UButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Props {
  modelValue?: string
  placeholder?: string
  dropdownFullWidth?: boolean
  dropdownWidthClass?: string
  dropdownDoubleWidth?: boolean
}

interface Emits {
  (e: 'update:modelValue', value: string): void
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Select an icon',
  dropdownFullWidth: true,
  dropdownWidthClass: 'w-[28rem]',
  dropdownDoubleWidth: false
})

const emit = defineEmits<Emits>()

const showPicker = ref(false)
const searchQuery = ref('')
const triggerWidth = ref(0)
const dropdownRef = ref<HTMLElement | null>(null)
const dropdownPosition = ref<'bottom' | 'top'>('bottom')
const dropdownStyle = computed(() => {
  const width = Math.max(0, Math.round(triggerWidth.value * 2))
  return width ? { width: width + 'px' } : undefined
})

// 使用Lucide图标 - 48个常用图标，按字母顺序排列
const commonIcons = [
  { value: 'i-lucide-arrow-right', name: 'Arrow Right', label: 'Arrow Right' },
  { value: 'i-lucide-bar-chart', name: 'Bar Chart', label: 'Bar Chart' },
  { value: 'i-lucide-bell-ring', name: 'Bell Ring', label: 'Bell Ring' },
  { value: 'i-lucide-book-open', name: 'Book Open', label: 'Book Open' },
  { value: 'i-lucide-bookmark', name: 'Bookmark', label: 'Bookmark' },
  { value: 'i-lucide-briefcase', name: 'Briefcase', label: 'Briefcase' },
  { value: 'i-lucide-building', name: 'Building', label: 'Building' },
  { value: 'i-lucide-calendar', name: 'Calendar', label: 'Calendar' },
  { value: 'i-lucide-camera', name: 'Camera', label: 'Camera' },
  { value: 'i-lucide-chart-bar', name: 'Chart Bar', label: 'Chart Bar' },
  { value: 'i-lucide-chart-line', name: 'Chart Line', label: 'Chart Line' },
  { value: 'i-lucide-check', name: 'Check', label: 'Check' },
  { value: 'i-lucide-circle-dollar-sign', name: 'Circle Dollar', label: 'Circle Dollar Sign' },
  { value: 'i-lucide-circle-help', name: 'Circle Help', label: 'Circle Help' },
  { value: 'i-lucide-clock', name: 'Clock', label: 'Clock' },
  { value: 'i-lucide-code-xml', name: 'Code XML', label: 'Code XML' },
  { value: 'i-lucide-cog', name: 'Cog', label: 'Cog' },
  { value: 'i-lucide-copy', name: 'Copy', label: 'Copy' },
  { value: 'i-lucide-credit-card', name: 'Credit Card', label: 'Credit Card' },
  { value: 'i-lucide-dollar-sign', name: 'Dollar Sign', label: 'Dollar Sign' },
  { value: 'i-lucide-download', name: 'Download', label: 'Download' },
  { value: 'i-lucide-edit', name: 'Edit', label: 'Edit' },
  { value: 'i-lucide-filter', name: 'Filter', label: 'Filter' },
  { value: 'i-lucide-gift', name: 'Gift', label: 'Gift' },
  { value: 'i-lucide-globe', name: 'Globe', label: 'Globe' },
  { value: 'i-lucide-heart', name: 'Heart', label: 'Heart' },
  { value: 'i-lucide-home', name: 'Home', label: 'Home' },
  { value: 'i-lucide-image', name: 'Image', label: 'Image' },
  { value: 'i-lucide-link', name: 'Link', label: 'Link' },
  { value: 'i-lucide-lock', name: 'Lock', label: 'Lock' },
  { value: 'i-lucide-mail', name: 'Mail', label: 'Mail' },
  { value: 'i-lucide-map-pin', name: 'Map Pin', label: 'Map Pin' },
  { value: 'i-lucide-moon', name: 'Moon', label: 'Moon' },
  { value: 'i-lucide-mouse-pointer-2', name: 'Mouse Pointer', label: 'Mouse Pointer 2' },
  { value: 'i-lucide-newspaper', name: 'Newspaper', label: 'Newspaper' },
  { value: 'i-lucide-phone', name: 'Phone', label: 'Phone' },
  { value: 'i-lucide-plus', name: 'Plus', label: 'Plus' },
  { value: 'i-lucide-rocket', name: 'Rocket', label: 'Rocket' },
  { value: 'i-lucide-search', name: 'Search', label: 'Search' },
  { value: 'i-lucide-settings', name: 'Settings', label: 'Settings' },
  { value: 'i-lucide-share', name: 'Share', label: 'Share' },
  { value: 'i-lucide-shield', name: 'Shield', label: 'Shield' },
  { value: 'i-lucide-shopping-cart', name: 'Shopping Cart', label: 'Shopping Cart' },
  { value: 'i-lucide-star', name: 'Star', label: 'Star' },
  { value: 'i-lucide-tag', name: 'Tag', label: 'Tag' },
  { value: 'i-lucide-trash', name: 'Trash', label: 'Trash' },
  { value: 'i-lucide-trophy', name: 'Trophy', label: 'Trophy' },
  { value: 'i-lucide-upload', name: 'Upload', label: 'Upload' },
  { value: 'i-lucide-user', name: 'User', label: 'User' },
  { value: 'i-lucide-users', name: 'Users', label: 'Users' },
  { value: 'i-lucide-wand-sparkles', name: 'Wand Sparkles', label: 'Wand Sparkles' },
  { value: 'i-lucide-x', name: 'X Mark', label: 'X Mark' }
]

const filteredIcons = computed(() => commonIcons)

const selectIcon = (iconValue: string) => {
  console.log('🎯 Icon selected:', iconValue)
  emit('update:modelValue', iconValue)
  showPicker.value = false
}

const clearIcon = () => {
  console.log('🗑️ Icon cleared')
  emit('update:modelValue', '')
  showPicker.value = false
}

// Template ref for the picker
const pickerRef = ref<HTMLElement | null>(null)

const updateDropdownPosition = () => {
  if (!process.client) return
  const triggerEl = pickerRef.value
  const dropdownEl = dropdownRef.value
  if (!triggerEl || !dropdownEl) return

  const triggerRect = triggerEl.getBoundingClientRect()
  const dropdownHeight = dropdownEl.offsetHeight || 0
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight
  const spaceBelow = viewportHeight - triggerRect.bottom
  const spaceAbove = triggerRect.top

  dropdownPosition.value = spaceBelow < dropdownHeight && spaceAbove > spaceBelow ? 'top' : 'bottom'
}

const schedulePositionUpdate = () => {
  if (!process.client) return
  nextTick(() => {
    requestAnimationFrame(() => {
      updateDropdownPosition()
    })
  })
}

const measureTrigger = () => {
  const el = pickerRef.value
  if (!el) return
  triggerWidth.value = el.getBoundingClientRect().width
  updateDropdownPosition()
}

// Close picker when clicking outside
if (process.client) {
  onClickOutside(pickerRef, () => {
    showPicker.value = false
  })

  const handleResize = () => {
    measureTrigger()
    schedulePositionUpdate()
  }
  const handleScroll = () => {
    schedulePositionUpdate()
  }

  watch(showPicker, (isOpen: boolean) => {
    if (isOpen) {
      nextTick(() => {
        measureTrigger()
        schedulePositionUpdate()
      })
    }
  })

  window.addEventListener('resize', handleResize)
  window.addEventListener('scroll', handleScroll, true)
  onUnmounted(() => {
    window.removeEventListener('resize', handleResize)
    window.removeEventListener('scroll', handleScroll, true)
  })
}
</script>
