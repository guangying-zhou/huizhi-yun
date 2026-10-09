# WizBiz 补充迁移编排

`run.py` 用于已迁移 hzy0 的真实 Vault 升级与期初应收。参数文件必须受保护（0600），不包含明文账号；连接凭据只在保护配置中。Vault 主密钥沿用 Runtime LaunchAgent 的现有变量及 Runtime 解析函数，不生成新主密钥。

## 前置条件

1. 统一库和 Console 的当前加密备份已经完整解密流校验，记录 SQL 和密文 SHA-256。
2. 主迁移的四项业务差异已经正式用户审计和回执核对，补充计划重新核对证据并冻结当前基线。
3. 3318 暂存源账号的 `account_number` 列 SELECT 已逐环境获批，记录授权前后 SHOW GRANTS；真实升级完成后撤销该列并核对。
4. Runtime 与写服务已停止。副本使用独立 3320 mysqld 和独立 Runtime 监听参数，不停 hzy0。
5. runner 和工具 SHA 与已通过副本彩排的制品一致。参数文件指定 `toolSha256`、`runnerSha256`；每个写阶段前可用空间至少 20GiB。

## 顺序

```sh
python3 deploy/test-env/wizbiz-followup/run.py /protected/parameters.json
```

先 Vault plan/apply/verify，再 opening plan/apply/verify。副本参数 `rollbackOnSuccess=true`，逆序 opening rollback、Vault 前向回滚、Vault verify。真实 hzy0 参数为 false，成功结果保留。任何命令非零退出立即停止，不自动重试。

原迁移 reviewHash 与台账保持不变。副本从当前备份恢复时，仅调整副本端口/实例/配置的身份绑定并记录转换；不将副本 reviewHash 用于真实 hzy0。所有确认集、计划、回执及日志均在 0700 根目录中以 0600 保存。

## 失败与恢复

停止后检查固定错误码，不输出驱动错误、账号或配置内容。真实窗口失败时按本次新备份恢复统一库和 Console，再启动原候选与原 Runtime；不得使用原主迁移 rollback 删除已编辑业务行。Vault 自身的受控 rollback 是前向新增 synthetic 版本，保留此前加密版本，不能视为删除真实历史。恢复后核对健康、Collab 配置和业务基线，再撤销暂存列权限。
