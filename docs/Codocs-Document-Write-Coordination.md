# 个人文档写入协调与恢复合同

> 本文按实施阶段保留 2026-09-20～09-25 的**历史决策和测试回执**；下文早期“当前行为”“默认关闭”等措辞以各节写入时间为准。现行 hzy0/Runtime/Collab 开关与制品见[当前运行组合](./Current-Running-Combination-20260925.md)。

> 2026-09-20；源码核查基线 `ddfd84a9`。INT-606c 实现合同；下述第一批内部事务已落地，其余协议尚未接入，不是环境验证或发布批准。

## 已确认的冲突边界

| 路径 | 当前行为 | 必须关闭的风险 |
| --- | --- | --- |
| Enterprise 保存 | 只读 update-plan → 覆盖正文 key → Runtime 提交版本/回执 | 两个未完成请求均可通过计划；存储后数据库失败已改变正文 |
| Collab 保存 | 写 `.yjs` → 写 `.md` → 创建版本；存储失败已向 Hocuspocus 传播 | 两个对象及版本不是原子发布，传播错误也不构成提交回执 |
| Collab 加载 | 优先 `.yjs`，不存在才读 Markdown；无 OSS 或非 `NoSuchKey` 错误已失败关闭 | 普通保存只改 Markdown 后，重连仍可能恢复旧协作内容 |
| 旧 Codocs PUT | 覆盖正文 → 更新元数据 → 创建版本 | 未接入新协调，不能与新写协议并行放行 |
| Host 正文/下载 | 从元数据路径读 Markdown，空内容时尝试 Yjs 恢复 | 不绑定同一已提交正文/Yjs 版本，不能保证一致读取 |

对应源码：[Host 保存](../enterprise/server/utils/enterpriseCodocsDocumentUpdate.ts)、[Collab 持久化](../collab/src/extensions/persistence.ts)、[Collab 上下文](../collab/src/utils/document-context.ts)、[旧保存](../codocs/server/api/documents/[uuid]/index.put.ts)、[正文读取](../enterprise/server/utils/enterpriseCodocsDocumentContent.ts)。Collab 可复用连接上下文，因此连接认证也不能替代提交时的当前授权。

## 实现方向：先存候选，再原子发布引用

不使用进程内锁或仅靠过期租约保护可覆盖的正式 key；迟到写入仍会覆盖后来内容。采用 Runtime 管理的文档 generation 与候选快照，OSS 写成功不等于保存成功。

1. Runtime 准备命令：绑定 tenant、deployment、文档 UUID、已验证 actor、命令键和内容摘要，检查当前写权限；记录预期 generation、写入类型和服务器分配的候选对象身份。每次存储尝试隔离对象，不依赖同名覆盖条件头。
2. 受信存储适配器上传候选正文。协作保存同时上传由同一 Y.Doc 状态生成的 Yjs 与 Markdown；记录长度、SHA-256、对象 key 及可用的 provider version ID。浏览器不能指定路径或伪造存储成功证明。已发布对象不得再写；精确版本读取或不可变对象保障必须经实际 provider 验证。
3. Runtime 提交在同一数据库事务中锁定文档，重验当前 actor/ACL、删除/只读状态、预期 generation、候选归属和存储证明，原子提交正文/Yjs 引用、版本事实、generation 与幂等回执。禁止在持锁事务中等待 OSS。
4. 成功响应丢失只查询/重放回执，不重新上传。不同命令基于同一 generation 时仅一个提交成功，另一个返回冲突并保留用户内容；不得自动改用新 generation 覆盖。
5. 正文、下载、历史版本和 Collab 加载统一消费已提交引用；未提交候选不可被正常读取。旧文档保持兼容读取，在首个新协议提交时建立新引用，不批量改写旧对象。

这意味着新增持久状态及读取合同，不能仅在现有 update-plan 增加布尔字段。现有 v1 成功回执与摘要必须保留；新协议使用版本化合同，不改变旧键的语义。

## 协作与普通编辑的互斥规则

- 协作快照是一个正文/Yjs 配对，不允许从另一 generation 自动恢复 Yjs，也不能将合法空正文当成恢复旧内容的理由。
- 普通覆盖、导入与恢复必须先使旧协作会话失效，并在提交时验证会话 epoch。活动协作未安全结束时返回明确冲突，不能静默覆盖。
- 旧 epoch 的 Collab 即使上传结束，也不得提交。普通覆盖后的新会话由已提交 Markdown 初始化一次新的 CRDT 历史，不与旧 Yjs 合并。
- Collab 多实例写同一文档也受 generation/epoch 校验；不能假定单进程队列提供全局串行。
- 重命名等纯元数据操作不重建正文/Yjs；是否与内容 generation 分离应在 schema 实现中明确，并覆盖并发重命名测试。

## 失败与恢复

| 故障点 | 对外结果与恢复规则 |
| --- | --- |
| 上传失败/仅 Yjs 成功 | 不发布；当前正文不变；同命令查询状态后继续隔离尝试 |
| 上传成功、提交前撤权 | 拒绝提交；候选隔离；不得把旧正文写回作补偿 |
| 数据库提交失败 | 当前引用不变；按原命令查询/重试，不生成新业务命令 |
| 提交成功、响应丢失 | 原键返回原结果；不得再触碰已发布对象 |
| 过期 writer 迟到 | generation/epoch 不符拒绝发布；不得通过租约续期绕过 |
| 已提交对象不可读 | 明确存储错误；不得回退到未提交对象或另一代 Yjs |

候选清理由后续受控任务处理：满足保留期、无引用、无活跃/未知提交后才可删除；首批不自动清理，不扫描或删除共享生产桶。重试、观察和清理均保留 tenant/deployment 隔离。

## 有界实施与放行顺序

1. 先补 Runtime generation/候选/回执事务与两个并发提交、撤权、回滚的隔离测试，确定 schema/API；不先切换线上正文路径。
2. 再接 Host 候选写入和全部正文读取，验证失败不改变已提交内容。
3. 接 Collab 配对快照、epoch 失效与错误传播，并让旧写入口走同一协议或明确阻断。不得只切 Host 而放任旧 writer。
4. 在独立可丢弃的数据库与对象存储范围验证真实版本读取、双 writer、超时重试、重启恢复和撤权；模拟测试不能替代该证据。
5. 固定 Host/Runtime/Collab/schema 与权限目录的兼容矩阵。启用后 UI 回退仍读当前权威引用，不回退旧数据库或恢复旧覆盖写入。

## 第一批内部事务（未注册路由）

