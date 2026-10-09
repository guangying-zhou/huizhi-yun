import MarkdownIt from 'markdown-it'
// Raw HTML and remote images are deliberately disabled for tenant-authored text.
const renderer = new MarkdownIt({ html: false, linkify: false, typographer: false })
renderer.disable('image')
export function renderSafeMarkdown(value: string) {
  return renderer.render(value)
}
