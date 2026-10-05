# data-runtime 发布脚本签名密钥环境变量排障

日期：2026-07-23

## 症状

在工作区根目录执行 `./update_dr.sh`，版本解析正常：

- local：`0.3.138`
- remote：`0.3.138`
- target：`0.3.139`

随后在测试、`VERSION` 修改、打包和上传之前退出：

```text
error: HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_FILE is required before tests or VERSION changes
```

## 根因

这是 shell 配置漂移，不是当天代码回归。

- `update_dr.sh` 的签名密钥前置检查由提交 `51988535` 于 2026-07-13 加入。
- 当前 `update_dr.sh` 在该区域没有未提交修改。
- 当前登录 shell 未设置 `HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_FILE`。
- 常用 shell 启动文件中没有该变量的持久化配置。
- README 约定位置的私钥仍存在、可读，权限为 `600`，并能通过 `openssl pkey -pubout` 校验。

因此昨天能运行的最可能差异是：昨日使用的终端会话中曾执行临时 `export`，今天的新 shell 没有继承。

## 恢复方式

在执行发布的同一个终端中设置私钥路径：

```bash
export HZY_DATA_RUNTIME_RELEASE_SIGNING_KEY_FILE="$HOME/Dev/secure/hzy-data-runtime-release/release-signing-private.pem"
./update_dr.sh
```

如需跨终端持久化，只持久化文件路径，不复制私钥内容，并继续保持私钥权限为 `600` 或 `400`。

## 验证

- 在显式清除变量后复现原错误，退出码为 `1`。
- 现有私钥文件通过存在性、可读性、权限和 OpenSSL 公钥导出校验。
- 诊断没有修改 `data-runtime/VERSION`，没有打包，也没有发起 R2 上传。

## 状态

`DONE_WITH_CONCERNS`：根因已确认，配置恢复命令明确；未替用户执行真实发布，因为该操作会修改版本、生成制品并上传。
