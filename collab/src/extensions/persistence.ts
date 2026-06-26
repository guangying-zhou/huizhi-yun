/**
 * Collaboration persistence extension.
 *
 * Persists Yjs snapshots and Markdown mirrors to OSS.
 */

import type { Extension, onLoadDocumentPayload, onStoreDocumentPayload } from '@hocuspocus/server'
import crypto from 'node:crypto'
import OSS from 'ali-oss'
import * as Y from 'yjs'
// yjs 类型由 @hocuspocus/server 的 onLoadDocumentPayload.document 提供
import type { OssConfig } from '../config.js'
import { createDocumentVersion, loadDocumentContext } from '../utils/document-context.js'
import { yjsDocumentToMarkdown } from '../utils/prosemirror-markdown.js'

export class PersistenceExtension implements Extension {
  private defaultClient: OSS | null = null
  private projectsClient: OSS | null = null
  private config: OssConfig
  private lastStoredHash = new Map<string, string>()

  constructor(config: OssConfig) {
    this.config = config
    this.initOSSClient()
  }

  private getYjsSnapshotPath(ossPath: string): string {
    return ossPath.endsWith('.md') ? ossPath.replace(/\.md$/, '.yjs') : `${ossPath}.yjs`
  }

  /**
   * 初始化 OSS 客户端
   */
  private initOSSClient(): void {
    if (!this.config.accessKeyId || !this.config.accessKeySecret) {
      console.warn('[collab] OSS credentials not configured, persistence disabled')
      return
    }

    this.defaultClient = this.createOSSClient('default', {
      bucketName: this.config.bucketName,
      endpoint: this.config.endpoint,
      bucketDomain: this.config.bucketDomain
    })

    this.projectsClient = this.createOSSClient('projects', {
      bucketName: this.config.projectsBucketName || this.config.bucketName,
      endpoint: this.config.projectsEndpoint || this.config.endpoint,
      bucketDomain: this.config.projectsBucketDomain || this.config.bucketDomain
    }) || this.defaultClient

    if (!this.defaultClient) {
      console.warn('[collab] OSS bucket or endpoint not configured, persistence disabled')
      return
    }

    const projectsBucket = this.config.projectsBucketName || this.config.bucketName
    console.log(`[collab] OSS clients initialized: default=${this.config.bucketName}, projects=${projectsBucket}`)
  }

  private createOSSClient(scope: 'default' | 'projects', config: {
    bucketName?: string
    endpoint?: string
    bucketDomain?: string
  }): OSS | null {
    if (!config.bucketName || !config.endpoint) {
      if (scope === 'default') {
        console.warn('[collab] default OSS bucket or endpoint is missing')
      }
      return null
    }

    return new OSS({
      bucket: config.bucketName,
      endpoint: config.endpoint,
      accessKeyId: this.config.accessKeyId,
      accessKeySecret: this.config.accessKeySecret,
      region: this.config.region
    })
  }

  private useProjectsBucket(docType?: string): boolean {
    return docType === 'git-project'
  }

  private clientForDocument(docType?: string): OSS | null {
    if (this.useProjectsBucket(docType)) {
      return this.projectsClient || this.defaultClient
    }
    return this.defaultClient
  }

