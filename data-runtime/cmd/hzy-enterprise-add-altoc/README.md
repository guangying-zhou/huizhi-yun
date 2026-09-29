# 本机已激活统一库新增 Altoc 只读域

C000001/test 专用受控安装工具，不是启动迁移。来源 `altoc/docs/altoc_schema.sql`，固定十三表 FK 闭包与十三兼容视图。DDL 使用 `--migration-db-config <0600文件>` 的独立迁移账号；host/port/database 必须与受保护 Runtime 配置精确相同，Registry/UUID 仍复核。绝不把 DDL 权限授给 Runtime 或把迁移凭据写进运行配置。

## 边界

- proposed config 保留现有域，仅添加 altoc（owner=C000001-test-enterprise、read=unified、write/scheduler=disabled）。DB 回环，Runtime=127.0.0.1:18084。
- Registry tenant/environment/runtimeDeployment/schemaVersion/generation 精确匹配，非零 generation 不变。reviewHash 包含完整 Binding、DDL、全列视图、已有对象定义与数据多集合 SHA256。业务记录只在内存，计划仅保存摘要。
- 四种模式均持有同一会话迁移锁。apply 每条 DDL 前检查 Registry/停止事实；rollback 每条 DDL 前检查停止事实。
- 停止事实要求 launchctl print-disabled 的 cn.wiztek.hzy-test-runtime 明确 disabled（或旧版本 true）、print 明确 service 不存在、18084 不监听。必须先 disable 并 bootout，不能把健康探测失败视为停止证明。
- 不覆盖已有对象、不重置 generation、不关闭外键。新表与约束均加 altoc 前缀，按 FK 拓扑安装。
- DDL 非事务；逐 CREATE 持久化 0600 回执。失败保持 Runtime 停止，无自动回滚/启动。若 CREATE 成功而 checkpoint 失败，未知对象必须人工核对，不能猜测归属。

## 审后执行

1. 加密备份统一库、Registry、Runtime 配置/LaunchAgent、Console grant，确认可解密。
2. **先在统一库完整隔离副本演练**：独立 /tmp MySQL，完整导入备份，仅替换副本 UUID/物理库身份，tenant/deployment/generation 保持；apply→verify→标记样本→rollback→已有域摘要不变。核心接口注入隔离停止检查。基础空库测试不能替代此演练，严禁 DDL 连接源库。
3. 禁用并停止本机 Runtime，重新 plan。数据/配置有变化导致 hash 变化时核对原因并记录新审查依据，不沿用旧 hash。
4. 在 data-runtime 目录运行 `go run ./cmd/hzy-enterprise-add-altoc --mode plan --config <proposed> --plan <new-plan.json>`。
5. 执行 `--mode apply --config <proposed> --plan <plan> --review-hash <approved-hash> --receipt <new-receipt>`，随后同参数 `--mode verify`。二十六对象定义、十三视图 Runtime 规格、已有数据摘要和 Registry 均须通过。
6. v2.25 三项 grant：备份、差集、仅插缺失、verify、真实签发；G1 三行不重写。标记样本只写新 Altoc 表、逐 ID 清理台账。
7. 激活 proposed config；verify-views 155/155，另外核对十三预期视图确实存在，避免只扫描已有视图漏掉缺项。按 LOCAL_RUNTIME 构建、备份、启动探测，恢复/enable LaunchAgent，再本机/公网三次 health。
8. 十二页六资源列表/详情、1440/390、no-store、无写入口；zhou 正例，test 不新增权限，只验隐藏/403。owner/部门/催收隔离合同补足缺口。

## 显式回滚

停用 Runtime 后以原 plan/receipt 执行 `--mode rollback`，只删除已 checkpoint 且定义未变对象；外部 FK 或对象漂移拒绝。逆序删本批十三视图/表，含本批标记数据；绝不回退其它域数据。
恢复配置/LaunchAgent 备份，Registry 本工具从未写入，须与备份相同；若不同冻结并人工核对，不能静默覆盖。原142视图与既有数据摘要通过后再恢复旧 Runtime。新 grant 仅按本批精确 ID 停用；不动 G1、Platform 或云端。

## 验证（根目录）

```sh
python3 data-runtime/scripts/generate-altoc-domain-manifest.py --check
node data-runtime/scripts/test-enterprise-add-altoc-mysql.mjs
```

固定 CREATE 闭包生成物随 schema 变更一起审查，不执行原 schema DROP 或历史回填。

## 固定 Aims 删除证据表补装

同一命令增加 `--work-item-deletion-evidence`，只选择内嵌的单表规格；没有任意 manifest/DDL 输入。Aims 必须仍为 C000001-test-enterprise owner、read/write/scheduler=unified，保留其原有映射，只新增 `work_item_deletion_evidence→aims_work_item_deletion_evidence`。

复用同一停止检查、迁移锁、Registry/generation、reviewHash、既有域摘要、checkpoint、定义与外部FK拒绝、显式回滚核心。证据表与全列INVOKER视图共两个对象，原155视图不变，安装后156视图须以Runtime自身规格校验。移除本次新表之前必须额外确认表为空；有实际删除证据时禁止回滚DROP（保留证据，人工处理）。已有completion历史仍409，不因补表而允许删除。

生成物与canonical DDL一致性检查：`python3 data-runtime/scripts/generate-work-item-deletion-evidence-manifest.py --check`。隔离测试：既有Altoc演练仍应通过，完整统一库副本另做本批单表apply/verify/rollback。
