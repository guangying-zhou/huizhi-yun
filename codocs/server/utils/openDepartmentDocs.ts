import type { H3Event } from 'h3'
import { createError } from 'h3'
import { fetchDirectoryData } from '~~/server/utils/directoryCompat'
import { callCodocsTenantRuntime, type CodocsDocumentMetadata } from '~~/server/utils/codocsRuntime'
import { compareOpenDepartmentFolderNames, normalizeOpenDepartmentFolderId, openDepartmentVisibleFolderMap } from '~~/server/utils/openDepartmentTree'
import type { DepartmentResponse } from '~/types/account'

export interface OpenDepartmentFolderRow {
  id: number
  name: string
  folder_type?: string
  dept_code?: string | null
  parent_id?: number | null
  sort_order?: number | null
  is_open?: number | boolean | null
  created_at?: string
  updated_at?: string
}

export interface OpenDepartmentDocumentRow {
  uuid: string
  title: string
  doc_type?: string
  owner_uid?: string
  dept_code?: string | null
  folder_id?: number | null
  content_size?: number | null
  readonly_flag?: number | null
  publish_info?: string | null
  ai_abstract?: string | null
  updated_at?: string
}

export interface OpenDepartmentFolderNode extends OpenDepartmentFolderRow {
  children: OpenDepartmentFolderNode[]
  documents: OpenDepartmentDocumentRow[]
}

export interface OpenDepartmentGroup {
  deptCode: string
  deptName: string
  documentCount: number
  folders: OpenDepartmentFolderNode[]
}

interface OpenDepartmentRuntimeResult {
  folders?: OpenDepartmentFolderRow[]
  documents?: CodocsDocumentMetadata[]
}

function normalizeId(value: unknown) {
  return normalizeOpenDepartmentFolderId(value)
}

function sortFolders(a: OpenDepartmentFolderNode, b: OpenDepartmentFolderNode) {
  return compareOpenDepartmentFolderNames(a, b)
}

function sortDocuments(a: OpenDepartmentDocumentRow, b: OpenDepartmentDocumentRow) {
  const timeA = a.updated_at ? new Date(a.updated_at).getTime() : 0
  const timeB = b.updated_at ? new Date(b.updated_at).getTime() : 0
  if (timeA !== timeB) return timeB - timeA
  return String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hans-CN')
}

async function departmentNameMap(event: H3Event) {
  try {
    const response = await fetchDirectoryData<DepartmentResponse>('/departments', { event, timeout: 5000 })
    return new Map((response.flat || []).map(dept => [String(dept.deptCode), dept.name || String(dept.deptCode)]))
  } catch (error) {
    console.warn('[OpenDepartmentDocs] Failed to load department names:', error)
    return new Map<string, string>()
  }
}

export async function loadOpenDepartmentDocs(event: H3Event): Promise<OpenDepartmentGroup[]> {
  const runtime = await callCodocsTenantRuntime<OpenDepartmentRuntimeResult>(event, '/v1/codocs/open-department-documents', {
    scope: 'codocs.read'
  })
  const folders = (runtime.folders || [])
    .map(folder => ({ ...folder, id: normalizeId(folder.id), parent_id: normalizeId(folder.parent_id) || null }))
    .filter(folder => folder.id > 0 && folder.dept_code)

  const visibleFolders = openDepartmentVisibleFolderMap(folders)
  if (visibleFolders.size === 0) return []

  const documents = (runtime.documents || [])
    .filter(doc => visibleFolders.has(normalizeId(doc.folder_id)))
    .sort(sortDocuments)

  const docsByFolder = new Map<number, OpenDepartmentDocumentRow[]>()
  const documentCountsByDept = new Map<string, number>()
  for (const doc of documents) {
    const folderId = normalizeId(doc.folder_id)
    const deptCode = String(visibleFolders.get(folderId)?.dept_code || '')
    if (deptCode) {
      documentCountsByDept.set(deptCode, (documentCountsByDept.get(deptCode) || 0) + 1)
    }
    const list = docsByFolder.get(folderId) || []
    list.push(doc)
    docsByFolder.set(folderId, list)
  }

  const nodes = new Map<number, OpenDepartmentFolderNode>()
  for (const folder of folders) {
    if (!visibleFolders.has(folder.id)) continue
    nodes.set(folder.id, {
      ...folder,
      children: [],
      documents: docsByFolder.get(folder.id) || []
    })
  }

  const rootsByDept = new Map<string, OpenDepartmentFolderNode[]>()
  for (const node of nodes.values()) {
    const parentId = normalizeId(node.parent_id)
    const parent = parentId ? nodes.get(parentId) : null
    if (parent) {
      parent.children.push(node)
      continue
    }

    const deptCode = String(node.dept_code || '')
    const roots = rootsByDept.get(deptCode) || []
    roots.push(node)
    rootsByDept.set(deptCode, roots)
  }

  for (const node of nodes.values()) {
    node.children.sort(sortFolders)
    node.documents.sort(sortDocuments)
  }

  const names = await departmentNameMap(event)
  return [...rootsByDept.entries()]
    .map(([deptCode, roots]) => ({
      deptCode,
      deptName: names.get(deptCode) || deptCode,
      folders: roots.sort(sortFolders),
      documentCount: documentCountsByDept.get(deptCode) || 0
    }))
    .sort((a, b) => a.deptName.localeCompare(b.deptName, 'zh-Hans-CN'))
}

export async function requireOpenDepartmentDocument(event: H3Event, uuid: string): Promise<CodocsDocumentMetadata> {
  const runtime = await callCodocsTenantRuntime<OpenDepartmentRuntimeResult>(event, '/v1/codocs/open-department-documents', {
    query: { uuid },
    scope: 'codocs.read'
  })
  const doc = (runtime.documents || []).find(item => item.uuid === uuid)
  if (!doc || doc.doc_type !== 'department' || !doc.folder_id) {
    throw createError({ statusCode: 403, message: '该文档不在开放目录内' })
  }

  const visibleFolders = openDepartmentVisibleFolderMap((runtime.folders || []).map(folder => ({
    ...folder,
    id: normalizeId(folder.id),
    parent_id: normalizeId(folder.parent_id) || null
  })))

  if (!visibleFolders.has(normalizeId(doc.folder_id))) {
    throw createError({ statusCode: 403, message: '该文档不在开放目录内' })
  }

  return doc
}
