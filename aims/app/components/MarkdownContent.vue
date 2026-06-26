<script setup lang="ts">
import { renderSafeMarkdown } from '~/utils/safeMarkdown'

const props = defineProps<{
  markdown: string | null | undefined
}>()

const markdownHeadingStyleMap: Record<number, string> = {
  1: 'font-size:1.25rem;font-weight:700;line-height:1.3;margin-top:1.1em;margin-bottom:0.5em;',
  2: 'font-size:1.125rem;font-weight:700;line-height:1.3;margin-top:1.1em;margin-bottom:0.5em;',
  3: 'font-size:1rem;font-weight:600;line-height:1.3;margin-top:1.1em;margin-bottom:0.5em;',
  4: 'font-size:0.875rem;font-weight:600;line-height:1.3;margin-top:1.1em;margin-bottom:0.5em;',
  5: 'font-size:0.75rem;font-weight:600;line-height:1.3;margin-top:1.1em;margin-bottom:0.5em;',
  6: 'font-size:0.75rem;font-weight:500;line-height:1.3;margin-top:1.1em;margin-bottom:0.5em;'
}

function inferRequirementHeadingLevel(title: string): number | null {
  const normalizedTitle = title.trim()
  const match = normalizedTitle.match(/^(\d+(?:\.\d+)+)\b/)
  if (!match || !match[1]) return null

  const segments = match[1].split('.').length
  return Math.min(6, Math.max(3, segments + 1))
}

function normalizeGeneratedRequirementMarkdown(markdown: string): string {
  if (!markdown.includes('## 需求来源') || !markdown.includes('## 需求内容')) {
    return markdown
  }

  const lines = markdown.split('\n')
  let inRequirementContent = false

  return lines.map((line) => {
    if (/^##\s+需求内容\s*$/.test(line.trim())) {
      inRequirementContent = true
      return line
    }

    if (!inRequirementContent) return line

    const headingMatch = line.match(/^(#{2,6})\s+(.+?)\s*$/)
    if (!headingMatch) return line

    const title = headingMatch[2] ?? ''
    const inferredLevel = inferRequirementHeadingLevel(title)
    if (!inferredLevel) return line

    return `${'#'.repeat(inferredLevel)} ${title}`
  }).join('\n')
}

function applyMarkdownHeadingStyles(html: string): string {
  return html.replace(/<h([1-6])>/g, (_, levelText: string) => {
    const level = Number(levelText)
    const style = markdownHeadingStyleMap[level] || markdownHeadingStyleMap[6]
    return `<h${level} style="${style}">`
  })
}

const renderedHtml = computed(() => {
  if (!props.markdown) return ''
  try {
    const normalizedMarkdown = normalizeGeneratedRequirementMarkdown(props.markdown)
    return applyMarkdownHeadingStyles(renderSafeMarkdown(normalizedMarkdown))
  } catch {
    return ''
  }
})
</script>

<template>
  <!-- Markdown is rendered through safeMarkdown before injection. -->
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div class="chapter-md-content max-w-none" v-html="renderedHtml" />
</template>
