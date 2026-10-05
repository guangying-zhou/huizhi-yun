<template>
  <UModal :open="isOpen" @update:open="(value: boolean) => !value && closeModal()" :ui="{ content: 'max-w-3xl w-full' }" prevent-close>
    <template #content>
  <UCard :ui="{ body: 'max-h-[60vh] overflow-y-auto p-6' }">
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <UIcon name="i-heroicons-cog-6-tooth" class="w-6 h-6 text-primary-500" />
              <div>
                <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
                  Content Settings
                </h3>
                <p class="text-sm text-gray-500 dark:text-gray-400">
                  Configure sections displayed in the website content area
                </p>
              </div>
            </div>
            <UButton @click="closeModal" variant="ghost" icon="i-heroicons-x-mark" size="sm" />
          </div>
        </template>

  <div>
          <!-- Instructions -->
    <div class="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
            <div class="flex items-start gap-3">
              <UIcon name="i-heroicons-information-circle" class="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div>
                <h4 class="font-medium text-blue-900 dark:text-blue-100 mb-1">Setup Instructions</h4>
                <ul class="text-sm text-blue-700 dark:text-blue-300 space-y-1">
                  <li>• You can edit the section titles regardless of whether they are shown in the navigation</li>
                  <li>• The Hero (Home) can be shown in the navigation and is enabled by default</li>
                </ul>
              </div>
            </div>
          </div>

          <!-- Section List -->
          <div class="space-y-3">
            <h4 class="font-medium text-gray-900 dark:text-white flex items-center gap-2">
              <UIcon name="i-heroicons-cog-6-tooth" class="w-4 h-4" />
              Section Configuration
            </h4>

            <div class="space-y-2">
              <div
                v-for="(section, index) in sortedSections"
                :key="section.key"
                class="flex items-center gap-4 p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800"
                :class="{ 'opacity-60': !section.enabled }"
              >
                <!-- Section Icon and Basic Info -->
                <div class="flex items-center gap-3 flex-1 min-w-0">
                  <UIcon :name="section.icon" class="w-5 h-5 text-gray-600 dark:text-gray-400 shrink-0" />
                  <div class="min-w-0 flex-1">
                    <div class="font-medium text-gray-900 dark:text-white">
                      {{ section.name }}
                    </div>
                    <div class="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {{ section.description }}
                    </div>
                  </div>
                </div>

                <!-- Display Name Input (moved before Enabled; always editable) -->
                <div class="w-32">
                  <UInput
                    :model-value="section.displayName || section.name"
                    @update:model-value="(value: string) => updateSectionConfig(section.key, 'displayName', value)"
                    placeholder="Display name"
                    size="xs"
                    class="text-xs"
                  />
                </div>

                <!-- Navigation Bar Display Toggle (Hero supported) -->
                <div class="flex items-center gap-2">
                  <span class="text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap">Show in Nav</span>
                  <USwitch
                    :model-value="section.showInNav"
                    :disabled="!section.enabled"
                    @update:model-value="(value: boolean) => updateSectionConfig(section.key, 'showInNav', value)"
                    size="xs"
                  />
                </div>

                <!-- Section Enable Status -->
                <div class="flex items-center gap-2">
                  <span class="text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap">Enabled</span>
                  <USwitch
                    :model-value="section.enabled"
                    :disabled="section.key === 'hero'"
                    @update:model-value="(value: boolean) => updateSectionConfig(section.key, 'enabled', value)"
                    size="xs"
                  />
                </div>

                <!-- Wide Container Toggle (exclude Hero) -->
                <div v-if="section.key !== 'hero'" class="flex items-center gap-2">
                  <span class="text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap">Extended</span>
                  <USwitch
                    :model-value="section.wide"
                    :disabled="!section.enabled"
                    @update:model-value="(value: boolean) => updateSectionConfig(section.key, 'wide', value)"
                    size="xs"
                  />
                </div>
                <div v-else class="w-16"></div>
              </div>
            </div>
          </div>

          <!-- Preview -->
          <div class="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
            <h4 class="font-medium text-gray-900 dark:text-white mb-3 flex items-center gap-2">
              <UIcon name="i-heroicons-eye" class="w-4 h-4" />
              Navigation Bar Preview
            </h4>
            <div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
              <div class="flex items-center gap-6 justify-center text-sm">
                <span
                  v-for="section in navPreviewSections"
                  :key="section.key"
                  class="text-gray-600 dark:text-gray-300 hover:text-primary-600 cursor-pointer transition-colors"
                >
                  {{ section.displayName || section.name }}
                </span>
              </div>
            </div>
          </div>
        </div>
        <template #footer>
          <div class="flex items-center justify-end gap-3">
            <UButton @click="resetToDefaults" variant="outline" color="neutral">
              Reset to Defaults
            </UButton>
            <UButton @click="closeModal" variant="ghost" color="neutral">
              Cancel
            </UButton>
            <UButton @click="saveSettings" :loading="saving" color="primary" icon="i-heroicons-check">
              Save Settings
            </UButton>
          </div>
        </template>
      </UCard>
    </template>
  </UModal>