`data-runtime/internal/apps/codocs/document_snapshot.go` 新增 `PrepareDocumentSnapshot` / `PublishDocumentSnapshot`，仅接受受信 `enterprise.runtime` 身份下的 private 文档内容命令，当前 owner/write-share 且可写。它不是公开 HTTP API，也不代表 Collab 获得该身份。现有 v1 路由、正文路径、回执和 document_versions 不变。

新增 `document_snapshot_heads` 保存当前 generation/epoch 与配对引用；`document_snapshot_candidates` 保存命令摘要、完整命令、候选状态及发布结果，兼作 v2 不可变快照版本事实与专用发布回执。准备只建候选，提交锁定文档→head→candidate，以 generation/epoch 检查串行发布；候选结果、head 和正文大小/最后编辑者同事务。纯标题修改不在此命令中，不推进内容 generation。

对象引用必须是服务器命名空间下同一 attempt 的正文/Yjs，且携带非空、非 `null` 的精确 provider version。内部受信 verifier 在 SQL 事务外验证指定版本的字节摘要/长度及租户存储绑定，提交事务再次校验权限/代数；缺 verifier 失败关闭。`document_snapshot_verifier.go` 已新增未注册的有界字节校验内核：对读取器报告的租户、部署、key、精确版本以及正文/Yjs 长度和 SHA-256 逐项核对，并在失败时关闭读取体。它仅由假读取器做单元验证，尚无绑定真实凭据、桶和 provider version 的 OSS 适配器，也未提供版本保留保障；不能称为正式 OSS verifier 或启用依据。已成功重放先验当前权限并返回原 generation，不再访问存储；不同内容、原代数冲突不得自动重试覆盖。候选前缀不是可签发给浏览器的通用存储权限。

隔离验证使用 `node data-runtime/scripts/test-codocs-snapshots-mysql.mjs`，新建可丢弃 MySQL datadir/socket，加载正式表定义，不读取环境 DB/OSS 配置。覆盖双命令竞争、同命令竞争、成功后迟到重放、存储校验失败、元数据更新晚失败的整笔回滚、分享撤销、epoch 变化、配对引用、schema CHECK 及命名空间回执隔离。该测试中的存储为替身；同库回执命名空间检查也不替代路由到不同租户库的认证验收。

Foundation 共享存储客户端已补 `get(key, { versionId })` 的 S3 兼容端精确版本 query 与响应版本头核对（原生 OSS 也核对响应头），修复此前 S3 适配器忽略 `versionId`、可能返回最新内容的缺口。Host 历史版本页现对带 SHA-256 的版本记录核对精确读取后的正文长度和摘要，不匹配即拒绝展示；缺摘要的旧记录仍按原兼容路径读取。以上只有请求级假服务验证，未验证 hzy0 实际存储供应商和桶配置，也不是 v2 已提交快照读取。下一批须补真实 OSS 精确版本读取及存储身份绑定、版本保留验证、受信路由/能力并将读取引用接入全部消费者，然后接 Host；Collab epoch 的签发/失效/重连、普通编辑与活动会话互斥、旧 writer 的协调仍未实现。未更新 Runtime schema 安装目录，也未执行目标库迁移；不能只建表就启用。保留 INT-606c 写入闭环发布阻塞。项目文档、演示功能及商业模块不因本合同扩大范围。

写入版本回执适配已让 Host v1 保存及旧 Codocs 上传同时识别 `x-oss-version-id` / `x-amz-version-id`，双头冲突或无效值失败关闭；Collab 当前仍使用原生 `ali-oss`，也兼容两种响应头名称。这只修正不同 provider 的回执读取，不改变上述“覆盖正式 key → 后提交版本事实”的 v1 顺序，更不是 v2 发布、真实 OSS 版本保留或多 writer 安全证明。

### 后续内部读取增量（仍未注册路由）

`ReadDocumentSnapshot` 在同一只读事务中先检查 private 文档当前 owner/read-share/write-share，再读取同租户、同部署的发布头和候选。无发布头或 generation=0 时返回旧正文路径；一旦存在已发布 generation，只返回与已发布候选、命令代数和同次正文/Yjs 配对一致的精确对象版本，损坏或缺失则 503，绝不回退旧路径或其他 generation。此方法只供后续受信存储消费者调用，尚未接入 HTTP、Host、下载、历史版本或 Collab；没有正式 verifier、目标 schema 安装和旧 writer 协调前，仍不能启用 v2 写入。

`node data-runtime/scripts/test-codocs-snapshots-mysql.mjs` 已在可丢弃 MySQL 中验证旧引用、发布后精确引用、损坏引用失败关闭、共享读取及撤权；Go Codocs 包测试与定向 race 测试通过。该证据不含真实 OSS，也不替代目标库安装或用户业务验收。

### 真实 OSS 精确版本读取与版本保留取证（2026-09-23，只读）

新增 Runtime 内部能力（未注册 HTTP 路由）：`internal/apps/console/oss_object_version.go` 的 `OpenOSSObjectVersion`（按 `versionId` 签名读取，核对响应 `x-oss-version-id`，失败关闭，上限 128 MiB）与 `GetOSSBucketRetention`（读取 bucket versioning 与 lifecycle）；凭据沿用 Console 集成 + Vault 解析与访问日志，不外露。`RetainsVersionsUnder(prefix, writeOnce)` 为保留判定：版本控制须为 Enabled；与前缀重叠的启用规则不得过期当前对象；原地覆盖的键（v1 历史）另不得有非当前版本过期。伪 OSS（校验 V1 签名）单测覆盖精确读取、版本不符/缺失/404/拒绝失败关闭、键与版本输入校验、生命周期解析与判定矩阵。

只读核验命令 `data-runtime/cmd/test-oss-version-check`（仅 C000001 测试 Runtime 身份可运行，不写对象、不打印凭据）对测试集成 `oss.default` 实测：

- bucket 版本控制 **Enabled**。
- 生命周期两条启用规则：`codocs/` **非当前版本 30 天后删除**；`recycle.bin` 当前对象 30 天后删除。
- `hzy_codocs` 中全部 3 条带 SHA-256 的版本记录（文档 183 的 v1、v2 为非当前版本，v3 为当前）按记录的 `oss_version_id` 精确读取：长度、SHA-256、返回版本号全部一致。

结论与约束：

