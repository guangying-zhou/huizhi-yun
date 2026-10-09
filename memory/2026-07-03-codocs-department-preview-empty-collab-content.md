# Codocs 部门文档预览为空但编辑可见

## Symptom

部门协同文档列表中选中文档时，右侧预览卡片为空；进入文档编辑页后，同一文档在协同编辑器中能看到正文。

## Root Cause

部门页预览通过 `/api/documents/:uuid` 读取 OSS Markdown 快照。编辑页在实时协同模式下读取 Yjs 文档内容，但旧逻辑在两个地方把“协同中已同步到 Yjs 的内容”误标为 `savedState.content`：

- `collaboration.synced` watcher 把 `savedState.content` 改成 `syncedContent`。
- metadata-only 保存时，即使没有写正文，也把 `savedState.content` 改成当前编辑器内容。

这会让离开编辑页时的 `hasPendingContentFlush` 变为 false。页面返回部门列表后，预览立即读取的仍是旧的空 Markdown 快照，所以出现“编辑可见、预览为空”。

## Fix

- `savedState.content` 只代表已写入 Markdown 预览快照的正文。
- 协同同步后若 Yjs 内容与已保存 Markdown 不一致，标记 `needsCollaborationPreviewSnapshotFlush`。
- 非只读用户离开文档路由前，等待 `flushDocumentBeforeRouteLeave()` 把最新编辑器 Markdown 写入 `/api/documents/:uuid`。
- `flushDocumentOnExit()` 也使用编辑器实例的最新 Markdown，并在需要时写正文快照。
- 协同只读 scope 不尝试写预览快照，避免部门开放文档的只读访问者触发 PUT。

## Evidence

通过：

- `node --test test/documentPreviewFlush.test.ts`
- `node --test test/sensitiveRoutePermissions.test.ts`
- `pnpm exec eslint 'app/pages/documents/[uuid].vue' test/documentPreviewFlush.test.ts`
- `git diff --check -- 'app/pages/documents/[uuid].vue' test/documentPreviewFlush.test.ts`

`pnpm typecheck` 失败，但失败项是既有项目级类型问题，集中在 Milkdown/@vueuse/y-protocols 类型解析和若干隐式 any，例如 `app/components/editor/editorTableCodec.ts`、`app/components/editor/MilkdownEditor.client.vue`、`app/utils/hocuspocus-provider.ts`，不是本次新增文件或改动行引起。

## Regression Test

新增 `codocs/test/documentPreviewFlush.test.ts`，锁定：

- 协同内容在写入 Markdown 快照前保持 pending。
- metadata-only 保存不能把未写正文内容标记为已保存。
- 路由离开前必须等待 Markdown 快照 flush。
- 只读协同 scope 不参与写快照。

## Status

DONE_WITH_CONCERNS: 本地静态与 focused 测试已验证。未用真实浏览器连生产 OSS/协同运行时复现，因为当前环境没有用户登录态和目标生产数据；建议部署后用同一文档验证“编辑返回部门页后预览立即显示正文”。
