import { createError } from 'h3'
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise'
import { execute, queryRow, queryRows } from './db'

const TENANT_SCOPE = '__tenant__'

interface SettingCatalogRow extends RowDataPacket {
  settingKey: string
  settingName: string
  valueType: string
  scopeType: string
  category: string
  defaultValueJson: string | unknown | null
  validatorJson: string | unknown | null
  isRequired: number
  editableInUi: number
  description: string | null
  status: string
  updatedAt: string
}

interface SettingValueRow extends RowDataPacket {
  settingKey: string
  scopeKey: string
  valueJson: string | unknown | null
  source: string
  updatedBy: string | null
  updatedAt: string
}

export interface SettingCatalogItem {
  settingKey: string
  settingName: string
  valueType: string
  scopeType: string
  category: string
  defaultValue: unknown
  validator: Record<string, unknown> | null
  isRequired: boolean
  editableInUi: boolean
  description: string | null
  status: string
  updatedAt: string
}

export interface SettingValueItem {
  settingKey: string
  settingName: string
  valueType: string
  category: string
  scopeKey: string
  value: unknown
  defaultValue: unknown
  source: string
  hasCustomValue: boolean
  editableInUi: boolean
  description: string | null
  updatedBy: string | null
  updatedAt: string | null
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

function parseJsonValue(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function parseJsonObject(value: unknown) {
  const parsed = parseJsonValue(value)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null
}

function mapCatalog(row: SettingCatalogRow): SettingCatalogItem {
  return {
    settingKey: row.settingKey,
    settingName: row.settingName,
    valueType: row.valueType,
    scopeType: row.scopeType,
    category: row.category,
    defaultValue: parseJsonValue(row.defaultValueJson),
    validator: parseJsonObject(row.validatorJson),
    isRequired: Boolean(row.isRequired),
    editableInUi: Boolean(row.editableInUi),
    description: row.description,
    status: row.status,
    updatedAt: row.updatedAt
  }
}

function assertSettingKey(settingKey: unknown) {
  const key = stringValue(settingKey)
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/i.test(key) || key.length > 128) {
    throw createError({ statusCode: 400, message: 'invalid settingKey' })
  }
  return key
}

function assertScopeKey(scopeKey: unknown) {
  const key = stringValue(scopeKey) || TENANT_SCOPE
  if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(key)) {
    throw createError({ statusCode: 400, message: 'invalid scopeKey' })
  }
  return key
}

function normalizeValue(valueType: string, value: unknown) {
  if (value === undefined) {
    throw createError({ statusCode: 400, message: 'value is required' })
  }

  switch (valueType) {
    case 'boolean':
      if (typeof value === 'boolean') return value
      if (value === 'true') return true
      if (value === 'false') return false
      throw createError({ statusCode: 400, message: 'value must be a boolean' })
    case 'number': {
      const numberValue = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(numberValue)) {
        throw createError({ statusCode: 400, message: 'value must be a number' })
      }
      return numberValue
    }
    case 'json':
      return value
    case 'url':
      if (typeof value !== 'string') {
        throw createError({ statusCode: 400, message: 'value must be a URL string' })
      }
      if (value.trim()) {
        try {
          const url = new URL(value)
          if (!['http:', 'https:'].includes(url.protocol)) {
            throw new Error('unsupported protocol')
          }
        } catch {
          throw createError({ statusCode: 400, message: 'value must be a valid http(s) URL' })
        }
      }
      return value.trim()
    case 'string':
    default:
      return typeof value === 'string' ? value : String(value ?? '')
  }
}

function assertValidatorRules(catalog: SettingCatalogItem, value: unknown) {
  if (catalog.isRequired && (value === null || value === undefined || value === '')) {
    throw createError({ statusCode: 400, message: `${catalog.settingKey} is required` })
  }

  const validator = catalog.validator
  if (!validator) return

  const allowedValues = Array.isArray(validator.allowedValues) ? validator.allowedValues : null
  if (allowedValues && !allowedValues.includes(value)) {
    throw createError({ statusCode: 400, message: `${catalog.settingKey} is not an allowed value` })
  }

  if (typeof value === 'string') {
    const minLength = Number(validator.minLength)
    const maxLength = Number(validator.maxLength)
    const pattern = stringValue(validator.pattern)
    if (Number.isFinite(minLength) && minLength > 0 && value.length < minLength) {
      throw createError({ statusCode: 400, message: `${catalog.settingKey} is too short` })
    }
    if (Number.isFinite(maxLength) && maxLength > 0 && value.length > maxLength) {
      throw createError({ statusCode: 400, message: `${catalog.settingKey} is too long` })
    }
    if (pattern && !(new RegExp(pattern).test(value))) {
      throw createError({ statusCode: 400, message: `${catalog.settingKey} does not match validator pattern` })
    }
  }

  if (typeof value === 'number') {
    const min = Number(validator.min)
    const max = Number(validator.max)
    if (Number.isFinite(min) && value < min) {
      throw createError({ statusCode: 400, message: `${catalog.settingKey} is below minimum` })
    }
    if (Number.isFinite(max) && value > max) {
      throw createError({ statusCode: 400, message: `${catalog.settingKey} is above maximum` })
    }
  }
}

async function loadCatalog(settingKey: string) {
  const row = await queryRow<SettingCatalogRow>(
    `SELECT setting_key AS settingKey,
            setting_name AS settingName,
            value_type AS valueType,
            scope_type AS scopeType,
            category,
            default_value_json AS defaultValueJson,
            validator_json AS validatorJson,
            is_required AS isRequired,
            editable_in_ui AS editableInUi,
            description,
            status,
            updated_at AS updatedAt
       FROM setting_catalogs
      WHERE setting_key = ?
      LIMIT 1`,
    [settingKey]
  )
  return row ? mapCatalog(row) : null
}