1. **v1 历史版本缺陷（既有）**：正文原地覆盖，旧版本只以非当前版本存在，`codocs/` 规则会在其被覆盖 30 天后删除，而 `document_versions` 行仍在，历史版本页将读不到旧内容。是否延长/取消该规则、或改为 v2 写一次键，属存储配置与产品保留期决定；该 bucket 可能与其他环境共用，修改须单独批准，本次未改。**用户决定（2026-09-23）：接受 30 天保留期，不改 bucket 规则。** 实现：Host `enterpriseCodocsVersions.ts` 对非最新版本的存储 404 返回 410 `codocs_version_expired`（`data.message` 为固定文案），最新版本缺失仍 404、存储故障仍 503（有测试）；hzy0 错误过滤白名单加入该码；文档页查看/对比遇该码提示“该历史版本已不可用”，版本面板常驻说明“被新版本替换 30 天后清理”。旧独立 Codocs 后端版本接口仍为通用错误（兼容消费者）。
2. **v2 快照可用前提**：候选/发布键写一次、不覆盖，在被引用期间保持为当前版本，现有规则不影响；因此发布实现与回收站/删除/清理路径**不得覆盖或删除仍被 head 或候选引用的快照键**（删除会产生删除标记使其变为非当前版本，30 天后丢失）。启用前需把此约束写入删除/回收站合同并加测试。
3. 已补 `internal/server/codocs_snapshot_reader.go`：快照读取器绑定本 Runtime 租户、`deploymentBindings.codocs` 与 `codocs/snapshots/` 命名空间，越界引用不访问存储，缺绑定失败关闭（有单测）；尚未被任何已注册路由使用。受信路由已补（见第 5 点）。仍未完成：Host v2 写入与全部读取消费者、Collab epoch 与旧 writer 协调、目标库 schema 安装；正式写入仍不放行。
4. **写一次命名空间（已实现）**：Foundation `objectStorage.ts` 的共享客户端（Codocs、Enterprise 及所有经 `createAliOssCompatibleClient` 的调用方，含原生 OSS 与 S3 兼容两种 provider）对 `codocs/snapshots/`（前导 `/` 同样视为该前缀）拒绝 `delete`、`deleteMulti`（任一键命中即整批拒绝）、以之为目标的 `copy`、`putMeta` 以及未声明 `forbidOverwrite: true` 的 `put`，返回 409 `WriteOnceObjectNamespace` 且不发出存储请求；读取、以快照为来源的复制与仅创建写入不受影响。回收站、移动、归档、`cleanup-yjs` 等旧路径因此无法删除或覆盖快照；快照退役须另建带引用检查的专用路径。旧 v1 Collab 仍直接使用 `ali-oss` 写原文档同目录的 Yjs 文件；v2 Collab 不直接访问 OSS，快照候选对象由 Runtime 写入该命名空间。测试见 `foundation/test/objectStorageAliyunS3.test.ts`；Foundation 642、Enterprise 188、Codocs 255、Assets 101 项回归通过。
5. **受信路由（已实现，默认关闭）**：`data-runtime/internal/server/enterprise_codocs_document_snapshots.go` 在 `personal-documents` 资源下登记 `snapshot-prepare`、`snapshot-publish`（edit，Idempotency-Key 进入命令键）与 `snapshot-read`（read），复用精确 `codocs:personal-documents:edit/read`、签名 actor、租户/部署绑定与既有 enterprise.runtime 身份链，不新增 grant。请求体严格：文档 UUID 只取路由绑定的 code，命令仅接受 generation/epoch/正文与 Yjs 摘要和长度（安全整数），publish 另需 `objects.markdown`（可选 `objects.yjs`）各仅含 key/version；未知字段一律 400。publish 的 verifier 先核验 bucket 对 `codocs/snapshots/` 的写一次保留（`RetainsVersionsUnder(prefix, true)`，仅成功结果缓存 10 分钟），再经 `codocsSnapshotReader` 逐字节核对精确版本。全部仅在 Runtime 配置 `apps.codocs.snapshotV2Enabled=true` 时登记，默认关闭时请求不进入 Codocs 处理器。Foundation 已登记三个操作（精确 path/capability）；尚无 Host 调用方。启用前须：目标库安装两张快照表、Host 候选上传与发布接线、Collab epoch/旧 writer 协调、目标环境 grant 与保留核验。测试：`enterprise_codocs_document_snapshots_test.go`（精确 permit、严格解码、保留缓存、默认关闭）；完整 Go 测试通过。

## v2 接入设计（2026-09-23；D1 派生镜像、D2 分阶段均经用户接受，阶段 A 实施中）

用户决定（2026-09-23）：接受 D1 派生镜像与 D2 分阶段（阶段 A 期间 v2 文档暂不可协作）。阶段 A 使用现有测试桶；生产前须改用**专用、从未开启版本控制的快照桶**（防覆盖条件由 OSS 真正执行、无 30 天规则，读取按 key + SHA-256 核验），作为生产发布门槛。

### 现状约束

- 读取消费者：约 40 个文件直接按 `documents.oss_path` 读正文（其中 28 个经 `downloadDocument*` / `getSignedUrl` 等助手，多在旧 Codocs 服务端：导出、预览、周报汇总、分享、项目文档等）。v2 发布后 `oss_path` 最新对象不再是权威正文。
- Host 当前只对**已核验为私人且未共享**的文档开放 HTTP 编辑，Host 不接协作（不展示“重连协同”）；共享文档的协作编辑仍走旧 Codocs/Collab（v1）。
- Collab 写 `.yjs` → `.md` → 版本，均为同 key 覆盖；加载优先 `.yjs`。

### 决策 D1：旧读取者如何看到新正文（推荐“派生镜像”）

- **推荐：派生镜像。** 发布成功后，Host 服务端把已提交正文写到原 `oss_path`（带 `x-oss-meta-hzy-snapshot-generation`），作为**非权威派生副本**供旧读取者使用；写完后回读发布头，若已有更高代次则再镜像一次（最终一致，最后写入以最高代次为准）。v2 读取者（Host 正文/下载/历史、Collab）只读精确引用。镜像失败不影响已提交结果，返回成功并记录待修复，由修复任务按发布头重放。好处：旧读取者零改动；代价：旧读取者可能短暂读到上一代。
- 备选：先把约 40 个读取点全部改为读精确引用再启用。一致性最好，但工作量大，且要改旧 Codocs 服务端（旧消费者兼容层）。

### 决策 D2：分两阶段，阶段 A 只覆盖 Host 私人文档

