import { financeApiPath } from './useFinanceApi'

export function useFinanceReportExport(canExport: Readonly<Ref<boolean>>) {
  const toast = useToast()
  const exporting = ref(false)

  async function download() {
    if (!canExport.value || exporting.value) return
    exporting.value = true
    try {
      const blob = await $fetch<Blob>(financeApiPath('/reports/export'), { responseType: 'blob' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `finance-monthly-report-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      toast.add({ title: '已开始导出', description: '财务报表 CSV 正在下载。', color: 'success' })
    } catch (error) {
      toast.add({
        title: '导出失败',
        description: error instanceof Error ? error.message : '请确认是否拥有报表导出权限。',
        color: 'error'
      })
    } finally {
      exporting.value = false
    }
  }

  return { exporting, download }
}
