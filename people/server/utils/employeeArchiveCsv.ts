import { createError } from 'h3'

export const EMPLOYEE_ARCHIVE_MAX_BYTES = 2 * 1024 * 1024
export const EMPLOYEE_ARCHIVE_MAX_ROWS = 1000

function csvError(message: string) {
  return createError({ statusCode: 400, message })
}

function parseCsvRecords(input: string) {
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let quoted = false

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          value += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        value += char
      }
      continue
    }
    if (char === '"' && value === '') {
      quoted = true
    } else if (char === ',') {
      row.push(value)
      value = ''
    } else if (char === '\n') {
      row.push(value.replace(/\r$/, ''))
      rows.push(row)
      row = []
      value = ''
    } else {
      value += char
    }
  }
  if (quoted) throw csvError('CSV 包含未闭合的引号。')
  if (value !== '' || row.length > 0) {
    row.push(value.replace(/\r$/, ''))
    rows.push(row)
  }
  return rows.filter(item => item.some(cell => cell.trim() !== ''))
}

function cleanSourceValue(value: unknown) {
  const result = String(value ?? '').trim()
  return result.toUpperCase() === 'NULL' ? '' : result
}

function dateValue(value: unknown) {
  return cleanSourceValue(value).slice(0, 10)
}

function mobileValue(value: unknown) {
  return cleanSourceValue(value).replace(/\D/g, '')
}

export interface EmployeeArchiveImportItem {
  row_number: number
  name: string
  ding_id?: string
  mobile?: string
  hire_date?: string
  source_biz_id?: string
  source_updated_at?: string
  id_number?: string
  birth_date?: string
  education_level?: string
  major?: string
  graduation_school?: string
  graduation_date?: string
}

export function parseEmployeeArchiveCsv(input: string): EmployeeArchiveImportItem[] {
  const records = parseCsvRecords(input.replace(/^\uFEFF/, ''))
  if (records.length < 2) throw csvError('CSV 没有可导入的员工数据。')
  const headers = records[0]!.map(header => cleanSourceValue(header))
  const headerIndexes = new Map(headers.map((header, index) => [header, index]))
  for (const required of ['employee_id', 'name']) {
    if (!headerIndexes.has(required)) throw csvError(`CSV 缺少必需列：${required}`)
  }
  const sourceRows = records.slice(1)
  if (sourceRows.length > EMPLOYEE_ARCHIVE_MAX_ROWS) {
    throw createError({ statusCode: 413, message: `单次最多导入 ${EMPLOYEE_ARCHIVE_MAX_ROWS} 行。` })
  }

  const get = (row: string[], key: string) => cleanSourceValue(row[headerIndexes.get(key) ?? -1])
  return sourceRows.map((row, index) => {
    const name = get(row, 'name')
    if (!name) throw csvError(`第 ${index + 2} 行缺少姓名。`)
    const item: EmployeeArchiveImportItem = {
      row_number: index + 2,
      name,
      ding_id: get(row, 'ding_id') || undefined,
      mobile: mobileValue(get(row, 'mobile_number')) || undefined,
      hire_date: dateValue(get(row, 'hiredate')) || undefined,
      source_biz_id: get(row, 'employee_id') || undefined,
      source_updated_at: get(row, 'operate_time') || undefined,
      id_number: get(row, 'id_number') || undefined,
      birth_date: dateValue(get(row, 'date_of_birth')) || undefined,
      // 旧 OA 仅保存 0/1/2 代码，不能在没有字典依据时猜测成人类标签。
      education_level: get(row, 'education') || undefined,
      major: get(row, 'major') || undefined,
      graduation_school: get(row, 'school') || undefined,
      graduation_date: dateValue(get(row, 'graduation')) || undefined
    }
    return Object.fromEntries(Object.entries(item).filter(([, value]) => value !== undefined)) as unknown as EmployeeArchiveImportItem
  })
}