- **阶段 A（Host 私人文档 HTTP 保存）**：正文读取返回 `snapshot_generation` 与 `snapshot_epoch`（含代次 0）；浏览器把该次读取的版本作为 `expectedGeneration`/`expectedEpoch` 随保存提交。Host 不在保存时重取最新 head 来替代期望值；缺少前置条件返回 428，Runtime 在事务内核对代次/epoch。保存流程为 `snapshot-prepare` → 服务端向候选前缀写一次上传正文（`forbidOverwrite`，取 provider version）→ `snapshot-publish` → 派生镜像。无 Yjs。浏览器不接触对象 key/版本；同一 Idempotency-Key 的命令固定期望代次与正文摘要，已发布候选由 Runtime 回执直接重放，不再用“当前正文相同”推断成功。代次冲突返回 409 并保留编辑器内容，不自动覆盖；标题作为独立子命令返回 `titleResult`。
- **互斥（阶段 A 必须同时落地）**：文档一旦 generation>0，所有 v1 写入口在 Runtime 提交处返回 409 `document_on_snapshot_v2`：Host v1 `update`、旧 Codocs PUT、Collab 版本创建；Collab 上下文接口对该文档返回冲突，协作会话不可打开（避免从旧 `.yjs` 恢复旧内容）。因此阶段 A 启用后，被共享的 v2 文档暂时不能协作编辑，直到阶段 B。
- **阶段 B（Collab 接入）**：Collab 加载改为读精确引用（有 Yjs 用配对 Yjs，否则由已提交正文初始化新 CRDT）；存储走 prepare/publish 且正文与 Yjs 同代配对；普通保存推进 epoch 使旧会话失效。Collab 需要自己的受信调用身份与精确 capability（新 grant），单独设计。
- **历史版本**：v2 代次的历史来自已发布候选记录（精确 key+版本），Host 历史页合并展示；v1 行照旧（30 天规则见上）。

### 启用门槛（测试环境）

目标库安装快照表；`apps.codocs.snapshotV2Enabled=true`；阶段 A 代码与互斥全部落地并有测试；真实测试桶端到端：保存、重复提交、并发冲突、镜像、旧读取者可见、v1 写入口被拒；目标环境 grant 与保留核验。生产另行批准。

### 阶段 A 进展

1. **v1 写入口互斥（已实现）**：`data-runtime/internal/apps/codocs/document_snapshot_guard.go`。文档存在 generation>0 的发布头即视为 v2（按 UUID 判断，Codocs 库按租户独立；快照表未安装视为无 v2 文档）。拒绝 409 `document_on_snapshot_v2`：Host v1 `update-plan`（内容保存，回执重放之后检查）、Host v1 `update`（仅新命令，在回执事务回调内、持文档行锁时检查，已成功请求的重试仍返回原结果）、Collab 版本创建（持文档行锁时检查）、Collab 上下文（不可打开会话）、旧 Codocs 文档 PUT/PATCH 带 `content_size` 时（无行锁，竞争写只会改派生副本，由镜像修复恢复）。仅改标题等元数据不受影响。隔离 MySQL 覆盖：发布前允许、发布后四类拒绝、v1 先前成功请求的重放、纯标题计划、无快照表的库；sqlmock 单测补充守卫查询；完整 Go 测试通过。
2. **Host 保存与读取（已实现，默认关闭）**：`enterprise/server/utils/enterpriseCodocsSnapshot.ts`，开关为 Host 进程环境变量 `HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2=true`（调用时读取，默认关闭；须同时开启 Runtime `apps.codocs.snapshotV2Enabled`）。仅 `private` 文档走 v2，其余类型仍 v1。保存：读发布头（代次/epoch）→ prepare → 上传到 `<prefix><32 位随机尝试目录>/body.md`（每次尝试新 key、`forbidOverwrite`，不会二次写同一 key）→ publish（与 prepare 同一 Idempotency-Key）→ 标题变更经 v1 纯元数据命令（派生键 `<key>:title`）→ 派生镜像。重试：上传失败时发布头未变，同命令重放 prepare 后换新尝试目录；发布成功但响应丢失时，重建命令与键不符（`snapshot_key_conflict`），Host 读发布头，若当前已发布正文的 SHA-256 与长度与本次一致则按已成功重放返回，否则按代次冲突 409 返回且保留用户内容。派生镜像写入 `oss_path` 并带 `x-oss-meta-hzy-snapshot-generation`，写后回读发布头，若已有更高代次则镜像更高代次（最多 3 轮），失败不影响已提交结果，响应 `mirrorPending: true`。读取：`private` 文档且开关开启时，发布头 generation>0 即按精确版本读取并核对长度与 SHA-256，绝不回退派生副本；其余走原路径。hzy0 错误过滤放行 `snapshot_generation_conflict`、`document_on_snapshot_v2`（409）。测试 `enterprise/test/codocs-snapshot-v2.test.mjs`（开关、单次上传与精确发布、丢失响应重放/冲突、冲突与上传失败不发布、缺编辑权限、精确读校验、镜像追上更新代次与失败上报）；Enterprise 194 项、hzy0 84 项通过。

3. **历史版本（已实现）**：`document_versions` 新增可空列 `object_key`（canonical schema 与未安装的 `20260920_document_snapshots.sql` 同步 `ALTER`）。v2 发布在同一事务内追加一条历史行（精确对象 key、provider 版本、摘要、长度、编辑者），历史列表因此自然包含 v2 保存；Host 历史读取对有 `object_key` 的行按该 key 精确读取（限 `codocs/snapshots/` 前缀），v2 行缺失返回 404 而非“超过 30 天”。
4. **项目移交（已实现）**：v2 文档（开关开启且发布头 generation>0）移交时 Host 复制精确已发布正文、不复制旁边的旧 `.yjs`；Runtime 移交事务内删除该文档发布头（文档转为项目文档后退出 v2，prepare/publish 拒绝非私人文档，发布头不会复现），历史行保留 `object_key`。部门移交只建共享、不复制正文，部门读取者读派生副本。隔离 MySQL 与 Host 合同测试覆盖。

5. **派生副本读修复（已实现）**：Host 读取 v2 文档时已持有精确正文，随即 HEAD 派生副本，若缺失、未带或带有较旧的 `hzy-snapshot-generation` 则重写（写后回读发布头防止旧代覆盖新代），失败不影响读取。未被打开且镜像失败的文档，其派生副本在下次保存或打开前保持旧内容；不另设批量扫描任务。
6. **页面提示（已实现）**：文档页保存遇 `snapshot_generation_conflict` / `document_on_snapshot_v2` 时提示“文档已在别处更新 — 本次修改未保存，内容仍保留在编辑器中，请复制后刷新再保存”（warning），不再显示通用“保存失败”。协作被拒只出现在旧独立 Codocs 界面（Host 不开协作会话），本阶段不改旧界面。

**阶段 A 剩余（启用前）**：目标库安装快照表；真实测试桶端到端（保存、重试、并发冲突、镜像、旧读取者可见、v1 写入口被拒）与目标环境 grant/保留核验。

### 阶段 A 实测（2026-09-24，hzy0 + 本机测试 Runtime，用户批准）

