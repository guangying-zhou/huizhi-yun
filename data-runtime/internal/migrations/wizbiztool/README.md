# WizBiz 离线迁移工具

仅在 Runtime 主机、停机迁移窗口内执行写模式。工具不读取 dotenv、数据库凭据环境变量，不访问 OA、Platform 或 HTTP 服务。

## 输入与输出

所有输入为本人持有、无软链的 0600 文件。`--out` 必须是尚不存在的路径；执行前独占创建回执文件，失败时保留固定错误码和已完成阶段。标准输出仅给模式、状态、计数或 review hash。profile 内的审批记录用于关联用户批准，不代替主机和文件权限。

```sh
hzy-wizbiz-migrate --mode stage-verify --profile PROFILE --snapshot-manifest MANIFEST --out STAGE_RECEIPT
hzy-wizbiz-migrate --mode plan --profile PROFILE --snapshot-manifest MANIFEST --stage-receipt STAGE_RECEIPT --identity-confirmed IDENTITIES --out PLAN
```

`apply/verify/rollback/status` 使用相同输入，另带 `--plan PLAN --review-hash HASH --out NEW_RECEIPT`。plan 附带字段覆盖矩阵；plan 不包含姓名、电话和账号明文。

apply/rollback 逐块检查 Runtime 已停止且不会自动启动、配置绑定与 generation 不变，并持有统一库迁移互斥锁。每块最多 200 单位。失败不自动回滚；重用原 plan/profile/hash 续行，已写行逐对象重新核对，阶段摘要不符则停止。verify 是只读操作，成功回执是验证证据，不把数据库批次状态改成 verified。

## 银行账号

- synthetic：源账号列不读，测试材料为确定性的 WIZBIZ-TEST 前缀。
- forbidden：有账号的银行账户阻断，不写 Vault。
- real：需 profile 精确审批记录；材料仅在内存。借助 Runtime 受保护配置的 Console Vault adapter 进程内写 custody 密钥，先成功创建/复用密钥，再写统一库。

Vault 的数据库身份须非 root，库名与 server UUID 精确符合 profile。银行账户 custody 预览仅保留末四字符，其他类型的通用预览不变。引用、密文与历史版本保留；回滚仅停用本批新建且未轮转的密钥。不存在账户的同批密钥会使 verify 失败，rollback 可再次执行并收口。

## 期初应收

同一 profile、源快照和主 plan，另提供 0600 财务确认文件：

```json
{
  "batchCode": "MAIN-opening",
  "mainReviewHash": "MAIN_REVIEW_HASH",
  "snapshotSha256": "MANIFEST_SHA256",
  "approver": "FINANCE_APPROVAL_ID",
  "date": "YYYY-MM-DD",
  "contracts": [{"sourcePk": "1", "amount": "20.00", "dueDate": null}]
}
```

- `opening-plan`：带 `--plan MAIN_PLAN --opening-confirmation CONFIRMATION`，重新独立验证主批次，输出自己的 plan/review hash。未列合同不生成；采购、非正候选、重复源键或未知合同拒绝。确认覆盖候选的差异在 plan 逐行列出。
- `opening-apply/opening-verify/opening-rollback`：再带 `--opening-plan OPENING_PLAN --review-hash OPENING_HASH`。写入固定为 historical_import/manual/opening_balance，编码 BS-W + 源主键左补零六位；不派生催收负责人或到期日。
- 期初应收批次先回滚，再回滚主批次。被核销、发票、调整或其他对象引用、或整行摘要已变的期初项保留；无 force 开关。映射、台账、审批证据保留。

## 隔离测试

```sh
node data-runtime/scripts/test-wizbiz-tool-mysql.mjs
```

runner 自建 `/tmp/hzy-test-mysql-*` 的一次性 MySQL，合成源库、目标库和 Directory/Vault 库；结束时清理。可加一个 Go `-run` 表达式定位用例。没有真实环境访问或写入。

## 停机前全身份预检

先构建 `./cmd/hzy-wizbiz-migrate-preflight`，用与后续迁移完全相同的受保护 profile 和 manifest 在 Runtime 停止**之前**执行：

```sh
hzy-wizbiz-migrate-preflight --profile PROFILE --snapshot-manifest MANIFEST --phase migration
```

一次报告 profile、Runtime 配置绑定/构建证据、source、sourceMetadata、target、依赖定义、directory、Vault 九项，任何项失败仍继续核对其余身份，只输出固定检查名/代码和布尔状态；有缺口退出1。source 用 `LIMIT 0` 检查实际覆盖列（synthetic/forbidden 不包含账号列），metadata 独立核对同库 SELECT-only、全库结构和封存清单；target 复用 CheckTarget/CheckTargetPrivileges，directory 复用 ReadDirectory 并检查实际两表列权限；Vault只检查主密钥路径的存在性/权限与连接身份，不读密钥内容、不创建密钥、不写凭证。没有停止/创建账号/GRANT/写业务接口。

分阶段门禁：`--phase w1` 要求profile/Runtime绑定/source/metadata（外层还要求DDL）；其他项明确标为 `required=false, code=not_required`，不伪称通过。W1安装准备窗口完成后创建已获批的精确账号；`--phase migration`（默认）要求九项全部PASS，才停机apply。不能把缺账号、缺安装定义标为未来会成功，也不得预授权不存在的表。原apply的停止、锁、hash、权限和Runtime历史合同护栏继续实时复核，预检不是写入许可，也不能预先证明所有数据冲突或Vault后续写入一定成功。

Console目录连接必须单独提供，不能拿含写权限的Console运行账号代替SELECT-only连接。最小权限是Console库的`directory_users`、`directory_user_departments`两表SELECT，库/server UUID须与profile匹配；不得读取其他租户库。账号创建/重建须取得该环境批准。