  /**
   * 文档加载优先恢复 Yjs 二进制快照。
   * 仅当历史文档还没有 .yjs 快照时，才回退到 Markdown 文本重建。
   *
   * 注意：Yjs 文档不能在客户端/服务端分别从同一份纯文本独立重建后再 merge，
   * 否则会把“相同文本”视作两段不同的 CRDT 插入历史，重连后出现整文重复追加。
   */
  async onLoadDocument(data: onLoadDocumentPayload): Promise<void> {
    const { documentName, document } = data

    try {
      const { ossPath, docType } = await loadDocumentContext(documentName, data.context)
      const client = this.clientForDocument(docType)
      if (!client) {
        console.log(`[collab] loading document without OSS: ${documentName}`)
        return
      }

      const yjsPath = this.getYjsSnapshotPath(ossPath)
      console.log(`[collab] loading document from OSS: ${ossPath}`)

      try {
        const yjsResult = await client.get(yjsPath)
        const snapshotBuffer = yjsResult.content as Buffer
        const update = new Uint8Array(snapshotBuffer)

        if (update.byteLength > 0) {
          Y.applyUpdate(document, update)
        }

        const syncedMarkdown = yjsDocumentToMarkdown(document)
        if (syncedMarkdown.length > 0) {
          const baselineHash = crypto.createHash('sha256').update(syncedMarkdown).digest('hex')
          this.lastStoredHash.set(documentName, baselineHash)
        }

        console.log(`[collab] Yjs snapshot loaded: ${documentName}`)
        return
      } catch (yjsError: unknown) {
        const error = yjsError as Record<string, unknown>
        if (error.code !== 'NoSuchKey') {
          throw yjsError
        }
      }

      try {
        const mdResult = await client.get(ossPath)
        const markdown = mdResult.content.toString('utf-8')

        const ytext = document.getText('content')
        if (ytext.length === 0) {
          ytext.insert(0, markdown)
          console.log(`[collab] document loaded: ${documentName}`)
        } else {
          console.log(`[collab] skip re-insert, Y.Doc already has ${ytext.length} chars: ${documentName}`)
        }
        // 记录基线哈希，用于 onStoreDocument 防御空内容覆盖
        if (markdown.length > 0) {
          const baselineHash = crypto.createHash('sha256').update(markdown).digest('hex')
          this.lastStoredHash.set(documentName, baselineHash)
        }
      } catch (mdError: unknown) {
        const error = mdError as Record<string, unknown>
        if (error.code === 'NoSuchKey') {
          console.log(`[collab] new document: ${documentName}`)
        } else {
          throw mdError
        }
      }
    } catch (error: unknown) {
      const err = error as Record<string, unknown>
      console.error(`[collab] failed to load document: ${documentName}`, err.message)
    }
  }

  /**
   * 文档保存同时写入：
   * 1. .yjs 快照：协同状态真实来源，保证重连/重启后继续沿用同一 CRDT 历史
   * 2. .md 快照：供预览、导出、版本记录与非协同读取使用
   */
  async onStoreDocument(data: onStoreDocumentPayload): Promise<void> {
    const { documentName, document } = data

    try {
      const context = await loadDocumentContext(documentName, data.context)
      const { ossPath } = context
      const client = this.clientForDocument(context.docType)
      if (!client) {
        console.log(`[collab] storing document without OSS: ${documentName}`)
        return
      }

      const yjsPath = this.getYjsSnapshotPath(ossPath)

      const markdown = yjsDocumentToMarkdown(document)
      const contentHash = crypto.createHash('sha256').update(markdown).digest('hex')

      // 防御：若即将写入空内容，而上一次已存的内容非空，拒绝保存以避免协同异常导致数据丢失
      if (markdown.length === 0) {
        const prevHash = this.lastStoredHash.get(documentName)
        const emptyHash = crypto.createHash('sha256').update('').digest('hex')
        if (prevHash && prevHash !== emptyHash) {
          console.warn(`[collab] refuse to store empty markdown over non-empty prior content: ${documentName}`)
          return
        }
      }

      const snapshot = Buffer.from(Y.encodeStateAsUpdate(document))
      await client.put(yjsPath, snapshot, {
        headers: {
          'Content-Type': 'application/octet-stream'
        }
      })

      const markdownResult = await client.put(ossPath, Buffer.from(markdown, 'utf-8'), {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8'
        }
      })

      if (this.lastStoredHash.get(documentName) !== contentHash) {
        const responseHeaders = (markdownResult.res?.headers || {}) as Record<string, string | undefined>
        const versionId = String(
          responseHeaders['x-oss-version-id']
          || (markdownResult as unknown as { versionId?: string }).versionId
          || ''
        )

        await createDocumentVersion({
          docId: context.docId,
          docUuid: context.docUuid,
          editorUid: context.actorUid || context.ownerUid || 'system',
          ossVersionId: versionId,
          contentSize: Buffer.byteLength(markdown, 'utf-8')
        })

        this.lastStoredHash.set(documentName, contentHash)
      }

      console.log(`[collab] document stored: ${documentName}`)
    } catch (error: unknown) {
      const err = error as Record<string, unknown>
      console.error(`[collab] failed to store document: ${documentName}`, err.message)
    }
  }
}