export async function listSettingCatalogs(query: Record<string, unknown> = {}) {
  const category = stringValue(query.category)
  const status = stringValue(query.status || 'active')
  const search = stringValue(query.search)
  const conditions: string[] = []
  const params: unknown[] = []

  if (category) {
    conditions.push('category = ?')
    params.push(category)
  }
  if (status) {
    conditions.push('status = ?')
    params.push(status)
  }
  if (search) {
    conditions.push('(setting_key LIKE ? OR setting_name LIKE ? OR description LIKE ?)')
    params.push(`%${search}%`, `%${search}%`, `%${search}%`)
  }

  const rows = await queryRows<SettingCatalogRow[]>(
    `SELECT setting_key AS settingKey,
            setting_name AS settingName,
            value_type AS valueType,
            scope_type AS scopeType,
            category,
            default_value_json AS defaultValueJson,
            validator_json AS validatorJson,
            is_required AS isRequired,
            editable_in_ui AS editableInUi,
            description,
            status,
            updated_at AS updatedAt
       FROM setting_catalogs
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY category, setting_key`,
    params
  )

  return { items: rows.map(mapCatalog) }
}

export async function listSettingValues(query: Record<string, unknown> = {}) {
  const keys = stringValue(query.keys)
    .split(',')
    .map(key => key.trim())
    .filter(Boolean)
    .map(assertSettingKey)
  const scopeKey = assertScopeKey(query.scopeKey)
  const category = stringValue(query.category)

  const conditions = ['c.status = ?']
  const params: unknown[] = [stringValue(query.status || 'active')]
  if (keys.length) {
    conditions.push(`c.setting_key IN (${keys.map(() => '?').join(',')})`)
    params.push(...keys)
  }
  if (category) {
    conditions.push('c.category = ?')
    params.push(category)
  }

  const rows = await queryRows<(SettingCatalogRow & Partial<SettingValueRow>)[]>(
    `SELECT c.setting_key AS settingKey,
            c.setting_name AS settingName,
            c.value_type AS valueType,
            c.scope_type AS scopeType,
            c.category,
            c.default_value_json AS defaultValueJson,
            c.validator_json AS validatorJson,
            c.is_required AS isRequired,
            c.editable_in_ui AS editableInUi,
            c.description,
            c.status,
            c.updated_at AS updatedAt,
            v.scope_key AS scopeKey,
            v.value_json AS valueJson,
            v.source,
            v.updated_by AS updatedBy,
            v.updated_at AS valueUpdatedAt
       FROM setting_catalogs c
       LEFT JOIN setting_values v
         ON v.setting_key = c.setting_key
        AND v.scope_key = ?
      WHERE ${conditions.join(' AND ')}
      ORDER BY c.category, c.setting_key`,
    [scopeKey, ...params]
  )

  const items: SettingValueItem[] = rows.map((row) => {
    const catalog = mapCatalog(row)
    const hasCustomValue = row.valueJson !== null && row.valueJson !== undefined
    return {
      settingKey: catalog.settingKey,
      settingName: catalog.settingName,
      valueType: catalog.valueType,
      category: catalog.category,
      scopeKey,
      value: hasCustomValue ? parseJsonValue(row.valueJson) : catalog.defaultValue,
      defaultValue: catalog.defaultValue,
      source: row.source || 'default',
      hasCustomValue,
      editableInUi: catalog.editableInUi,
      description: catalog.description,
      updatedBy: row.updatedBy || null,
      updatedAt: (row as { valueUpdatedAt?: string | null }).valueUpdatedAt || null
    }
  })

  return { items }
}

export async function updateSettingValue(input: {
  settingKey: unknown
  scopeKey?: unknown
  value: unknown
  updatedBy?: string | null
}) {
  const settingKey = assertSettingKey(input.settingKey)
  const scopeKey = assertScopeKey(input.scopeKey)
  const catalog = await loadCatalog(settingKey)
  if (!catalog || catalog.status !== 'active') {
    throw createError({ statusCode: 404, message: 'setting not found' })
  }
  if (!catalog.editableInUi) {
    throw createError({ statusCode: 403, message: 'setting is not editable' })
  }

  const normalized = normalizeValue(catalog.valueType, input.value)
  assertValidatorRules(catalog, normalized)

  await execute<ResultSetHeader>(
    `INSERT INTO setting_values (
       setting_key,
       scope_key,
       value_json,
       source,
       updated_by,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, 'custom', ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE
       value_json = VALUES(value_json),
       source = 'custom',
       updated_by = VALUES(updated_by),
       updated_at = UTC_TIMESTAMP()`,
    [settingKey, scopeKey, JSON.stringify(normalized), input.updatedBy || null]
  )

  const values = await listSettingValues({ keys: settingKey, scopeKey })
  return values.items[0]
}

export async function getSystemParameter(key: string): Promise<string | null> {
  const result = await listSettingValues({ keys: key })
  const value = result.items[0]?.value
  if (value === undefined || value === null) return null
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export async function getSystemParameters(keys: string[]): Promise<Record<string, string>> {
  if (!keys.length) return {}
  const result = await listSettingValues({ keys: keys.join(',') })
  return result.items.reduce<Record<string, string>>((acc, item) => {
    if (item.value !== undefined && item.value !== null) {
      acc[item.settingKey] = typeof item.value === 'string' ? item.value : JSON.stringify(item.value)
    }
    return acc
  }, {})
}

export async function setSystemParameter(key: string, value: string): Promise<void> {
  await updateSettingValue({ settingKey: key, value })
}
