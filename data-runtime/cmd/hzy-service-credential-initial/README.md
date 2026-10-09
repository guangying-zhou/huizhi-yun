# 生产 Collab 初始凭据装配

仅在 Runtime 主机以 root 运行。先完成 Console `collab.runtime` 登记及两条 active qualified grant；参数与 Runtime 配置、部署绑定、Console 企业资料及 grant 必须完全一致。命令不创建 client、grant，不恢复停用身份，不轮换已有凭据。

```sh
hzy-service-credential-initial \
  --config /etc/hzy-data-runtime/config.json \
  --tenant C000001 --deployment C000001-collab \
  --client-id collab.runtime --environment prod \
  --approval-id USER-20261007-COLLAB-INITIAL \
  --target-env /etc/hzy-data-runtime/collab-credentials/initial.env
```

先创建 root:root 0700 的 `collab-credentials` 目录；所有祖先必须为 root 所有、不可由组或其他用户写入、不是软链。配置为 root 0600 普通文件。目标文件必须不存在；写入通过同目录临时文件、fsync 和原子 link 完成，绝不覆盖。不存在 `--rotate` 行为；需要轮换时另走受审轮换流程，不将初始命令扩成轮换工具。

文件包含 `HZY_SERVICE_CLIENT_COLLAB_SECRET` 与 `COLLAB_SERVICE_CLIENT_SECRET`，值相同。Runtime 与 Collab 的 systemd 单元都通过 `EnvironmentFile` 读取这个 root 0600 文件；不能将值复制到命令行、日志或报告。数据库使用既有 Vault `env_ref`，只保存引用名与 secret 哈希；不存明文或密文。随机生成、哈希、client 锁行、凭据指针及 Vault 审计均复用 `EnsureInitialServiceCredential`。

重复执行创建时，目标存在即拒绝；添加 `--verify` 只读核对文件、身份和凭据哈希，不更新凭据或审计。审计 actor 为 `initial-enrollment:<approval-id>`，批准标识是关联线索；本机 root 权限是此命令的执行边界。

## 失败恢复

文件在 DB commit 前落地。任何失败都停止；若文件已落地但 commit 失败或连接中断，不自动删除文件或重发凭据（commit 结果可能不确定）。先运行 `--verify`：通过则无需重建；不通过则保全文件和备份，经审查核对 DB 状态后恢复。本命令不自动覆盖孤儿文件。

首次装配必须先加密备份 Console 相关表及单元/env。部署过程中 Runtime 与 Collab 必须读取同一文件；在真实签发与两项 capability 消费探针通过前不开协作。回滚使用装配前备份与已冻结行差集，不删除其他身份，不借用 OSS 或运行凭据。
