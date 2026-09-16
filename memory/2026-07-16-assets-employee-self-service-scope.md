# Assets 资产使用人自助权限收敛（2026-07-16）

## 现象

模拟项目成员进入 Assets“资产操作”时，可看到全租户资产操作记录，并出现可创建任意资产操作的宽泛入口。`assets:employee` 复用了 `assignments:edit`，列表、工作台和预警也没有按资产使用关系过滤。

## 根因

- 普通自助申请与管理侧维护共用 `assignments:edit`，无法区分领用/归还申请和分配、转移、报废等管理员动作。
- `asset:user` 在关系判定中被宽化到 owner/custodian/user，没有保持精确使用人语义。
- Assets BFF 只传权限资源/动作，没有把服务端派生的对象范围作为可信 runtime 参数；tenant-runtime 的资产操作、工作台和预警读取因此是全量查询。
- 创建资产操作接受浏览器提供的目标、流程、状态、生效时间等控制字段。

## 修复

- 新增 `assets:assignments:request`；`assets:employee` 只保留 dashboard、asset_items、assignments、alerts 的查看及 assignments request，五项默认 `asset:user`；`assets:requester` 的 assignment view/request 为 `subject:self`。
- 自助 request 只允许 `claim / return / release`。领用目标强制当前 actor；归还仅允许本人当前实物资产；释放仅允许本人当前资源资产。流程、编号、终态、生效时间、审批人和他人目标字段由服务端剥离。
- 资产关系谓词改为 exact user/owner/custodian；资产操作列表/详情、工作台、预警和预警动作统一执行 relation/department/project scope。
- 页面按 request/edit/approve 分闸；request-only 用户不显示管理动作、审批、职责冲突解释或流程控制字段。

## 生产事实

- Assets manifest ID 55 / sequence 5 / release v0.2.3。
- Policy bundle ID 86：`pv_prod_20260716195219_0084`，revision 19，hash `sha256_e5d84049832a1a175aca6c032ea983daedee6edd6b9dd9bb3c7f5a0857b30e7e`。
- Assets Worker：`b789531c-f6be-4d78-b45a-1d9560d0642c`。
- Platform Worker：`dc6f6370-b971-4cad-be6e-0fb5d33a31c7`。
- tenant data-runtime：`0.3.111`，ready，全部 app DB health `ok`。

## 验收

- Assets 78/78 tests、lint、typecheck、build/dry-run 通过；data-runtime `go test ./...` 通过；Platform 218/218 tests、lint、typecheck、build/dry-run 通过。
- 生产模拟 `project_member → assets:employee`：资产操作列表从全租户 3 条变为本人范围 0 条；仅有“发起申请”，动作下拉只有领用、归还、释放；未执行写操作。Console 已消费 bundle `…0084`，验收后退出模拟。

## 复用原则

普通用户的“申请”动作必须与管理维护动作分离；页面隐藏不能替代 BFF 可信参数和 tenant-runtime 对象范围。关系 scope 名称必须按精确语义解释，不能把 `user` 泛化为 owner/custodian。