环境：`hzy_codocs` 备份后安装快照两表与 `document_versions.object_key`；本机测试 Runtime `0.3.219-test.codocs-snapshot-v2.1`（`900fbf0e`）开启 `apps.codocs.snapshotV2Enabled`；hzy0 profile 新增受校验的 `features.codocsSnapshotV2=true`（仅 hzy0 Host；云端测试 Host 仍关闭，照旧 v1）。保留检查：版本控制 Enabled，`codocs/snapshots/` 写一次保留成立。

真实浏览器会话（`test`，经 Gateway → Host → Runtime → OSS），新建私人文档“v2 E2E …”：

| 检查 | 结果 |
| --- | --- |
| 新建与首次读取 | 200，generation 0，正文一致 |
| 保存 A | 200，generation 1，`mirrorPending: false` |
| 同键同内容重试 | 200，`replayed: true`，未重复保存 |
| 3 个并发保存 | 1 个 200（generation 2），2 个 409 `snapshot_generation_conflict` |
| 保存后读取 | generation 2，正文与胜出保存一致 |
| 保存并改标题 | 200，generation 3，标题已更新 |
| 历史版本 | 3 条 v2 行；打开最新一条正文 SHA-256 一致 |
| 数据库 | 发布头 generation 3、epoch 0；已发布候选 3；落败并发留下 2 个已准备未发布候选（其上传对象无引用，待受控清理） |
| 派生副本（只读工具 `--latest`） | 46 字节，`hzy-snapshot-generation=3`，SHA-256 与最后一次保存一致 |
| 暂关 Host 开关后 v1 保存 | 正文保存 409 `document_on_snapshot_v2`，正文未变；纯标题保存 200 |

实测发现并修复：① hzy0 出站白名单未批准 `codocs:personal-documents:create`，hzy0 无法新建文档；已加入该精确能力（Console 已有授予）。② Host 把 Host 专用参数 `skip_content` 转发给 Runtime `view`（只接受 `include_deleted`），导致 v2 保存、**既有的历史版本查看与项目移交**在真实环境返回 400（桩测试未发现）；三处均改为空 query，并在移交、版本测试中断言。未实测：项目移交（`test` 在目录中无参与/管理项目，Host 按设计拒绝；Runtime 退出 v2 与 Host 精确复制由隔离 MySQL 与合同测试覆盖）；协作编辑（Host 不开协作会话）。

**页面实测（2026-09-24，Orca 内嵌浏览器，`test`）**：真实编辑器中输入后按 Cmd+S，经页面自身保存逻辑由 generation 3 → 4，正文含输入内容，状态显示“已保存”；令页面下一次保存收到真实的 409 `snapshot_generation_conflict` 响应，页面显示“文档已在别处更新 — 本次修改未保存，内容仍保留在编辑器中…”（warning），编辑内容保留、状态“未保存”，不再出现通用“保存失败”；版本面板顶部显示“历史版本被新版本替换 30 天后…”说明，并列出 4 条 v2 版本（含查看/差异）。


## 阶段 B 设计：协作接入 v2（2026-09-24；D3 互斥、D4 新建 `collab.runtime`、D5 仅覆盖 v2 文档均经用户接受）

### 阶段 B 开始前的基线

- Collab 默认内嵌在 Console（亦可独立运行），经 Codocs Runtime 取文档上下文、记版本；调用 Runtime 用环境变量中的**静态 Bearer token**（`COLLAB_CODOCS_RUNTIME_TOKEN` 等）。根规则只允许静态 token 用于明确的离线兼容部署，托管/共享环境须用 Console 签发的短期 `token_use=service` JWT。
- 浏览器连接 Collab 用旧 Codocs 服务端签发的短期 HMAC 协作 token；**Host 尚不签发协作 token、不开协作会话**。Host 只对“已核验私人且未共享”的文档开 HTTP 编辑，共享文档在 Host 只读。
- 阶段 A 后：v2 文档一旦共享，Host 只读、旧协作拒绝打开（`document_on_snapshot_v2`），**共享的 v2 文档当前无处可编辑**。阶段 B 解决此问题。
- Collab 存储直接用 `ali-oss` 同 key 覆盖 `.yjs`/`.md`，不经 Foundation 写一次保护。

### 目标流程

1. **打开协作（Host）**：写权限用户在 Host 打开共享的 v2 文档时，Host 以已验证会话调用 Runtime `collaboration-open`（精确能力，edit permit，签名 actor）。Runtime 在文档行锁下创建/续租会话记录（文档 UUID、当前 generation、epoch、发起人、到期时间），并为该用户签发一次性准入票据（见下“按 ADR-020 调整”），浏览器凭票据连接 Collab。
2. **加载（Collab）**：Collab 用自己的服务身份调用 `collaboration-snapshots:read`（带会话 ID）。已发布快照含 Yjs 时载入同代 Yjs；只有 Markdown（来自 HTTP 保存）时由该 Markdown 初始化**新的** CRDT 历史，不读旧 `.yjs`。
3. **保存（Collab）**：Collab 从同一 Y.Doc 生成 Markdown 与 Yjs，调用 `collaboration-snapshots:prepare` → 上传到返回前缀下的新尝试目录（写一次）→ `collaboration-snapshots:publish`（带会话 ID、期望 generation/epoch、配对对象）。Runtime 核对会话有效、epoch 一致、发起人（或会话内任一写者）当前仍有写权限，原子发布配对并写历史行；之后 Host 派生镜像沿用阶段 A 读修复。
4. **结束/失效**：会话到期或 Collab 关闭文档时释放；撤销共享、移交、Host 普通保存等使 epoch +1，旧会话的发布一律拒绝，Collab 断开客户端并需重新打开。

### 需要你决定

- **D3 普通保存与活动协作的关系。** 推荐：**互斥**——文档存在活动协作会话时，Host HTTP 保存返回 409“正在协作编辑”（共享文档本就走协作）。备选：HTTP 保存推进 epoch 使协作会话失效（会中断正在协作的人）。
- **D4 Collab 的服务身份。** 推荐：**新建专用服务客户端 `collab.runtime`**，精确能力 `codocs:collaboration-snapshots:read` / `codocs:collaboration-snapshots:publish`，Console grant 种子与核验、契约测试同批交付；弃用静态 token（测试环境切换后）。备选：内嵌时借用 Console 身份（不推荐：来源应用混淆，违反 `source_app` 规则）。
- **D5 范围。** 推荐：阶段 B **只覆盖已在 v2 的文档**；旧 v1 文档继续走旧协作，v1→v2 转换另列阶段 C。

### 交付拆分（审阅通过后）

