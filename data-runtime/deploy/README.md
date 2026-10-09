
### 受管安装版本护栏

存在 Platform/enrollment/control/deployment-environment 配置或既有受管 `.env` 时，安装器要求 `--version <exact semver>`；自动更新还必须 `--update-version <exact semver>`，或显式 `--no-auto-update`。不允许受管生产/测试使用全局 latest。旧 timer 与 API 更新路径不因 Platform pinned 自动关闭，现场切换须另行冻结并核查 policy.TargetVersion。
