/**
 * 解析 MDC (Markdown Components) 语法中的样式标记
 * 例如: "[text]{.class}" 转换为 "<span class='class'>text</span>"
 */
export function parseMDCText(text: string): string {
  if (!text) return text
  
  // 匹配 [内容]{.样式类} 格式
  const mdcPattern = /\[([^\]]+)\]\{\.([^}]+)\}/g
  
  return text.replace(mdcPattern, (match, content, className) => {
    return `<span class="${className}">${content}</span>`
  })
}

/**
 * 用于在 Vue 模板中安全地渲染解析后的 HTML
 */
export function renderMDCText(text: string) {
  return parseMDCText(text)
}

/**
 * Clean text from MDC syntax for use in page titles and meta tags
 * 例如: "[text]{.class}" 转换为 "text"
 */
export function cleanMDCText(text: string): string {
  if (!text) return text

  // 匹配 [内容]{.样式类} 格式，只保留内容
  const mdcPattern = /\[([^\]]+)\]\{\.([^}]+)\}/g

  return text.replace(mdcPattern, (match, content, className) => {
    return content
  })
}