1. Runtime：会话表与 `collaboration-session:open/renew/close`、`collaboration-snapshots:read/prepare/publish` 路由（默认关闭，复用阶段 A 发布事务与 verifier，epoch 语义生效）；隔离 MySQL 测试（互斥、epoch 失效、撤权、并发发布、重放）。
2. Console：`collab.runtime` 服务客户端与精确 grant 种子/核验（两处 audience 按规则核对），契约测试（正确调用、缺能力、错 audience、错来源、错 tenant/deployment、过期、写幂等重放）。
3. Collab：服务 token 获取（Foundation helper）、v2 加载/保存，快照字节经 Runtime 写一次上传及精确版本下载；旧路径保留给 v1 文档。
4. Host：协作会话打开与协作 token 签发、Gateway/Caddy 的 WebSocket 路由（hzy0 与云端），文档页对共享 v2 文档启用协作编辑。
5. 环境：测试环境 grant 与服务令牌签发探测、端到端（两人同时编辑、断线重连、撤权踢出、HTTP 保存被拒、历史与镜像）。

### 按 ADR-020 调整（2026-09-24，用户同意）

阶段 B 继续使用现有 Node Collab，但下列要求与引擎无关，现在即落实，使将来 [ADR-020](./ADR-020-Ygo-Collab-Connector-Runtime-Integration.md) 的 ygo/Connector 模块可直接复用同一 Runtime 合同：

1. **准入不用长期共享密钥（ADR-020 §5.1）**：取代“Host 用共享 HMAC 密钥签协作 token”。Host 为每位已验证用户在 Runtime 创建**短期、一次性准入票据**（绑定会话、文档、用户、读写模式，存哈希，约 60 秒有效）；浏览器把票据交给 Collab，Collab 在 WebSocket 升级/首帧认证时以 `collab.runtime` 身份向 Runtime **兑换**，兑换成功前不加载、不发送任何文档状态。票据不可重放，不放入可记录的通用 Access Token。
2. **权限变化作用于已建立连接（§5.2）**：Collab 以固定短间隔（≤60 秒）续租会话。Runtime 的准入、读取、续租响应均带当前会话 `expiresAt`；明确拒绝立即关闭房间，暂时故障只允许在最后一次确认的到期时间内重试，超时即断开客户端。续租单飞且有超时/中止，关闭后的迟到响应不得恢复租约。Runtime 侧撤销与 epoch 推进已实现。
3. **协作保存的作者（§6.4）**：每位参与者都兑换自己的票据，Runtime 记录会话的已验证参与者；每次协作发布把该会话参与者集合记入审计与历史，不把发起人或最后在线者当作全部编辑的作者。

### 环境事实（2026-09-24 查明）

- hzy0：hzy0 Console 的内嵌 Collab 被 `CONSOLE_COLLAB_MODE` 关闭，hzy0 目前没有协作运行时；阶段 B 在 hzy0 验收需先确定 Collab 运行方式（启用内嵌或独立进程）并在 hzy0 Gateway 放行 WebSocket 路径。
- 云端测试：Tenant Gateway 将 `/codocs/ws` 与 `/collab/*` 转发至独立 Collab Worker（`hzy-collab-codocs-poc`，Durable Object provider）。
- 协作 token：HMAC，密钥 `COLLABORATION_AUTH_SECRET` 由旧 Codocs 服务端（签发）与 Collab（校验）共享，另有开发回退密钥。阶段 B 改为 Host 签发时，密钥来源须进入 Console 集成配置/凭证保险箱，生产与共享环境不得使用回退密钥。

### 阶段 B 进展

1. **会话与互斥（已实现，默认关闭）**：新表 `document_collaboration_sessions`（迁移 `20260924_document_collaboration_sessions.sql`，同步 canonical schema；未安装任何环境）。`OpenCollaborationSession` 在文档行锁与发布头锁下为写权限用户打开或续租会话（租期 5 分钟，同 epoch 复用），文档未在 v2 时返回 409 `document_not_on_snapshot_v2`（D5）。Host 的 v2 prepare/publish 在同一锁下检查当前 epoch 的活动会话，存在即 409 `document_collaboration_active`（D3）；租期过期后恢复。Host 路由 `personal-documents:collaboration-open`（精确 edit、签名 actor、空请求体）仅在 `apps.codocs.snapshotV2Enabled` 与新开关 `apps.codocs.collaborationV2Enabled` 同时开启时登记；Foundation 已登记操作。隔离 MySQL 覆盖：v2 前拒绝、打开与复用、会话期间 Host 保存被拒、租期过期后可保存、只读共享者不能打开；路由测试覆盖精确 permit、空请求体与双开关；完整 Go 测试通过。

2. **Collab 侧 Runtime 与身份（已实现，默认关闭，未写环境）**：路由 `/v1/codocs/collaboration-snapshots:{read,prepare,publish,renew,close}`（`server/codocs_collaboration_snapshots.go`），严格服务令牌（目标 `codocs`、来源 `collab`、精确能力，`read` 用 `codocs:collaboration-snapshots:read`，其余用 `:publish`），固定 `collab.runtime` 客户端与 `deploymentBindings.collab` 部署，并做实时凭证/授权核验；与会话路由同受双开关控制。每次调用绑定活动会话：Runtime 以会话发起人身份代行并在文档行锁下复核其写权限；Collab 写入必须是 Markdown+Yjs 配对，且会话在当前 epoch 有效；Collab 幂等键使用独立命名空间。Host 普通保存仍按 D3 在会话活动时被拒。共享权限修改/删除与项目移交在同一事务内推进 epoch 并撤销活动会话，迟到的 Collab 发布被拒。`codocs/app.manifest.json` 声明 `collaboration-snapshots`（read/publish），Host 组合 manifest 已重新生成。`deploy/test-env/collab-registration.mjs`（plan / 只读 verify / 显式事务 apply，不签发凭证、不复活撤销记录、能力须在 manifest 声明）；对本机测试 Console 仅执行 verify：客户端与两项授权均缺失，**未 apply**。隔离 MySQL 覆盖完整协作回合（会话代行发布配对快照、无 Yjs 被拒、续租、共享变更撤销会话后迟到发布与续租被拒、新 epoch 重开、关闭后 Host 可保存）；注册脚本测试 4 项；完整 Go 测试通过。

3. **一次性准入票据与参与者（已实现，默认关闭）**：同一迁移新增 `document_collaboration_tickets`（只存 SHA-256，60 秒有效，一次兑换）、`document_collaboration_participants` 与 `document_collaboration_publications`。Host `collaboration-open` 在同一事务内为已验证用户签发票据并随响应返回一次；Collab 经 `collaboration-snapshots:admit`（`collab.runtime`、`:read` 能力）兑换，兑换在锁内核对会话活动且 epoch 与发布头一致，成功后记录参与者，失败一律拒绝（重放、未知、过期、会话已撤销）。协作发布在同一事务内记录会话参与者集合。隔离 MySQL 13 个子测试与完整 Go 测试通过。

