<template>
  <UModal :open="isOpen" @update:open="(value: boolean) => !value && closeModal()" :ui="{ content: 'max-w-2xl w-full' }" prevent-close>
    <template #content>
      <UCard :ui="{ body: 'max-h-[70vh] overflow-y-auto p-6' }">
        <template #header>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <UIcon name="i-heroicons-magnifying-glass" class="w-6 h-6 text-primary-500" />
              <div>
                <h3 class="text-lg font-semibold text-gray-900 dark:text-white">
                  SEO Settings
                </h3>
                <p class="text-sm text-gray-500 dark:text-gray-400">
                  Configure search engine optimization settings for {{ businessName }}
                </p>
              </div>
            </div>
            <UButton @click="closeModal" variant="ghost" icon="i-heroicons-x-mark" size="sm" />
          </div>
        </template>

        <div class="space-y-6">
          <!-- Basic SEO Settings -->
          <div class="space-y-4">
            <h4 class="font-medium text-gray-900 dark:text-white flex items-center gap-2">
              <UIcon name="i-heroicons-document-text" class="w-4 h-4" />
              Basic SEO
            </h4>

            <!-- Site Title -->
            <div class="space-y-2">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Site Title
              </label>
              <UInput
                v-model="localSettings.siteTitle"
                placeholder="Your Site Title"
                size="sm"
                class="w-full"
              />
              <p class="text-xs text-gray-500 dark:text-gray-400">
                The default title for your website (will be used if page doesn't have specific title)
              </p>
            </div>

            <!-- Site Description -->
            <div class="space-y-2">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Site Description
              </label>
              <UTextarea
                v-model="localSettings.siteDescription"
                placeholder="Brief description of your website"
                :rows="3"
                size="sm"
                class="w-full"
              />
              <p class="text-xs text-gray-500 dark:text-gray-400">
                Default meta description for your website
              </p>
            </div>

            <!-- Site Keywords -->
            <div class="space-y-2">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Keywords
              </label>
              <UInput
                v-model="localSettings.keywords"
                placeholder="keyword1, keyword2, keyword3"
                size="sm"
                class="w-full"
              />
              <p class="text-xs text-gray-500 dark:text-gray-400">
                Comma-separated keywords related to your business
              </p>
            </div>
          </div>

          <!-- Social Media SEO -->
          <div class="border-t pt-6">
            <h4 class="font-medium text-gray-900 dark:text-white flex items-center gap-2 mb-4">
              <UIcon name="i-heroicons-share" class="w-4 h-4" />
              Social Media
            </h4>

            <div class="space-y-4">
              <!-- OG Title -->
              <div class="space-y-2">
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Social Media Title
                </label>
                <UInput
                  v-model="localSettings.ogTitle"
                  placeholder="Title for social media sharing"
                  size="sm"
                  class="w-full"
                />
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  Title shown when your site is shared on social media
                </p>
              </div>

              <!-- OG Description -->
              <div class="space-y-2">
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Social Media Description
                </label>
                <UTextarea
                  v-model="localSettings.ogDescription"
                  placeholder="Description for social media sharing"
                  :rows="2"
                  size="sm"
                  class="w-full"
                />
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  Description shown when your site is shared on social media
                </p>
              </div>

              <!-- OG Image URL -->
              <div class="space-y-2">
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Social Media Image URL
                </label>
                <UInput
                  v-model="localSettings.ogImage"
                  placeholder="https://example.com/image.jpg"
                  size="sm"
                  class="w-full"
                />
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  Image shown when your site is shared on social media (recommended: 1200x630px)
                </p>
              </div>
            </div>
          </div>

          <!-- Advanced SEO -->
          <div class="border-t pt-6">
            <h4 class="font-medium text-gray-900 dark:text-white flex items-center gap-2 mb-4">
              <UIcon name="i-heroicons-cog-6-tooth" class="w-4 h-4" />
              Advanced
            </h4>

            <div class="space-y-4">
              <!-- Google Analytics -->
              <div class="space-y-2">
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Google Analytics ID
                </label>
                <UInput
                  v-model="localSettings.googleAnalyticsId"
                  placeholder="G-XXXXXXXXXX"
                  size="sm"
                  class="w-full"
                />
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  Your Google Analytics measurement ID
                </p>
              </div>

              <!-- Google Search Console -->
              <div class="space-y-2">
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Google Search Console Verification
                </label>
                <UInput
                  v-model="localSettings.googleSiteVerification"
                  placeholder="verification-code"
                  size="sm"
                  class="w-full"
                />
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  Google Search Console verification meta tag content
                </p>
              </div>

              <!-- Robots.txt settings -->
              <div class="space-y-2">
                <div class="flex items-center gap-3">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Allow Search Engine Indexing
                    </label>
                    <p class="text-xs text-gray-500 dark:text-gray-400">
                      Allow search engines to index your website
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <template #footer>
          <div class="flex justify-between gap-3 w-full">
            <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400" v-if="generatedMeta">
              <UIcon name="i-heroicons-sparkles" class="w-4 h-4 text-primary-500" />
              <span>AI generated at {{ generatedMeta.time }}</span>
              <UButton size="xs" variant="ghost" :loading="regenerating" @click="regenerate(true)">Regenerate</UButton>
            </div>
            <div class="flex gap-3 ml-auto">
              <UButton @click="generate" color="primary" variant="soft" :loading="generating" v-if="!generatedMeta">
                <UIcon name="i-heroicons-sparkles" class="w-4 h-4 mr-1" /> AI Generate
              </UButton>
              <UButton @click="closeModal" variant="ghost" color="neutral">Cancel</UButton>
              <UButton @click="saveSettings" color="primary" :loading="saving">Save SEO Settings</UButton>
            </div>
          </div>
        </template>
      </UCard>
    </template>
  </UModal>
</template>

<script setup lang="ts">
interface Props {
  isOpen: boolean
  seoSettings: Record<string, any>
  businessName?: string
}

interface Emits {
  (e: 'close'): void
  (e: 'save', settings: Record<string, any>): void
}

const props = withDefaults(defineProps<Props>(), {
  businessName: 'Your Business'
})
const emit = defineEmits<Emits>()

// Local state for SEO settings
const localSettings = ref({
  siteTitle: '',
  siteDescription: '',
  keywords: '',
  ogTitle: '',
  ogDescription: '',
  ogImage: '',
  googleAnalyticsId: '',
  googleSiteVerification: '',
  allowIndexing: true
})

const saving = ref(false)
const generating = ref(false)
const regenerating = ref(false)
const generatedMeta = ref<{ time: string } | null>(null)

const business = computed(() => props.businessName || 'www')

// Initialize local settings from props
watch(() => props.seoSettings, (newSettings) => {
  if (newSettings) {
    localSettings.value = {
      siteTitle: newSettings.siteTitle || '',
      siteDescription: newSettings.siteDescription || '',
      keywords: newSettings.keywords || '',
      ogTitle: newSettings.ogTitle || '',
      ogDescription: newSettings.ogDescription || '',
      ogImage: newSettings.ogImage || '',
      googleAnalyticsId: newSettings.googleAnalyticsId || '',
      googleSiteVerification: newSettings.googleSiteVerification || '',
      allowIndexing: newSettings.allowIndexing !== false
    }
  }
}, { immediate: true, deep: true })

// Methods
const closeModal = () => {
  emit('close')
}

const saveSettings = async () => {
  saving.value = true
  try {
    emit('save', { ...localSettings.value })
  } finally {
    saving.value = false
  }
}

async function generate() {
  generating.value = true
  try {
    const resp: any = await $fetch(`/api/seo/${business.value}/generate`, { method: 'POST' })
    if (resp.success) {
      applySeo(resp.seoSettings)
      generatedMeta.value = { time: new Date().toLocaleTimeString() }
      useToast().add({ title: 'AI Generated', description: 'SEO settings generated', color: 'success' })
    }
  } catch (e: any) {
    console.error('AI generate failed', e)
    useToast().add({ title: 'AI Failed', description: 'Could not generate SEO via AI', color: 'error' })
  } finally {
    generating.value = false
  }
}

async function regenerate(force = false) {
  regenerating.value = true
  try {
    const resp: any = await $fetch(`/api/seo/${business.value}/generate?force=1`, { method: 'POST' })
    if (resp.success) {
      applySeo(resp.seoSettings)
      generatedMeta.value = { time: new Date().toLocaleTimeString() }
      useToast().add({ title: 'Regenerated', description: 'SEO refreshed', color: 'success' })
    }
  } catch (e: any) {
    useToast().add({ title: 'AI Failed', description: 'Could not regenerate', color: 'error' })
  } finally {
    regenerating.value = false
  }
}

function applySeo(seo: any) {
  if (!seo) return
  localSettings.value.siteTitle = seo.siteTitle || ''
  localSettings.value.siteDescription = seo.siteDescription || ''
  localSettings.value.keywords = seo.keywords || ''
  localSettings.value.ogTitle = seo.ogTitle || ''
  localSettings.value.ogDescription = seo.ogDescription || ''
  if (seo.ogImage) localSettings.value.ogImage = seo.ogImage
}

watch(() => props.seoSettings, (s) => {
  if (s?._generatedAt) {
    generatedMeta.value = { time: new Date(s._generatedAt).toLocaleTimeString() }
  }
}, { immediate: true })
</script>