### Runtime 主密钥解析口径

Runtime和工具复用 `config.ConsoleVaultMasterKeyFile` 与 `config.ResolveConsoleVaultMasterKey`：已配置的 `HZY_CONSOLE_VAULT_MASTER_KEY` 优先；否则 `HZY_CONSOLE_VAULT_MASTER_KEY_FILE`，最后才由 `HZY_DATA_RUNTIME_CONFIG_DIR`（默认 `/etc/hzy-data-runtime`）派生默认文件位置。JSON路径字段不改变Runtime口径，工具不加载dotenv。必须在Runtime主机使用与运行Runtime一致的受保护环境，只传现有文件路径/配置目录，不能生成新主密钥、另找一个密钥或复制到/tmp来绕过门禁。

hzy0当前LaunchAgent配置了FILE入口，传给工具的是该受信plist的文件路径和配置目录，不是密钥内容。预检只lstat本人持有的0600普通文件（非空、≤4096字节）与核对Console连接身份；apply内部按Runtime同一函数由受保护读函数加载现有材料，绝不回显。Literal入口只沿用Runtime现有进程环境，不能通过shell历史或日志传递；运行环境没有主密钥时必须停止。

### 停机前转换审计

在维护窗口之前使用同一受保护profile与封存manifest：

```sh
hzy-wizbiz-migrate --mode stage-transform-audit \
  --profile "$PROFILE" --snapshot-manifest "$MANIFEST" --out "$AUDIT"
```

AUDIT必须为新的0600文件。模式只读源/元数据，不连接目标/Directory/Vault、不停Runtime、不读取synthetic银行账号列；多类错误一次汇总字段名/固定类别/违规行数，不输出原始值或主键。exit0且ready=true才能进入窗口；exit1有blockers时先裁定，禁止修改源数据绕过。审计不代替目标依赖/冲突/全身份预检。联系人0映射NULL，源台账仍保留0；1..6原值，其它值拒绝。

### 脱敏门禁诊断与目标基线

plan 失败输出保留原固定错误码，并附固定 `check` 与 `object` 分类，例如 `migration_target_identity_invalid [check=registry_identity,object=registry]`。分类只由源码常量产生，不包含连接值、凭据、SQL、客户名或业务主键；`errors.Is` 仍可识别原错误。未知驱动错误不得直接回显。

目标基线的每个非 NULL SQL 值先按原始字节编码成小写 hex，再计算规范 JSON 摘要；NULL 保持 NULL。此口径支持回执等表的二进制摘要列，且不把无效 UTF-8 替换成字符。独立 verify 使用独立实现复核，源封存行的规范序列化及黄金向量不变。采用此前基线编码生成的 plan 必须重新生成、重新核对 reviewHash，不能复用旧计划继续写入。

apply 只对已核验且不可变的源快照建立内存主键索引，按表和源主键定位原行；空主键、重复主键或未声明表仍拒绝。字段声明每轮解码一次，块大小、事务、迁移锁、逐块停机/身份复核、原键续行与摘要不变。Vault 创建及目标插入失败只给固定权限、结构、必填、冲突等分类，不回显原错误。

### 回滚元数据清点

回滚在同一迁移锁与 Serializable 事务内复用表存在性、声明和引用列的元数据清点。逐对象引用行仍重新查询；同批对象的保留状态实时复核，不缓存引用判定。未知表仍按原闭集列检查，不能取得同批豁免。DDL 必须遵守相同的停机与迁移锁规则。CLI 30 分钟时限保持不变。


### 确定性数值 ID 与存量外部引用（2026-10-05 裁定）

存量 Aims 悬空引用不修改、不删除，记为数据质量项。plan 在同一只读快照中扫描 Runtime 登记物理表的数值引用列及声明指向迁移目标 `id` 的外键；至少覆盖 `aims_aims_projects.contract_id`。每个自增数值 ID 目标按 `max(目标既有 MAX(id), 全部外部引用最大值)+1` 开始，按 `source_table/source_pk/map_role` 的字典序分配。目标列类型上界不足时阻断，显式 INSERT ID，不执行 ALTER AUTO_INCREMENT 或其它 DDL（引擎按正常 INSERT 推进计数不属于额外 schema 操作）。

plan 保存列类型、目标最大值、起点、逐对象 ID、引用表/列/主键定义、每行主键摘要与 NULL/数值快照；全部进入 reviewHash。apply 前复核快照，续行仅排除同批已冻结 seal 的自建行；既有或新增外部引用、元数据、目标 MAX 漂移均阻断。旧无分配快照的 plan 不兼容，必须重新生成并审核。

verify 独立重算起点与排序，核对实际存储 ID，并断言全部新 ID 与迁移前外部引用不相交。回滚继续遵守外部引用保留规则，不借避碰放宽删除条件。源业务编码、Vault secretRef 与所有源字段保全规则不变。

引用列闭集：客户 `customer_id/parent_customer_id/third_party_customer_id/converted_customer_id`；联系人 `contact_id/primary_contact_id`；合同 `contract_id/source_contract_id/parent_contract_id`；合同方 `contract_party_id`；银行账户 `bank_account_id/receiving_bank_account_id/paying_bank_account_id/account_id`；法人 `legal_entity_id`；余额流水 `account_balance_entry_id/balance_entry_id`；余额快照 `account_balance_snapshot_id/balance_snapshot_id`。声明外键补充列名不同的引用。`*_code`、uid、客户类型/等级 ID、contract_line_id、contract_project_link_id 属于其它命名空间，不据此引用上述目标 ID。