4. **Collab 服务（已实现，默认关闭）**：`collab/src/utils/v2-snapshots.ts`，开关 `COLLAB_V2_ENABLED`（默认 false），凭证为 `collab.runtime`（`COLLAB_SERVICE_CLIENT_ID/SECRET` + Console token URL），经 Foundation 新增的 `createStandaloneServiceTokenClient` 获取精确 scope 的服务令牌，不使用静态 Runtime token。浏览器以 `v2.<票据>` 作为连接 token；Collab 在认证钩子中先兑换票据并核对文档一致，之后才加载。加载按发布头精确版本读取并核对长度与 SHA-256：有 Yjs 则载入同代 Yjs，否则由已发布 Markdown 建立新 CRDT 历史。保存由同一 Y.Doc 生成 Markdown 与 Yjs，以确定性幂等键 prepare，上传到新尝试目录（写一次），再配对 publish；不对非空内容发布空正文。Markdown 与 Yjs **两项摘要均未变**才跳过发布，只有已发布回执才能推进 `lastStored`。准入/读取/续租均提供已确认的 `expiresAt`；Runtime 拒绝（401/403/404/409）立即关闭该文档全部连接，暂时性故障只能在该期限内重试，期限到达则关闭并停止写入；续租单飞，超时中止，关闭后的迟到结果忽略。文档卸载时关闭会话。v1 文档与旧 token 路径不变。Runtime 读取另返回 Yjs 长度与摘要。原阶段 B 离线测试记录为 Collab 12 项；本轮 N3/N4 回归见后续回执。

5. **Host 会话接线（代码已实现，默认关闭，未做环境验收）**：`POST /codocs/api/documents/{uuid}/collaboration` 在两个 v2 开关同时开启时，以 Enterprise 当前用户及 Codocs `documents:edit` 权限打开精确 Runtime `personal-documents:collaboration-open`，只向当前用户返回 `v2.<一次性票据>`，响应 `no-store`。Host 文档页仅对已核验有共享关系的私人文档连接 `/codocs/ws`；每条新 WebSocket（含自动重连）重新领取票据。同步且具有 read-write scope 后才解锁编辑；协作失败不回退 HTTP 覆盖。Host 共享文档的自动保存、源码模式、快捷键、离页与隐藏页均不发送正文 PUT，离页只刷新 Y.Doc 镜像；标题暂锁定。旧协同文档列表保持原合同。代码回归：Codocs provider 断线换票据、页面离页保护，Enterprise 会话开关/缺权/精确 permit/无效响应与 API 就绪；两模块完整测试和 typecheck 通过。Codocs 受影响文件 lint 通过，全模块 lint 仍有无关存量错误。

6. **hzy0 本机路由与进程脚手架（代码已实现，默认关闭）**：本机 profile 只在 snapshot v2 与 collaboration v2 双开关、local Console facade、固定 `127.0.0.1:23131` 同时满足时接受 Collab。独立 `hzy0-collab` 仅从私有 profile 旁的 owner-only 0600 `collab-client-secret.json` 读取 `collab.runtime` 服务客户端密钥；不继承 Gateway/DB/Console 主密钥，也不持有 OSS 材料；缺文件或不安全则拒绝启动。Gateway 只将 `/codocs/ws` 的同源 WebSocket 升级送往 Collab，移除 Cookie/Authorization/内部凭据；普通 HTTP 426，默认关闭 404。隔离配置、升级与运行器测试通过；私有 profile 未开启协作。

7. **本轮只读环境核验**：`collab-registration.mjs --verify` 显示 `collab.runtime` 未激活、无当前凭据指针、缺 `codocs:collaboration-snapshots:read/publish` 两项授权，令牌签发未验证。只读核对本机 Runtime 配置与 `information_schema`：snapshot v2 已开，collaboration v2 未开、`deploymentBindings.collab` 缺失、四张 `document_collaboration_{sessions,tickets,participants,publications}` 表均不存在。私有 hzy0 profile 的 snapshot v2 已开，collaboration v2 与 Collab 监听尚未配置。本轮未执行迁移、grant apply、凭据写入、环境开关、进程重启或业务数据写入。

8. **C000001 本机测试环境推进（2026-09-24，用户续行授权）**：全量 Go 测试通过。确认固定 Runtime/Console 库与 MySQL `server_uuid` 后，先将 `hzy_codocs` 全库备份到私有 `database-backup/hzy_codocs-before-collab-v2-20260924T023654Z.sql`（SHA-256 `0b74ee0bc5177b978fc75ec6447fba4b8050945c31da06d1c5f10fe168ab73f6`），再安装四张协作表并核对 InnoDB 表名；未更改业务行。`collab-registration.mjs --apply` 登记独立服务客户端及两项精确 grant，`--verify` 显示无缺项/额外 active grant。按既有测试客户端的哈希校验合同签发独立随机服务密钥：Console 仅存 `sha256-only` 哈希，明文只落在私有 hzy0 目录的 0600 `collab-client-secret.json`，未打印。Runtime 二进制从已运行的阶段 A 哈希 `f7d969a1…` 升至 `0.3.219-test.codocs-collab-v2.1`（SHA-256 `739379409488bd00f6bcbf4f70bafad7624711ab13b4c005703e24b26be76366`），先以 LaunchAgent 的六项环境做启动探测，备份原二进制后重启；本机 health 为 `ok`、Codocs DB 为 `ok`、版本/部署绑定正确。随后备份 Runtime 配置至私有 `config.before-collab-binding-20260924T025312Z.json`，只新增 `deploymentBindings.collab=C000001-test-collab`，启动探测和重启健康检查再次通过。Runtime 与 hzy0 协作开关仍关闭，真实协作未开放。

9. **令牌与存储决策**：直接向本机 Console `127.0.0.1:23100` 请求服务令牌返回 403 `Local Console facade context rejected`，因为它要求可信 Gateway 上下文；公网规范 Console 地址返回 Access HTML，不能当作令牌。已在默认关闭的 hzy0 Gateway transport 增加精确的本机 Collab token 桥接：只接受固定 Host/POST、客户端密钥、`data-runtime` 和两项协作 scope，注入固定 Collab 部署上下文，隔离测试通过。Gateway 与 Collab 只读同一私有 0600 `collab-client-secret.json`，不读取 OSS 材料。用同一受信上下文对真实本机 Console 签发探测：`codocs:collaboration-snapshots:read` 与 `:publish` 各返回 200，解码后逐一核对 `token_use=service`、`source_app=collab`、tenant、deployment、audience 和单项 scope；未打印令牌。按当前关闭的私有 profile 重启 hzy0 Gateway 后，进程 online，`/enterprise` 返回 200、`/codocs/ws` 与本机 token 桥接均保持 404。测试 Console 的 `oss.default` 凭据在 Vault 中为 `reveal_policy=deny`；现决定由 Runtime 用其 vault 绑定凭据读写 v2 快照字节，不解出或复制到 Collab。协作开关仍关闭。

