# 去租户化任务卡

## 1. 文档目的

本文档用于把 `docs/DETENANT_EXECUTION_MATRIX.md` 中的高优先级项进一步拆成可直接执行的任务卡，供 Codex 自动任务逐卡推进。

使用原则：

- 自动任务每轮只允许选择一张卡
- 一张卡必须是最小可独立验收步长
- 一张卡完成后，必须更新 `docs/ITERATION_NOTES.md`
- 卡未完成前，不得顺手扩展到下一张卡

## 2. 当前推荐执行范围

当前不再只限于 P0-1。

基于最新代码事实，推荐执行范围调整为：

- P1-3 文档与运维语义对齐
- P2-1 类型、注释、日志上下文统一

P0-1 任务卡保留，作为历史主干记录与回顾依据。

## 3. P0-1 任务卡

### Card P0-1-A：定义 Project Context 类型与装配入口

- 目标：
  - 在不破坏现有运行链路的前提下，新增统一 `project context` 概念
  - 让后续模块不再直接依赖 `{ tenantCode, tenantName }` 这种裸配置对象
- 主要文件：
  - `src/config.ts`
  - 可新增一个集中上下文文件，例如 `src/project-context.ts` 或同等位置
- 当前问题：
  - `Config` 仍直接暴露 `tenantCode`、`tenantName`
  - 上层初始化逻辑直接拿租户配置拼装服务
- 建议动作：
  - 新增 `ProjectContextConfig` 或等价类型
  - 在不删旧字段的前提下，提供 `project context` 访问入口
  - 保持旧调用可兼容
- 验收标准：
  - 新增集中上下文类型
  - 新代码可优先依赖 `project context`
  - `npm run test`、`npm run build` 通过
- 风险：
  - 若一次改太多调用点，容易扩大影响面

### Card P0-1-B：主进程启动改为优先使用 Project Context

- 目标：
  - 让应用主进程先构造 project context，再进入 bot/server 初始化
- 主要文件：
  - `src/index.ts`
  - `src/bot.ts`
- 当前问题：
  - `index.ts` 仍直接调用 `assertTenantCodeConsistency(prisma, config.tenantCode)`
  - `createBot()` 与 `createDeliveryService()` 仍接收原始 tenant 配置
- 建议动作：
  - 新增 `resolveProjectContext` 或等价步骤
  - 保留旧 tenant guard，但把其放到 project context 装配内部
  - 外层主流程不再显式拼 tenant 语义
- 验收标准：
  - 主进程启动主语变为 project context
  - 行为保持不变
  - 旧兼容逻辑仍可工作
- 风险：
  - 启动链路一旦出错，会影响全局

### Card P0-1-C：服务端诊断接口补齐 project 语义

- 目标：
  - 让服务端诊断接口不再只有 `tenant-check` 这一种心智
- 主要文件：
  - `src/server.ts`
  - `src/infra/persistence/tenant-guard.ts`
- 当前问题：
  - 仍只有 `/ops/tenant-check`
  - 返回结构和命名仍完全围绕 tenant
- 建议动作：
  - 新增 `project diagnostics` 结果结构，兼容复用底层 tenant 数据
  - 可以保留旧 `/ops/tenant-check`
  - 新增 project-oriented 命名的诊断入口，或先在返回体中增加 project 语义字段
- 验收标准：
  - 运维不再只能通过 tenant 心智看当前实例
  - 旧诊断入口不被破坏
- 风险：
  - 不要一轮里同时改健康检查和权限校验

### Card P0-1-D：tenant guard 提供 project-oriented 包装

- 目标：
  - 把 `tenant-guard` 从“租户守卫文件”逐步变成“项目运行上下文兼容层”
- 主要文件：
  - `src/infra/persistence/tenant-guard.ts`
- 当前问题：
  - 导出名和语义仍是 `assertTenantCodeConsistency`、`getTenantDiagnostics`、`ensureRuntimeTenant`
- 建议动作：
  - 在不删旧函数的前提下，补齐 project-oriented 包装函数
  - 例如新增：
    - `assertProjectContextConsistency`
    - `getProjectDiagnostics`
    - `ensureRuntimeProjectContext`
  - 内部仍可复用 tenant 实现
- 验收标准：
  - 外层调用未来可以不再直接 import `tenant-*` 函数名
  - 兼容路径仍保留
- 风险：
  - 不要在这一轮顺手重命名整个文件

### Card P0-1-E：delivery-core 收口 getTenantId 外泄

- 目标：
  - 让 `delivery-core` 对外逐步以 project context 提供运行时上下文
- 主要文件：
  - `src/services/use-cases/delivery-core.ts`
  - `src/services/use-cases/delivery.ts`
- 当前问题：
  - `getTenantId()` 仍是缓存的核心运行时命中入口
  - 很多 service factory 仍直接接收 `getTenantId`
- 建议动作：
  - 新增 `getProjectContext()` 或 `getRuntimeProjectId()` 一类包装
  - 保留 `getTenantId()` 兼容输出
  - 优先让新装配点使用新的 project-oriented 包装
- 验收标准：
  - service 装配开始减少直接依赖 `getTenantId`
  - 核心逻辑不变
- 风险：
  - 不要和 `delivery-replica-selection.ts` 在同一轮一起处理

### Card P0-1-F：worker 启动入口改为 project context

- 目标：
  - 让 worker 主进程先建立 project context，再进入调度和执行
- 主要文件：
  - `src/worker/index.ts`
  - `src/worker/helpers.ts`
- 当前问题：
  - worker 启动仍直接校验 tenant code
  - `ensureTenantId()` 仍是 worker 运行时主入口
  - `backfillTenantUsers()`、`getBroadcastTargetUserIds()` 仍是强 tenant 语义
- 建议动作：
  - 先只处理启动主语，不同时改复制器内部逻辑
  - 补 project-oriented 包装函数，旧 helper 暂保留
  - 让 `worker/index.ts` 优先依赖 project context
- 验收标准：
  - worker 入口不再显式以 tenant 作为对外主语
  - 调度行为不回退
- 风险：
  - 不要和 `replication-worker.ts` 的内部重构并行推进

## 4. 自动执行顺序

自动任务在 P0-1 阶段必须按以下顺序选卡：

1. `P0-1-A`
2. `P0-1-B`
3. `P0-1-D`
4. `P0-1-C`
5. `P0-1-E`
6. `P0-1-F`

排序原因：

- 先建类型和装配入口
- 再改主进程
- 再补守卫兼容层
- 再补诊断语义
- 再收服务层上下文
- 最后再动 worker 入口

## 5. 每张卡的统一约束

每轮执行一张卡时，必须：

- 明确写出本轮卡号
- 只改该卡必要文件
- 不删除旧兼容路径
- 不做 schema 迁移
- 不做目录重命名
- 运行 `npm run test`
- 运行 `npm run build`
- 更新 `docs/ITERATION_NOTES.md`

## 6. 卡片完成判定

当以下条件满足时，可视为 P0-1 基本完成：

- `P0-1-A` 到 `P0-1-F` 全部完成
- 主进程和 worker 入口都具备 project context 主语
- 诊断与守卫都有 project-oriented 包装
- `delivery-core` 不再是上层唯一只能通过 `getTenantId()` 访问上下文

完成后，自动任务才可以进入 P0-2。
