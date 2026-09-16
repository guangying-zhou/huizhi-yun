export type ScanStatus = 'idle' | 'running' | 'success' | 'failed'

export const useScanStatus = () => {
  function scanStatusColor(status: ScanStatus) {
    if (status === 'success') return 'success'
    if (status === 'failed') return 'error'
    if (status === 'running') return 'warning'
    return 'neutral'
  }

  function scanStatusLabel(status: ScanStatus) {
    if (status === 'success') return '已完成'
    if (status === 'failed') return '失败'
    if (status === 'running') return '进行中'
    return '未开始'
  }

  return {
    scanStatusColor,
    scanStatusLabel
  }
}