### hzy0 阶段 B 启用顺序（待单独授权的环境操作）

1. 先核对目标 Runtime/Console 实例与备份，再安装 `codocs/docs/migrations/20260924_document_collaboration_sessions.sql` 并确认四张表。该迁移含 DDL，不能当作事务回滚；失败时保持所有 collaboration v2 开关关闭，按备份与迁移结果处理，不盲目重放。
2. 在固定的 C000001 测试 Console 执行 `collab-registration.mjs --apply`，随后 `--verify` 必须显示 active 的 `collab.runtime` 与两项精确 grant 且无意外 active grant。注册脚本不创建凭据；当前 `deploy/test-env/provision-product-clients.mjs` 固定另一台服务器和另一套库，不适用于 hzy0。
3. 受控登记独立服务客户端凭据，仅保存在私有 profile 同目录、owner-only 0600 的 `collab-client-secret.json`；Runtime 使用 vault 绑定的 `oss.default`，不得将其 OSS 凭据交给 Collab。启用前须在 Platform 部署绑定中登记 `collab` 的精确部署，并核对 Runtime 生效的 `deploymentBindings.collab`：当前 overlay 会整体替换 `deploymentBindings`，仅在 `config.json` 中配置的 `collab` 绑定会丢失。用真实客户端分别探测两项精确 scope 的 Console `data-runtime` 令牌签发与 Runtime 鉴权。C000001 已完成服务登记与签发探测；部署绑定须按上述前置条件重新核验，新对象路由上线前还须核验目标 Runtime 构建与读取/写入合同。
4. 开启本机 Runtime `apps.codocs.collaborationV2Enabled`，验证路由与服务身份；其 snapshot v2 开关继续保持开启。然后在私有 hzy0 profile 添加 Collab loopback 监听并开启 `features.codocsCollaborationV2`，执行 CLI `plan`/`doctor` 预检和受控进程重启。先核对本机 Gateway 的 Collab token 桥接可供独立进程调用，再开放浏览器协作入口。
5. 以两个有权限的真实测试用户验收同一 v2 私人共享文档：同时编辑与配对发布、断线换一次性票据重连、撤权后断开与迟到发布被拒、活动会话期间 HTTP 保存 409、会话关闭后 HTTP 保存恢复，以及历史版本与派生镜像。检查无凭据和正文进入日志；任一环节失败即关闭 Host/profile 与 Runtime 的 collaboration v2 开关，保留现场证据排查，不用旧静态 token 绕过。

**下一步**：hzy0 已完成 schema、服务注册、独立客户端凭据与两项精确令牌签发探测；`collab` 绑定曾在静态配置中登记，须按上述 Platform 部署绑定前置条件重新登记并核验生效值。Runtime 对象字节路由需构建、审查、获准后部署，再开启 Runtime/Host/Collab 开关并完成两人协作、断线重连、撤权与 HTTP 冲突端到端验收。云端现有 Collab Durable Object 仍仅支持旧 HMAC 准入，v2 票据需另行接线。开关保持关闭，不发布云端。

**用户决定（2026-09-24）**：先保留 Collab 默认关闭。随后同意 v2 Collab 不持有任何 OSS 密钥、快照字节由 Runtime 读写。本机 Runtime `apps.codocs.collaborationV2Enabled` 与 hzy0 profile `features.codocsCollaborationV2` 保持 `false`；新 Runtime 构建仅作离线准备，不安装、不重启、不做环境写入。已完成的测试环境准备工作保留；两人端到端验收和云端发布暂不执行。

### 阶段 B 存储改线（2026-09-24；代码候选，未部署）

- 决策：v2 Collab 仅持有 `collab.runtime` 服务客户端密钥，不接收 OSS 密钥。它以现有精确 `codocs:collaboration-snapshots:publish` 调用 Runtime `POST /v1/codocs/collaboration-snapshots:upload`，以 `codocs:collaboration-snapshots:read` 调用 `:download`；没有新增 capability/grant。Runtime 经 Console 集成与 Vault 解析 `oss.default`，符合 [ADR-020 D06](./ADR-020-Ygo-Collab-Connector-Runtime-Integration.md) 的存储适配边界，也避免向 Collab 再分发一份长期 OSS 凭据。
- 上传要求活动会话、同一 Idempotency-Key 已 prepare 且命令摘要一致、Markdown 与 Yjs 配对命令、上传字节与声明长度及 SHA-256 一致；对象键由服务端固定为候选前缀 + 32 位小写十六进制随机 attempt + `body.md`/`state.yjs`。每对象最多 16 MiB，Markdown 仍受快照命令 10 MiB 限制。Runtime 对目标键先 HEAD 要求 404，PUT 签入 `x-oss-forbid-overwrite:true`，必须取得有效版本 ID。下载仅限当前已发布 head 的精确对象版本，读取后重验长度与摘要；Collab 再对照此前 head 重验。
- 剩余风险：当前测试 bucket 开启版本控制，OSS 在这种 bucket 上忽略 `x-oss-forbid-overwrite`。HEAD 与每次随机 attempt 降低碰撞，但同一键的并发请求可能同时越过 HEAD；这不是 provider 级原子防覆盖。生产专用、从未开启版本控制的 bucket 可使防覆盖头生效，但当前 Runtime 上传/发布还要求非 `null` 的精确版本 ID；这两个条件是否可在目标 OSS bucket 同时成立未获实测证明，不能据此宣称生产可发布。生产切换前必须证明版本 ID 与写一次条件同时满足，或另行变更精确引用合同并复核。
- 本机候选构建：`0.3.220-test.codocs-collab-storage.1`，darwin/arm64，SHA-256 `1322d8ae1f6c02cb1299a57540bb9369334a25d1f4866d3fccf4eacc31634340`，仅存 `.git/codex-builds/codocs-collab-storage-20260924/hzy-data-runtime`，未安装。复核通过 `go test ./...`、Collab 13 项及 typecheck、hzy0 定向隔离 3 项；未以实际 LaunchAgent 环境做启动探测，未写配置、替换运行二进制或启用开关。提交后应从已提交源码重新构建并核对哈希，再按测试 Runtime runbook 执行启动探测与受控切换。
