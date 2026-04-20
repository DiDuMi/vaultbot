# 去租户化执行矩阵

## 1. 文档目的

本文档用于把“去租户化还剩哪些模块没完成”具体化为可执行矩阵，供人工与 Codex 自动任务共同使用。

与 `docs/DETENANT_REFACTOR_PLAN.md` 的区别：

- `DETENANT_REFACTOR_PLAN.md` 负责长期路线与阶段目标
- 本文档负责当前剩余工作的执行清单、优先级、验收点和风险

后续自动任务每轮开始前，应优先读取本文档，再决定本轮步长。

## 2. 当前总体判断

当前仓库已经完成了“兼容式单项目收口”的中段工作，但还没有完成“彻底去租户化”。

更准确地说：

- 阶段 1 已经完成大部分入口与包装层收口
- 阶段 2 已经推进到中后段
- 阶段 4 已开始通过 worker 边界与模块入口整理推进
- 阶段 5 仍未系统推进
- 阶段 6 暂时不应启动

## 3. 完成度总览

| 区域 | 当前状态 | 完成度判断 | 说明 |
| --- | --- | --- | --- |
| 运行边界与上下文 | 进行中 | 中高 | `projectContext`、project guard、project diagnostics 已落地，但底层仍保留 `getTenantId()` 兼容路径 |
| 服务层 project 主入口 | 进行中 | 高 | 主要聚合层与多个模块入口已 project-first，仍有局部 tenant 实现细节 |
| Bot/UI 活跃调用链 | 进行中 | 中高 | 高频页面基本已切到 `project-*`，目录命名与局部文案仍是历史包袱 |
| 存储/副本/worker | 进行中 | 中 | worker 入口、helper、storage、scheduler、日志边界已推进，底层复制/存储结构仍保留 tenant 字段 |
| 测试与文档 | 进行中 | 中高 | 测试和迭代记录在持续补强 |
| schema 物理清理 | 未开始 | 低 | 当前不建议启动 |

## 4. 优先级矩阵

### P0：必须优先完成

这些内容不完成，就不能说“运行模型已经 project 化”。

#### P0-1 统一 Project Context

- 状态：大部分完成
- 优先级：最高
- 目标：
  - 用统一 `project context` 包装运行时上下文
  - 上层模块不再直接关心 `TENANT_CODE`
  - `getTenantId()` 不再向应用层扩散
- 主要文件：
  - `src/config.ts`
  - `src/index.ts`
  - `src/server.ts`
  - `src/services/use-cases/delivery-core.ts`
  - `src/infra/persistence/tenant-guard.ts`
- 当前缺口：
  - `delivery-core` 与部分子模块仍保留 `getTenantId()` 兼容路径
  - 文档与任务卡尚未完全同步到最新代码事实
  - 运行边界仍未彻底摆脱底层 tenant 字段依赖
- 验收标准：
  - 新增统一 project context 入口
  - 上层业务初始化不再直接拼 `tenantCode/tenantName`
  - 启动与健康诊断的主语改为 project

#### P0-2 副本选择链路去租户主语

- 状态：进行中
- 优先级：最高
- 目标：
  - 让交付主链路从“tenant 辅助依赖”收口到“project 辅助依赖”
- 主要文件：
  - `src/services/use-cases/delivery-replica-selection.ts`
  - `src/services/use-cases/delivery.ts`
- 当前缺口：
  - 已完成对外 `projectId` 收口，但内部仍直接查询 tenant 结构
  - 直接查询 `tenantVaultBinding`
- 验收标准：
  - 对外主语改为 `project`
  - 兼容别名仍保留
  - 打开链路测试不回退

#### P0-3 Worker 运行边界收口

- 状态：进行中
- 优先级：最高
- 目标：
  - 把 worker 从“tenant worker”收口为“project worker”
- 主要文件：
  - `src/worker/index.ts`
  - `src/worker/helpers.ts`
  - `src/worker/replication-scheduler.ts`
  - `src/worker/replication-worker.ts`
  - `src/worker/storage.ts`
- 当前缺口：
  - 底层复制逻辑与 Prisma 查询仍以 tenant 字段为核心
  - 局部 log op / component / 注释仍残留 tenant 术语
  - worker 内部实现尚未彻底统一到 project 命名
- 验收标准：
  - worker 初始化先获取 project context
  - 心跳与日志优先描述 project 运行状态
  - 不再要求上层通过 tenant 心智理解 worker

### P1：高价值，建议尽快完成

#### P1-1 服务层残余 tenant 接口收口

- 状态：进行中（中后段）
- 优先级：高
- 主要文件：
  - `src/services/use-cases/delivery.ts`
  - `src/services/use-cases/delivery-preferences.ts`
  - `src/services/use-cases/delivery-tenant-vault.ts`
  - `src/services/use-cases/delivery-discovery.ts`
  - `src/services/use-cases/delivery-social.ts`
- 当前缺口：
  - 聚合层仍保留少量 tenant 兼容别名
  - 部分模块内部文件名和局部命名仍是 tenant 历史术语
  - 仍需继续清理 discovery / vault / admin 等模块内部实现命名
