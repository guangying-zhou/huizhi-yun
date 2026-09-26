import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { computed, nextTick, ref, toValue, watch } from 'vue'
import { createCreationAttempt, fingerprintUploadFiles } from '../layer/creationAttempt.mjs'

test('cabinet setup paginates, isolates sessions and retries upload/delete safely', { timeout: 10000 }, async () => {
  const source = readFileSync(new URL('../app/pages/mydocs/cabinet.vue', import.meta.url), 'utf8')
  const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1].replace(/^import .*\n/gm, '')
  const stops = []
  const user = ref('person-a')
  const tenant = ref('tenant-a')
  const calls = []
  const toasts = []
  const previewResolvers = new Map()
  let count = 41
  let malformed = false
  let malformedFolders = false
  let folderCount = 41
  let deleteFails = true
  let delayDelete = false
  let resolveDelete
  let failFirstUpload = true
  let switchUidOnUpload = false
  let switchTenantOnUpload = false
  const uploadCalls = []
  const conversionResolvers = new Map()
  let conversionMode = 'ok'
  const fetch = async (url, options) => {
    calls.push({ url, options })
    if (url.endsWith('/api/cabinet/upload')) {
      assert.equal(options.body.getAll('files').length, 1, 'each multipart request contains one file')
      const file = options.body.get('files')
      uploadCalls.push({ key: options.headers['Idempotency-Key'], file: { name: file.name, size: file.size, bytes: await file.arrayBuffer() } })
      if (switchUidOnUpload) {
        switchUidOnUpload = false
        user.value = 'person-b'
      }
      if (switchTenantOnUpload) { switchTenantOnUpload = false; tenant.value = 'tenant-b' }
      if (failFirstUpload) {
        failFirstUpload = false
        return { success: 0, failed: 1, items: [{ filename: file.name, status: 'error', message: 'temporary' }] }
      }
      return { success: 1, failed: 0, items: [{ filename: file.name, status: 'success' }] }
    }
    if (url.includes('/to-document')) {
      if (conversionMode === 'malformed') return { success: true, data: {} }
      if (conversionMode === 'pending') return new Promise(resolve => conversionResolvers.set('convert', resolve))
      if (conversionMode === 'error') throw Object.assign(new Error('conversion unavailable'), { statusCode: 503 })
      return { success: true, data: { uuid: 'doc-converted', title: options.body.title } }
    }
    if (url.includes('/converted-info')) {
      if (conversionMode === 'info-pending') return new Promise(resolve => conversionResolvers.set('info', resolve))
      if (conversionMode === 'info-error') throw Object.assign(new Error('info unavailable'), { statusCode: 503 })
      return { success: true, data: { doc_uuid: 'doc-converted', doc_title: 'Converted', doc_path: 'codocs/doc-converted.md' } }
    }
    if (options?.method === 'DELETE') {
      if (delayDelete) return new Promise(resolve => { resolveDelete = resolve })
      if (deleteFails) throw new Error('temporary delete failure')
      return { success: true, data: { deleted: true } }
    }
    if (url.endsWith('/api/folders')) {
      if (malformedFolders) return { success: true, data: {} }
      const { page, pageSize } = options.query
      const start = (page - 1) * pageSize
      return { success: true, data: { total: folderCount, page, pageSize, items: Array.from({ length: Math.max(0, Math.min(pageSize, folderCount - start)) }, (_, i) => ({ id: start + i + 1, name: `Folder ${start + i + 1}`, parent_id: null })) } }
    }
    if (url.endsWith('/preview')) return new Promise(resolve => previewResolvers.set(url, resolve))
    if (malformed) return { success: true, data: {} }
    const { page, pageSize } = options.query
    const start = (page - 1) * pageSize
    return { success: true, data: { total: count, page, pageSize, items: Array.from({ length: Math.max(0, Math.min(pageSize, count - start)) }, (_, i) => ({ uuid: `file-${start + i}`, original_name: 'file.txt', file_ext: 'txt' })) } }
  }
  const trackedWatch = (...args) => { const stop = watch(...args); stops.push(stop); return stop }
  const useAsyncData = async (_key, handler, options) => {
    const data = ref(null), pending = ref(false), error = ref(null)
    const refresh = async () => {
      pending.value = true
      try { data.value = await handler(); error.value = null } catch (e) { error.value = e } finally { pending.value = false }
    }
    await refresh()
    trackedWatch(options.watch, refresh)
    return { data, pending, error, refresh }
  }
  const env = {
    ref, computed, watch: trackedWatch, nextTick, useAsyncData, $fetch: fetch, createCreationAttempt, fingerprintUploadFiles,
    useRequestFetch: () => fetch, useAuth: () => ({ user, tenant }), toValue,
    useToast: () => ({ add(message) { toasts.push(message) } }), useCodocsModule: () => ({ moduleUrl: path => `/codocs${path}`, cacheKey: key => `${tenant.value}:${user.value}:${key}` }),
    useResizablePanel: () => ({ panelWidth: ref(260), panelCollapsed: ref(false), onResizeStart() {}, showPanel() {} }),
    useDocumentPreviewBootstrap: () => ({ setPayload() {} }), definePageMeta() {}, usePageTitle() {}, navigateTo() {}
  }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  let state
  const settle = async () => { await nextTick(); await new Promise(resolve => setImmediate(resolve)); await nextTick() }
  try {
    state = await new AsyncFunction(...Object.keys(env), stripTypeScriptTypes(script) + '\nreturn { page, files, total, error, refresh, selectFile, previewFile, previewData, previewLoading, confirmDelete, executeDelete, deleteTarget, handleFileUpload, openConvertModal, executeConvert, convertDocName, convertTargetFile, convertedInfo, folderPage, userFolders, foldersTotal, foldersError, refreshFolders, selectConvertFolder, convertFolderId, selectedFolderName };')(...Object.values(env))
    assert.equal(state.userFolders.value.length, 20)
    assert.equal(state.foldersTotal.value, 41)
    state.folderPage.value = 3
    await settle()
    assert.deepEqual(calls.filter(call => call.url.endsWith('/api/folders')).at(-1).options.query, { folder_type: 'private', owner_uid: 'person-a', page: 3, pageSize: 20 })
    assert.deepEqual(state.userFolders.value.map(folder => folder.id), [41])
    state.selectConvertFolder(state.userFolders.value[0])
    state.folderPage.value = 1
    await settle()
    assert.equal(state.convertFolderId.value, 41, 'paging does not lose the selected folder')
    assert.equal(state.selectedFolderName.value, 'Folder 41')
    malformedFolders = true
    await state.refreshFolders()
    assert.ok(state.foldersError.value, 'malformed directory response is not an empty list')
    malformedFolders = false
    await state.refreshFolders()
    assert.equal(state.foldersError.value, null)
    state.folderPage.value = 3
    await settle()
    folderCount = 40
    await state.refreshFolders()
    await settle()
    assert.equal(state.folderPage.value, 2, 'folder pagination clamps after deletion')
    tenant.value = 'tenant-folders'
    await settle()
    assert.equal(state.folderPage.value, 1)
    assert.equal(state.convertFolderId.value, null, 'tenant change clears selected directory')
    assert.equal(state.selectedFolderName.value, '根目录（我的文档）')
    assert.equal(state.files.value.length, 20)
    assert.equal(state.total.value, 41)
    state.page.value = 3
    await settle()
    assert.equal(state.files.value.length, 1)
    assert.deepEqual(calls.filter(call => call.url.endsWith('/api/cabinet')).at(-1).options.query, { owner_uid: 'person-a', page: 3, pageSize: 20 })
    count = 40
    await state.refresh()
    await settle()
    assert.equal(state.page.value, 2)
    assert.equal(state.files.value.length, 20)
    malformed = true
    await state.refresh()
    assert.ok(state.error.value)
    malformed = false
    await state.refresh()
    assert.equal(state.error.value, null)

    const a = state.selectFile({ uuid: 'a', original_name: 'A.txt', file_ext: 'txt' })
    const b = state.selectFile({ uuid: 'b', original_name: 'B.txt', file_ext: 'txt' })
    previewResolvers.get('/codocs/api/cabinet/b/preview')({ success: true, data: { content: 'B' } })
    await b
    previewResolvers.get('/codocs/api/cabinet/a/preview')({ success: true, data: { content: 'A' } })
    await a
    assert.equal(state.previewData.value.content, 'B')
    const pending = state.selectFile({ uuid: 'c', original_name: 'C.txt', file_ext: 'txt' })
    user.value = 'person-b'
    await settle()
    assert.equal(state.page.value, 1)
    assert.equal(state.previewFile.value, null)
    previewResolvers.get('/codocs/api/cabinet/c/preview')({ success: true, data: { content: 'old session' } })
    await pending
    assert.equal(state.previewData.value, null)
    assert.equal(state.previewLoading.value, false)

    const oldTenantPreview = state.selectFile({ uuid: 'old-tenant-file', original_name: 'Old.txt', file_ext: 'txt' })
    tenant.value = 'tenant-preview'
    assert.equal(state.previewFile.value, null, 'tenant switch immediately clears selected file')
    previewResolvers.get('/codocs/api/cabinet/old-tenant-file/preview')({ success: true, data: { content: 'old tenant body' } })
    await oldTenantPreview
    assert.equal(state.previewData.value, null, 'old-tenant preview is discarded even for the same user')

    const remove = async uuid => { state.confirmDelete({ uuid }); await state.executeDelete() }
    const deletionKey = () => calls.filter(call => call.options?.method === 'DELETE').at(-1).options.headers['Idempotency-Key']
    await remove('file-1')
    const firstKey = deletionKey()
    await remove('file-1')
    assert.equal(deletionKey(), firstKey, 'retry retains the key after failure')
    user.value = 'person-c'
    await settle()
    await remove('file-1')
    const nextUserKey = deletionKey()
    assert.notEqual(nextUserKey, firstKey, 'session change starts a separate attempt')
    deleteFails = false
    await remove('file-1')
    assert.equal(deletionKey(), nextUserKey)
    await remove('file-1')
    assert.notEqual(deletionKey(), nextUserKey, 'successful attempt is cleared')

    delayDelete = true
    state.confirmDelete({ uuid: 'file-old-tenant' })
    const delayedDelete = state.executeDelete()
    const deletesBeforeReentry = calls.filter(call => call.options?.method === 'DELETE').length
    await state.executeDelete()
    assert.equal(calls.filter(call => call.options?.method === 'DELETE').length, deletesBeforeReentry)
    tenant.value = 'tenant-after-delete'
    state.confirmDelete({ uuid: 'file-new-tenant' })
    resolveDelete({ success: true, data: { deleted: true } })
    await delayedDelete
    assert.equal(state.deleteTarget.value.uuid, 'file-new-tenant', 'old response cannot close the new session dialog')
    delayDelete = false

    const fileA = new File(['a'], 'a.bin')
    const fileB = new File(['bb'], 'b.bin')
    const input = { files: [fileA, fileB], value: '' }
    await state.handleFileUpload({ target: input })
    assert.equal(uploadCalls.length, 2)
    const firstBatchKeys = uploadCalls.map(call => call.key)
    assert.notEqual(firstBatchKeys[0], firstBatchKeys[1])
    await state.handleFileUpload({ target: input })
    assert.deepEqual(uploadCalls.slice(2).map(call => call.key), firstBatchKeys, 'partial retry reuses each file key')

    const changedFileA = new File(['changed'], 'a.bin')
    await state.handleFileUpload({ target: { files: [changedFileA, fileB], value: '' } })
    assert.notEqual(uploadCalls.at(-2).key, firstBatchKeys[0], 'changed bytes create a new key')

    switchUidOnUpload = true
    const beforeSwitchUploads = uploadCalls.length
    await state.handleFileUpload({ target: { files: [new File(['c'], 'c.bin'), fileB], value: '' } })
    assert.equal(uploadCalls.length, beforeSwitchUploads + 1, 'session change stops subsequent files')

    switchTenantOnUpload = true
    const beforeTenantSwitch = uploadCalls.length
    await state.handleFileUpload({ target: { files: [fileA, fileB], value: '' } })
    assert.equal(uploadCalls.length, beforeTenantSwitch + 1, 'same UID in another tenant stops subsequent files')

    let finishFingerprint
    let fingerprintPending = true
    const slowFile = new File(['slow'], 'slow.txt')
    slowFile.arrayBuffer = () => {
      if (!fingerprintPending) return Promise.resolve(new TextEncoder().encode('slow').buffer)
      fingerprintPending = false
      return new Promise(resolve => { finishFingerprint = resolve })
    }
    const beforeSlow = uploadCalls.length
    const slowUpload = state.handleFileUpload({ target: { files: [slowFile], value: '' } })
    await state.handleFileUpload({ target: { files: [fileA], value: '' } })
    assert.equal(uploadCalls.length, beforeSlow, 'fingerprinting already holds the upload lock')
    finishFingerprint(new TextEncoder().encode('slow').buffer)
    await slowUpload
    assert.equal(uploadCalls.length, beforeSlow + 1)

    failFirstUpload = true
    await state.handleFileUpload({ target: { files: [fileA], value: '' } })
    const failedBytesKey = uploadCalls.at(-1).key
    await state.handleFileUpload({ target: { files: [new File(['z'], 'a.bin')], value: '' } })
    assert.notEqual(uploadCalls.at(-1).key, failedBytesKey, 'changed bytes with identical name and size start a new attempt')

    user.value = 'person-c'
    const sourceA = { uuid: 'cab-a', original_name: 'A.pdf', file_ext: 'pdf' }
    const sourceB = { uuid: 'cab-b', original_name: 'B.pdf', file_ext: 'pdf' }
    state.previewFile.value = sourceA
    state.openConvertModal(sourceA)
    conversionMode = 'error'
    await state.executeConvert()
    const firstConvertCall = calls.filter(call => call.url.includes('/to-document')).at(-1)
    const firstConvertKey = firstConvertCall.options.headers['Idempotency-Key']
    conversionMode = 'ok'
    await state.executeConvert()
    const retryConvertCall = calls.filter(call => call.url.includes('/to-document')).at(-1)
    assert.equal(retryConvertCall.options.headers['Idempotency-Key'], firstConvertKey, 'conversion retry retains idempotency key')

    state.openConvertModal(sourceA)
    state.convertDocName.value = 'Renamed'
    conversionMode = 'error'
    await state.executeConvert()
    assert.notEqual(calls.filter(call => call.url.includes('/to-document')).at(-1).options.headers['Idempotency-Key'], firstConvertKey, 'title change starts a new conversion attempt')

    conversionMode = 'pending'
    state.previewFile.value = sourceA
    state.openConvertModal(sourceA)
    state.convertedInfo.value = null
    const targetSwitch = state.executeConvert()
    const conversionsBeforeReentry = calls.filter(call => call.url.includes('/to-document')).length
    await state.executeConvert()
    assert.equal(calls.filter(call => call.url.includes('/to-document')).length, conversionsBeforeReentry, 'conversion holds its reentry lock')
    state.previewFile.value = sourceB
    state.openConvertModal(sourceB)
    conversionResolvers.get('convert')({ success: true, data: { uuid: 'doc-a', title: 'A' } })
    await targetSwitch
    assert.equal(state.convertedInfo.value, null, 'late result does not update a different selected file')

    state.previewFile.value = sourceA
    state.openConvertModal(sourceA)
    state.convertedInfo.value = null
    const sessionSwitch = state.executeConvert()
    user.value = 'person-d'
    conversionResolvers.get('convert')({ success: true, data: { uuid: 'doc-a', title: 'A' } })
    await sessionSwitch
    assert.equal(state.convertedInfo.value, null, 'late result does not update after session change')

    user.value = 'person-c'
    await settle()
    conversionMode = 'info-error'
    state.previewFile.value = sourceA
    state.openConvertModal(sourceA)
    await state.executeConvert()
    assert.equal(state.convertedInfo.value.doc_path, '', 'converted-info failure keeps completed result without fake path')

    conversionMode = 'info-pending'
    state.openConvertModal(sourceA)
    const delayedInfo = state.executeConvert()
    await settle()
    state.previewFile.value = sourceB
    state.openConvertModal(sourceB)
    state.convertedInfo.value = null
    conversionResolvers.get('info')({ success: true, data: { doc_uuid: 'doc-converted', doc_title: 'Late', doc_path: 'codocs/late.md' } })
    await delayedInfo
    assert.equal(state.convertedInfo.value, null, 'selection is checked again after converted-info resolves')

    conversionMode = 'pending'
    state.previewFile.value = sourceA
    state.openConvertModal(sourceA)
    const tenantSwitch = state.executeConvert()
    const infoCallsBeforeSwitch = calls.filter(call => call.url.includes('/converted-info')).length
    tenant.value = 'tenant-c'
    conversionResolvers.get('convert')({ success: true, data: { uuid: 'doc-converted', title: 'A' } })
    await tenantSwitch
    assert.equal(calls.filter(call => call.url.includes('/converted-info')).length, infoCallsBeforeSwitch, 'new tenant must not fetch old-session source metadata')
    assert.equal(state.convertedInfo.value, null)

    conversionMode = 'malformed'
    state.openConvertModal(sourceA)
    await state.executeConvert()
    const malformedKey = calls.filter(call => call.url.includes('/to-document')).at(-1).options.headers['Idempotency-Key']
    assert.equal(toasts.at(-1).color, 'error')
    conversionMode = 'ok'
    await state.executeConvert()
    assert.equal(calls.filter(call => call.url.includes('/to-document')).at(-1).options.headers['Idempotency-Key'], malformedKey, 'malformed success does not clear the retry key')
    conversionMode = 'ok'
  } finally {
    for (const stop of stops) stop()
  }
})
