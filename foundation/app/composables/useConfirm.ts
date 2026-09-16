import ConfirmDialog from '../components/ConfirmDialog.vue'

export type ConfirmTone = 'default' | 'danger' | 'warning'
export type ConfirmColor = 'primary' | 'error' | 'warning' | 'success' | 'info' | 'neutral'

export interface ConfirmOptions {
  /** 弹窗标题 */
  title?: string
  /** 正文说明；支持 \n 换行 */
  message?: string
  /** 确认按钮文案；不传时按 tone 推断（danger 为「删除」，其余为「确认」） */
  confirmLabel?: string
  /** 取消按钮文案，默认「取消」 */
  cancelLabel?: string
  /** 语义色调；danger 用于删除等不可逆操作，warning 用于停用/移除等需谨慎操作 */
  tone?: ConfirmTone
  /** 直接指定确认按钮颜色，优先级高于 tone */
  color?: ConfirmColor
  /** 直接指定前置图标，优先级高于 tone */
  icon?: string
}

interface TonePreset {
  color: ConfirmColor
  icon: string
  confirmLabel: string
}

function resolveTone(tone: ConfirmTone): TonePreset {
  switch (tone) {
    case 'danger':
      return { color: 'error', icon: 'i-lucide-trash-2', confirmLabel: '删除' }
    case 'warning':
      return { color: 'warning', icon: 'i-lucide-triangle-alert', confirmLabel: '确认' }
    default:
      return { color: 'primary', icon: '', confirmLabel: '确认' }
  }
}

/**
 * 统一的确认弹窗，替代浏览器原生 confirm()。
 * 基于 Nuxt UI 的 useOverlay + ConfirmDialog 组件，返回用户是否确认的 Promise。
 *
 * @example
 * const { confirm } = useConfirm()
 * if (!(await confirm({ title: '删除客户', message: `确定删除「${name}」？`, tone: 'danger' }))) return
 */
export function useConfirm() {
  const overlay = useOverlay()

  async function confirm(options: ConfirmOptions = {}): Promise<boolean> {
    const preset = resolveTone(options.tone ?? 'default')

    const modal = overlay.create(ConfirmDialog, {
      props: {
        title: options.title ?? '确认操作',
        message: options.message ?? '',
        confirmLabel: options.confirmLabel ?? preset.confirmLabel,
        cancelLabel: options.cancelLabel ?? '取消',
        color: options.color ?? preset.color,
        icon: options.icon ?? preset.icon
      },
      destroyOnClose: true
    })

    const instance = modal.open()
    const result = await instance.result
    return result === true
  }

  return { confirm }
}
