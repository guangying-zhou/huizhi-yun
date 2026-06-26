import { Marked, Renderer } from 'marked'
import type { Tokens } from 'marked'

const linkProtocols = new Set(['http:', 'https:', 'mailto:', 'tel:'])
const resourceProtocols = new Set(['http:', 'https:'])

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '\'': '&#39;'
  })[char] || char)
}

function isRelativeUrl(value: string): boolean {
  return value.startsWith('#') || value.startsWith('/') || value.startsWith('./') || value.startsWith('../')
}

function safeUrl(value: string, protocols: Set<string>): string {
  const trimmed = value.trim()
  if (!trimmed) return '#'
  if (isRelativeUrl(trimmed)) return escapeHtml(trimmed)

  try {
    const parsed = new URL(trimmed)
    if (protocols.has(parsed.protocol)) return escapeHtml(trimmed)
  } catch {
    return '#'
  }

  return '#'
}

const renderer = new Renderer()

renderer.html = ({ text }: Tokens.HTML | Tokens.Tag) => escapeHtml(text)

renderer.link = function ({ href, title, tokens }: Tokens.Link) {
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : ''
  return `<a href="${safeUrl(href, linkProtocols)}"${titleAttr}>${this.parser.parseInline(tokens)}</a>`
}

renderer.image = ({ href, title, text }: Tokens.Image) => {
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : ''
  return `<img src="${safeUrl(href, resourceProtocols)}" alt="${escapeHtml(text || '')}"${titleAttr}>`
}

const safeMarked = new Marked({ renderer })

export function renderSafeMarkdown(markdown: string): string {
  const html = safeMarked.parse(markdown)
  return typeof html === 'string' ? html : ''
}

export { escapeHtml, safeUrl }