</template>

<script setup lang="ts">
interface SectionNavConfig {
  key: string
  name: string
  description: string
  icon: string
  enabled: boolean
  showInNav: boolean
  displayName?: string
  order: number
  wide?: boolean
}

interface Props {
  isOpen: boolean
  sections: any[]
  sectionSettings: Record<string, any>
  businessName: string
}

interface Emits {
  (e: 'close'): void
  (e: 'save', settings: Record<string, any>): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

// State
const saving = ref(false)
const localSectionConfigs = ref<Record<string, SectionNavConfig>>({})

// Initialize configurations
const initializeConfigs = () => {
  const configs: Record<string, SectionNavConfig> = {}

  props.sections.forEach((section, index) => {
    const currentSettings = props.sectionSettings[section.key] || {}

    configs[section.key] = {
      key: section.key,
      name: section.name,
      description: section.description,
      icon: section.icon,
  enabled: currentSettings.enabled !== false, // Default enabled
  // Hero now supports being shown in navigation, default true
  showInNav: currentSettings.showInNav !== false,
  displayName: currentSettings.displayName || (section.key === 'hero' ? 'Home' : section.name),
  order: currentSettings.order ?? index,
  // Default: About (key === 'section') is wide; others are not
  wide: currentSettings.wide ?? (section.key === 'section')
    }
  })

  localSectionConfigs.value = configs
}

// Watch props changes and re-initialize
watch(() => [props.sections, props.sectionSettings], initializeConfigs, {
  immediate: true,
  deep: true
})

// Computed: sections sorted by order (exclude socialMedia and contact from settings)
const sortedSections = computed(() => {
  return Object.values(localSectionConfigs.value)
    .filter(section => !['socialMedia', 'contact'].includes(section.key))
    .sort((a, b) => a.order - b.order)
})

// Computed: navigation preview sections
const navPreviewSections = computed(() => {
  return sortedSections.value
  .filter(section => section.enabled && section.showInNav)
})

// Update section configuration
const updateSectionConfig = (sectionKey: string, property: keyof SectionNavConfig, value: any) => {
  if (localSectionConfigs.value[sectionKey]) {
    (localSectionConfigs.value[sectionKey] as any)[property] = value

    // If disabling section, automatically turn off nav display
    if (property === 'enabled' && !value) {
      localSectionConfigs.value[sectionKey].showInNav = false
    }
  }
}

// Drag-and-drop removed by design; ordering controls not available in this version

// Reset to default settings
const resetToDefaults = () => {
  const configs: Record<string, SectionNavConfig> = {}

  props.sections.forEach((section, index) => {
    configs[section.key] = {
      key: section.key,
      name: section.name,
      description: section.description,
      icon: section.icon,
      enabled: true,
  showInNav: true,
  displayName: section.key === 'hero' ? 'Home' : section.name,
  order: index,
  wide: section.key === 'section'
    }
  })

  localSectionConfigs.value = configs
}

// Save settings
const saveSettings = async () => {
  saving.value = true

  try {
    // Convert to save format
    const settings: Record<string, any> = {}

    Object.values(localSectionConfigs.value).forEach(config => {
      settings[config.key] = {
        enabled: config.enabled,
        showInNav: config.showInNav,
        displayName: config.displayName !== config.name ? config.displayName : undefined,
  order: config.order,
  wide: config.wide
      }
    })

    emit('save', settings)
  } catch (error) {
    console.error('Failed to save settings:', error)
  } finally {
    saving.value = false
  }
}

// Close modal
const closeModal = () => {
  emit('close')
}
</script>

<style scoped>
</style>