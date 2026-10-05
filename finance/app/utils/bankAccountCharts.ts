function formatChartDate(value: unknown) {
  const text = String(value || '')
  return text ? text.slice(0, 10) : '-'
}

export interface BalanceSnapshotRow extends Record<string, unknown> {
  id: number
  snapshot_date: string
  balance_amount: string
  currency_code: string
  source_type: string
  created_by: string | null
  created_at: string
}

export interface BalanceChangeRow extends Record<string, unknown> {
  balance_date: string
  previous_total_balance: string
  change_amount: string
  total_balance: string
  direction: 'increase' | 'decrease' | 'flat'
}

export interface BalanceChangeSummary {
  opening_balance: string
  closing_balance: string
  net_change: string
}

export function formatPlainMoney(value: unknown) {
  const numberValue = Number(value || 0)
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number.isFinite(numberValue) ? numberValue : 0)
}

export function formatSignedMoney(value: unknown) {
  const numberValue = Number(value || 0)
  const formatted = formatPlainMoney(Math.abs(Number.isFinite(numberValue) ? numberValue : 0))
  if (numberValue > 0) return `+${formatted}`
  if (numberValue < 0) return `-${formatted}`
  return formatted
}

export function formatAxisMoney(value: unknown) {
  const numberValue = Number(value || 0)
  const safeValue = Number.isFinite(numberValue) ? numberValue : 0
  const sign = safeValue < 0 ? '-' : ''
  const absoluteValue = Math.abs(safeValue)
  if (absoluteValue >= 100000000) return `${sign}${(absoluteValue / 100000000).toFixed(1)}亿`
  if (absoluteValue >= 10000) return `${sign}${(absoluteValue / 10000).toFixed(0)}万`
  return `${sign}${absoluteValue.toFixed(0)}`
}

export function buildBalanceChart(items: BalanceSnapshotRow[]) {
  const values = items
    .map((item, index) => ({
      index,
      date: formatChartDate(item.snapshot_date),
      amount: Number(item.balance_amount || 0)
    }))
    .filter(item => Number.isFinite(item.amount))

  if (!values.length) {
    return {
      points: '',
      areaPoints: '',
      labels: [] as Array<{ x: number, date: string, amount: number }>,
      min: 0,
      max: 0,
      latest: null as null | { date: string, amount: number }
    }
  }

  const width = 640
  const height = 220
  const paddingX = 28
  const paddingY = 24
  const min = Math.min(...values.map(item => item.amount))
  const max = Math.max(...values.map(item => item.amount))
  const span = max - min || 1
  const denominator = Math.max(values.length - 1, 1)
  const points = values.map((item, index) => {
    const x = paddingX + (index / denominator) * (width - paddingX * 2)
    const y = height - paddingY - ((item.amount - min) / span) * (height - paddingY * 2)
    return { x, y, date: item.date, amount: item.amount }
  })
  const pointText = points.map(point => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')
  const areaPoints = [
    `${paddingX},${height - paddingY}`,
    pointText,
    `${width - paddingX},${height - paddingY}`
  ].join(' ')
  const labelIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])]

  return {
    points: pointText,
    areaPoints,
    labels: labelIndexes.map(index => ({
      x: points[index]?.x || paddingX,
      date: values[index]?.date || '',
      amount: values[index]?.amount || 0
    })),
    min,
    max,
    latest: values[values.length - 1] || null
  }
}

export function buildWaterfallChart(items: BalanceChangeRow[], chartWidthValue: number) {
  const values = items
    .map((item, index) => ({
      index,
      date: formatChartDate(item.balance_date),
      previous: Number(item.previous_total_balance || 0),
      change: Number(item.change_amount || 0),
      total: Number(item.total_balance || 0),
      direction: item.direction
    }))
    .filter(item => Number.isFinite(item.previous) && Number.isFinite(item.change) && Number.isFinite(item.total))

  if (!values.length) {
    return {
      bars: [] as Array<{
        x: number
        y: number
        width: number
        height: number
        date: string
        change: number
        total: number
        direction: 'increase' | 'decrease' | 'flat'
        connectorX1: number
        connectorY1: number
        connectorX2: number
        connectorY2: number
        showValueLabel: boolean
      }>,
      labels: [] as Array<{ x: number, date: string }>,
      yTicks: [] as Array<{ y: number, amount: number }>,
      width: 760,
      height: 300,
      zeroY: 0,
      axisLeft: 0,
      axisRight: 0,
      axisTop: 0,
      axisBottom: 0,
      min: 0,
      max: 0
    }
  }

  const width = Math.max(760, Math.round(chartWidthValue || 1200))
  const height = 300
  const paddingLeft = 84
  const paddingRight = 18
  const paddingTop = 24
  const paddingBottom = 42
  const min = Math.min(0, ...values.map(item => Math.min(item.previous, item.total)))
  const max = Math.max(0, ...values.map(item => Math.max(item.previous, item.total)))
  const span = max - min || 1
  const chartWidth = width - paddingLeft - paddingRight
  const chartHeight = height - paddingTop - paddingBottom
  const step = chartWidth / values.length
  const barWidth = Math.max(16, Math.min(46, step * 0.48))
  const scaleY = (amount: number) => height - paddingBottom - ((amount - min) / span) * chartHeight
  const labelIndexes = values.length <= 6
    ? values.map((_, index) => index)
    : [...new Set([0, Math.floor((values.length - 1) / 2), values.length - 1])]
  const significantLabelIndexes = new Set([
    ...labelIndexes,
    ...values
      .map((item, index) => ({ index, amount: Math.abs(item.change) }))
      .sort((left, right) => right.amount - left.amount)
      .slice(0, values.length > 30 ? 6 : 10)
      .map(item => item.index)
  ])

  const bars = values.map((item, index) => {
    const x = paddingLeft + index * step + (step - barWidth) / 2
    const previousY = scaleY(item.previous)
    const totalY = scaleY(item.total)
    return {
      x,
      y: Math.min(previousY, totalY),
      width: barWidth,
      height: Math.max(Math.abs(previousY - totalY), 2),
      date: item.date,
      change: item.change,
      total: item.total,
      direction: item.direction,
      connectorX1: x + barWidth,
      connectorY1: totalY,
      connectorX2: paddingLeft + (index + 1) * step + (step - barWidth) / 2,
      connectorY2: totalY,
      showValueLabel: values.length <= 18 || significantLabelIndexes.has(index)
    }
  })
  const yTickAmounts = Array.from({ length: 5 }, (_, index) => min + (span / 4) * index)

  return {
    bars,
    labels: labelIndexes.map(index => ({
      x: (bars[index]?.x ?? paddingLeft) + barWidth / 2,
      date: values[index]?.date || ''
    })),
    yTicks: yTickAmounts.map(amount => ({
      y: scaleY(amount),
      amount
    })),
    width,
    height,
    zeroY: scaleY(0),
    axisLeft: paddingLeft,
    axisRight: width - paddingRight,
    axisTop: paddingTop,
    axisBottom: height - paddingBottom,
    min,
    max
  }
}
