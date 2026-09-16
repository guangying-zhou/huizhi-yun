# DEBUG REPORT — People 员工搜索被旧 Data Runtime 误判为写操作

日期：2026-08-29  
租户：wiztek.huizhi.yun

## Symptom

- People 员工页面选择公司或部门节点后仍显示 0 人。
- 页面明确提示 `Missing scope people.write`。
- 浏览器中员工查询请求为 `POST`，并由服务端返回 HTTP 403。

## Root cause

People BFF 已将 `POST /v1/people/employees:search` 定义为带结构化请求体的只读查询，
只申请最小权限 `people.read`。生产 Data Runtime 的已发布版本仍使用旧的通用判定：
所有非 GET 请求默认要求 `<app>.write`，且没有 People 员工搜索的只读例外，因此在进入
People 数据查询和部门筛选逻辑前就以 `Missing scope people.write` 拒绝请求。

这是 People Worker 与 Data Runtime 的发布版本漂移，不是部门树或员工归属数据为空。

## Evidence

- People BFF 的员工搜索路由策略要求 `people.read`。
- 合并提交 `b315e962290c5ffadb4a620a8b91ac90b6d3d398` 已在 Data Runtime 中为
  `POST /v1/people/employees:search` 增加 `people.read` 例外。
- 故障发生时公共 latest manifest 仍为 `0.3.197`，构建提交是 `83c79b85-dirty`。
- `83c79b85` 不包含上述 People 修复；其 `readOnlyAppRuntimeScope` 只包含 Codocs
  `document-access/check` 的只读 POST 例外。
- 线上错误文本与旧 Runtime 的通用非 GET 权限判定完全一致。

## Safe recovery

1. 从已合并的 `main` 构建新的不可变 Data Runtime 版本（不能覆盖现有 `0.3.197`）。
2. 签名发布并在 Platform Runtime Releases 中批准为 stable。
3. 在租户 Console 中更新 Data Runtime。
4. 验证公司节点、行政部门及其正式下级部门查询均只要求 `people.read` 并能返回员工。

不要给浏览操作补授 `people.write`；那会掩盖版本漂移并扩大权限。

## Status

DONE：

- MR !49 将 `data-runtime/VERSION` 升级到 `0.3.198`，流水线 514 通过并合并；
  merge commit 为 `9b543a00af8a18b0a57e3293081a251a4d060276`。
- `0.3.198` 已完成 Ed25519 签名、不可变 R2 staging 和 `latest` promotion；manifest
  commit 为 `a42c29ec`，不含 `-dirty` 标记。
- Platform 已验签同步并批准 `0.3.198` 为 stable，批准说明记录本次 People 403 修复；
  实例汇总为 `currentVersion=0.3.198`、`desiredVersion=0.3.198`、`status=ready`、
  `aligned=1/1`。
- 生产 `/runtime/healthz` 返回 `status=ok`、People adapter `enabled=true/db=ok`，
  版本和 commit 与 manifest 一致。
- 已使用现有登录会话完成生产页面回归：People 员工页正常渲染公司节点和部门树，员工
  列表返回 92 人；`employees:search`、`directory/departments`、通知摘要和待办查询均
  成功，不再出现 `Missing scope people.write`、401 或 503。

## Non-blocking observation

R2 `latest` promotion 后、Platform stable 批准前，实例一度上报
`currentVersion=0.3.198`、`desiredVersion=0.3.162`。stable 批准后已正常对齐为
`0.3.198/0.3.198`。这说明当前 Agent 可能仍会直接跟随公共 `latest`，后续应单独审计
更新触发源，确保 Platform stable 是唯一生产目标事实源。
