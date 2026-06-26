<template>
  <div
    v-if="languages && languages.length > 0"
    class="flex flex-col gap-4 pt-4"
  >
    <div class="text-sm font-semibold flex justify-center">
      编程语言分布
    </div>

    <!-- Progress Bar -->
    <div class="flex h-3 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
      <div
        v-for="(lang, index) in processedLanguages"
        :key="lang.name"
        :style="{ width: lang.percentage + '%', backgroundColor: lang.color }"
        class="h-full transition-all duration-500"
        :title="`${lang.name}: ${lang.percentage}%`"
      />
    </div>

    <!-- Legend -->
    <div class="flex flex-wrap gap-x-6 gap-y-2">
      <div
        v-for="lang in processedLanguages"
        :key="lang.name"
        class="flex items-center gap-2 text-sm"
      >
        <div
          class="h-3 w-3 rounded-full"
          :style="{ backgroundColor: lang.color }"
        />
        <span class="text-xs">{{ lang.name }}</span>
        <span class="text-xs font-mono">{{ lang.percentage }}%</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface LanguageStat {
  name: string
  value: number
}

interface ProcessedLanguage extends LanguageStat {
  percentage: string
  color: string
}

const props = defineProps<{
  languages: LanguageStat[] | null
}>()

// Predefined colors for common languages, fallback to a generated color
const languageColors: Record<string, string> = {
  'Vue': '#41b883',
  'TypeScript': '#3178c6',
  'JavaScript': '#f1e05a',
  'Python': '#3572a5',
  'Java': '#b07219',
  'HTML': '#e34c26',
  'CSS': '#563d7c',
  'C++': '#f34b7d',
  'C': '#555555',
  'Go': '#00add8',
  'Rust': '#dea584',
  'PHP': '#4f5d95',
  'Ruby': '#701516',
  'Swift': '#ffac45',
  'Kotlin': '#a97bff',
  'Other': '#ededed' // Light grey for Other
}

// Function to generate a consistent color from a string if not in map
function stringToColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  const c = (hash & 0x00ffffff).toString(16).toUpperCase()
  return '#' + '00000'.substring(0, 6 - c.length) + c
}

const processedLanguages = computed<ProcessedLanguage[]>(() => {
  if (!props.languages || props.languages.length === 0) return []

  const total = props.languages.reduce((sum, lang) => sum + lang.value, 0)
  if (total === 0) return []

  return props.languages.map((lang) => {
    const percentage = ((lang.value / total) * 100).toFixed(1)
    let color = languageColors[lang.name]

    if (!color) {
      if (lang.name === 'Other') {
        color = '#ededed'
      } else {
        color = stringToColor(lang.name)
      }
    }

    return {
      ...lang,
      percentage,
      color
    }
  })
})
</script>