- 验收标准：
  - 新需求默认只接 `project-*`
  - `tenant-*` 收缩为兼容出口

#### P1-2 Bot 高频链路语义收口

- 状态：进行中
- 优先级：高
- 主要文件：
  - `src/bot/tenant/renderers.ts`
  - `src/bot/tenant/history.ts`
  - `src/bot/tenant/ui-utils.ts`
  - `src/bot/tenant/register-messages.ts`
  - `src/bot/tenant/callbacks/admin-admin-input.ts`
- 当前缺口：
  - 目录与类型仍是 `tenant`
  - 文案与回调含义仍残留“租户管理员”等概念
  - 仍有少量上层回退到旧 `tenant-*` 接口
- 验收标准：
  - 高频活跃链路优先全部用 `project-*`
  - 文案不再要求用户理解租户治理

#### P1-3 诊断与运维接口收口

- 状态：进行中
- 优先级：高
- 主要文件：
  - `src/server.ts`
  - `src/scripts/tenant-precheck.ts`
  - `docs/PRODUCTION_DEPLOY_SOP.md`
- 当前缺口：
  - 兼容入口 `/ops/tenant-check` 仍在，需要明确降级为兼容说明
  - 其余文档（执行矩阵/任务卡等）仍有部分旧 tenant 视角
- 验收标准：
  - 保留兼容能力，但新增 project-oriented 诊断入口
  - 运维文档明确以单项目视角描述系统

### P2：可以后续逐步完成

#### P2-1 类型、注释、日志上下文统一

- 状态：未完成
- 优先级：中
- 主要文件：
  - `src/core/domain/models.ts`
  - `src/services/use-cases/*`
  - `src/worker/*`
  - `src/bot/tenant/*`
- 当前缺口：
  - 类型名和日志字段仍大量带 `tenant`
- 验收标准：
  - 上层阅读代码时尽量不再碰到 `tenant` 主语

#### P2-2 目录命名重组

- 状态：未开始
- 优先级：中低
- 主要文件：
  - `src/bot/tenant/*`
- 当前缺口：
  - 目录命名仍是强历史包袱
- 约束：
  - 这一步不能早做
  - 必须等活跃调用链和测试足够稳定再评估

### P3：暂不启动

#### P3-1 Schema 物理清理

- 状态：未开始
- 优先级：暂缓
- 主要文件：
  - `prisma/schema.prisma`
  - `prisma/migrations/*`
- 当前缺口：
  - 还没有进入可安全清理的阶段
- 禁止事项：
  - 当前阶段不要删除 `Tenant*`
  - 不要删除业务表中的 `tenantId`
  - 不要发起破坏性迁移

## 5. 推荐自动推进顺序

自动任务后续应严格按下面顺序选题：

1. `project context` 包装层
2. `delivery-replica-selection.ts`
3. `worker/helpers.ts` 与 `worker/index.ts`
4. `worker/replication-scheduler.ts` 与 `worker/replication-worker.ts`
5. 服务层残余 `tenant-*` 主实现名
6. Bot 高频活跃调用链
7. 运维/诊断入口
8. 类型、注释、日志统一
9. 最后再评估目录重命名

## 6. 单轮执行规则

后续自动任务每一轮只允许选择一个矩阵项中的最小步长，不得跨级并行扩面。

推荐粒度：

- 一次只处理一个文件，或一条完整但封闭的调用链
- 一次只解决一个主语收口问题
- 一次只新增必要测试，不顺手做无关清理

禁止做法：

- 同时改运行边界和 Bot 目录
- 同时改 worker 和 schema
- 在没有测试补强前大面积替换接口

## 7. 每轮验收模板

每次自动推进都应回答：

- 本轮矩阵项编号是什么
- 为什么现在做这个
- 改了哪些文件
- 哪些旧兼容路径仍保留
- `npm run test` 是否通过
- `npm run build` 是否通过
- 是否需要人工决策

## 8. 完成判定

以下条件全部满足时，才可以认为自动任务接近完成：

- P0 项全部完成
- P1 项中至少运行边界、服务层、Bot 高频链路、运维入口已完成
- P2 只剩目录命名或局部术语清理
- 当前自动任务连续两轮都没有发现新的高优先级 tenant 主语泄漏点

达到上述条件后：

- 自动任务应停止继续写代码
- 在结果中说明“进入人工验收/是否继续做 schema 评估”
- 建议人工决定是否保留或删除自动任务

## 9. 当前建议的下一步

当前最建议优先执行的是：

### 下一轮首选

- P1-3 文档与运维语义对齐

理由：

- 代码事实已经显著领先于状态文档
- 若不先同步文档，后续优先级判断会持续失真

### 下一轮备选

- P2-1 类型、注释、日志上下文统一

理由：

- 当前代码主线已经基本 project-first，接下来更值得做的是清理残余术语噪音

### 暂不建议

- 目录重命名
- schema 清理
- 大范围文案统一

原因：

- 当前都不是最核心阻塞
- 提前做会制造高噪音和高风险
