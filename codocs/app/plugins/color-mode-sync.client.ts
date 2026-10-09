const SHARED_COLOR_MODE_KEY = 'hzy-color-mode'
const LEGACY_COLOR_MODE_KEY = 'nuxt-color-mode'
const VUEUSE_COLOR_MODE_KEY = 'vueuse-color-scheme'
const VALID_PREFERENCES = new Set(['light', 'dark', 'system'])

export default defineNuxtPlugin(() => {
  const colorMode = useColorMode()

  const storedSharedPreference = window.localStorage.getItem(SHARED_COLOR_MODE_KEY)
  const storedLegacyPreference = window.localStorage.getItem(LEGACY_COLOR_MODE_KEY)
  const storedVueUsePreference = window.localStorage.getItem(VUEUSE_COLOR_MODE_KEY)

  if ((!storedSharedPreference || !VALID_PREFERENCES.has(storedSharedPreference)) && storedLegacyPreference && VALID_PREFERENCES.has(storedLegacyPreference)) {
    colorMode.preference = storedLegacyPreference
  } else if ((!storedSharedPreference || !VALID_PREFERENCES.has(storedSharedPreference)) && storedVueUsePreference) {
    colorMode.preference = storedVueUsePreference === 'auto' ? 'system' : storedVueUsePreference
  }

  watch(() => colorMode.preference, (preference) => {
    const vueUsePreference = preference === 'system' ? 'auto' : preference
    window.localStorage.setItem(VUEUSE_COLOR_MODE_KEY, vueUsePreference)
  }, { immediate: true })
})
