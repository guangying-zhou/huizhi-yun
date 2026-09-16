export interface LayoutHeaderAction {
  key: string
  icon?: string
  label?: string
  ariaLabel?: string
  title?: string
  color?: 'error' | 'info' | 'success' | 'primary' | 'secondary' | 'warning' | 'neutral'
  variant?: 'link' | 'solid' | 'outline' | 'soft' | 'subtle' | 'ghost'
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  square?: boolean
  class?: string
  show?: boolean
  onClick: () => void
}

const headerActions = ref<LayoutHeaderAction[]>([])

export function useLayoutHeaderActions() {
  function setHeaderActions(actions: LayoutHeaderAction[]) {
    headerActions.value = actions
  }

  function clearHeaderActions() {
    headerActions.value = []
  }

  return {
    headerActions,
    setHeaderActions,
    clearHeaderActions
  }
}
