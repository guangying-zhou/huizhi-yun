/**
 * 编辑器主题管理 Composable
 *
 * 管理 Milkdown 编辑器主题设置，并持久化到 Cookie
 */

export type EditorTheme = 'frame' | 'classic' | 'nord'

export function useEditorTheme() {
  // 从 cookie 读取编辑器主题，默认为 'frame'
  const editorTheme = useCookie<EditorTheme>('editor-theme', {
    default: () => 'frame',
    maxAge: 60 * 60 * 24 * 365, // 1 年
    sameSite: 'lax',
    path: '/'
  })

  const setEditorTheme = (theme: EditorTheme) => {
    editorTheme.value = theme
  }

  return {
    editorTheme: readonly(editorTheme),
    setEditorTheme
  }
}
