# 2026-06-23 Altoc 合同详情页控制台错误

## Symptom

合同详情页出现 Vue 全局错误处理器日志，用户提供的生产栈只显示压缩后的 `e.vueApp.config.errorHandler` 调用链。

本地用 3013 legacy-auth dev server 复现到完整错误：

- `ReferenceError: Cannot access 'contract' before initialization`
- `TypeError: Cannot read properties of undefined (reading 'stage_type')`

## Root Cause

`app/pages/contracts/[id].vue` 中主合同下拉的 `useFetch` query computed 在 `contract` 的 `useFetch` 声明之前访问了 `contract.value?.customer_id`。`useFetch` 会在 setup 阶段读取 query，触发 JavaScript TDZ，导致 setup 中断。后续模板渲染时 setup 暴露不完整，连带出现 `stageForm.stage_type` undefined 的渲染错误。

## Fix

将主合同下拉的客户过滤从直接读取 `contract.value` 改为独立的 `parentContractCustomerId` ref。打开合同编辑弹窗时再从当前合同详情回填该 ref，保留客户过滤能力，同时避免 setup 初始化顺序依赖。

## Evidence

修复后重新加载 `/altoc/contracts/1`，DevTools console 中不再出现 `[Global Error Handler]` Vue 运行时错误；剩余错误均为本地 Console、Workflow、tenant-runtime 未启动导致的 502/500/401 资源请求错误。

## Validation

- `pnpm --dir /Users/gavin/Dev/huizhi-yun/altoc exec eslint 'app/pages/contracts/[id].vue'` passed
- `git -C /Users/gavin/Dev/huizhi-yun/altoc diff --check -- 'app/pages/contracts/[id].vue'` passed

## Status

DONE
