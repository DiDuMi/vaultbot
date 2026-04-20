# 单人项目化重构状态

## 当前结论

`codex-simplify-single-owner` 分支已经不再只是“隐藏部分多租户入口”，而是完成了一轮较完整的兼容式单人项目化收口。

当前状态更适合描述为：

- 日常运行心智已接近个人项目
- 多管理员与多存储群治理已被明显收口
- tenant 漂移风险已显著下降
- 顶层服务装配、worker 边界与运维入口已经开始明确以 `project` 为主语
- 但底层 schema 仍保留多租户结构，尚未进入破坏性清理

## 已完成项

### 1. 运行时模式收口

- 增加 `SINGLE_OWNER_MODE`
- 单人模式下关闭多管理员治理
- 单人模式下关闭多存储群治理
- 单人模式下 `minReplicas` 固定为 `1`
- 单人模式下 worker 不再主动追求 backup 群复制

### 2. 权限边界收口

- 单人模式下仅 `OWNER` 保留管理权限
- 旧 `ADMIN` 记录在单人模式下不再默认拥有管理权
- 管理流开始以 `canManageProject` 语义工作

### 3. 接口语义收口

已引入兼容式别名接口：

- `isProjectMember`
- `canManageProject`
- `getProjectSearchMode / setProjectSearchMode`
- `getProjectMinReplicas / setProjectMinReplicas`
- `getProjectStartWelcomeHtml / setProjectStartWelcomeHtml`
- `getProjectDeliveryAdConfig / setProjectDeliveryAdConfig`
- `getProjectProtectContentEnabled / setProjectProtectContentEnabled`
- `getProjectHidePublisherEnabled / setProjectHidePublisherEnabled`
- `getProjectAutoCategorizeEnabled / setProjectAutoCategorizeEnabled`
- `getProjectAutoCategorizeRules / setProjectAutoCategorizeRules`
- `getProjectPublicRankingEnabled / setProjectPublicRankingEnabled`
- `upsertProjectUserFromTelegram`

这些接口当前仍映射到底层 `tenant-*` 实现，但外层调用已经开始切换。

### 4. 运行边界与模块主入口收口

以下能力已经形成 project-first 的入口或包装：

- `projectContext`
- `assertProjectContextConsistency`
- `getProjectDiagnostics`
- `ensureRuntimeProjectContext`
- `/ops/project-check`
- `preflight:project`
- `createDeliveryProjectVault`
- `createProjectAdmin`
- `createProjectDiscovery`
- `createProjectReplicaSelection`

### 5. 用户侧交互收口

以下外层流程已大面积改为 project 语义：

- 设置页
- 欢迎页
- 搜索
- 标签
- 足迹/列表
- 打开内容
- 管理输入
- 推送管理

### 6. 防漂移增强

已新增关键保护：

- 单人模式下，运行时默认禁止隐式创建新 tenant
- 只有显式设置 `SINGLE_OWNER_ALLOW_TENANT_BOOTSTRAP=1` 才允许首次初始化 tenant

这是目前最重要的底层保护之一，因为它直接减少了“配置漂移后悄悄写进新 tenant”的风险。

## 仍然保留的结构

以下内容仍然存在，因此还不能说“底层已经彻底去租户化”：

- Prisma schema 仍保留 `Tenant`
- 业务表仍大量保留 `tenantId`
- 仍存在 `TenantMember / TenantVaultBinding / TenantTopic`
- worker / service 内部仍保留一部分 `tenant*` 命名与 Prisma 查询字段
- 文件目录仍然是 `bot/tenant/*`
- 兼容层仍保留少量 `tenant-*` API 和别名入口

这意味着：

- 当前更像“单 tenant 的兼容收口版”
- 不是“彻底删除多租户结构的最终版”

## 风险判断

### 已明显降低的风险

- 因多人管理员入口导致的权限混乱
- 因 backup 群治理导致的运维复杂度
- 因多副本阈值导致的交付链路波动
- 因隐式 tenant 创建导致的明显漂移风险

### 仍未完全消除的风险

- `TENANT_CODE` 与数据库命中逻辑仍然是核心约束
- 若错误修改生产环境变量，底层仍可能出现 tenant 相关问题
- 若继续做更深层清理，可能触碰 schema / 数据兼容边界

## 生产建议

当前如果要按“个人项目方式”继续运行，建议至少固定以下环境变量：

- `SINGLE_OWNER_MODE=1`
- `EXPECTED_TENANT_CODE=<production project code>`
- `REQUIRE_EXISTING_TENANT=1`
- `ALLOW_TENANT_CODE_MISMATCH=` 保持为空
- `SINGLE_OWNER_ALLOW_TENANT_BOOTSTRAP=` 保持为空

只有在首次初始化新环境时，才临时设置：

- `SINGLE_OWNER_ALLOW_TENANT_BOOTSTRAP=1`

初始化完成后应立即移除。

## 下一阶段建议

### 方案 A：到此为止，进入人工验收

适用场景：

- 你希望先验证现网兼容性
- 你希望先观察日常运营是否仍出现“设置/作品漂移”
- 你不想过早进入 schema 级清理

建议做法：

- 用当前分支做一轮完整回归
- 重点验证旧 `shareCode`、上传、设置、搜索、标签、推送

### 方案 B：继续做兼容式清理

适用场景：

- 你希望仓库语义进一步从 `tenant` 转为 `project`
- 但仍不想做破坏性数据库迁移

建议做法：

- 继续清理 service / worker / bot 内部残留的 tenant 局部命名
- 补做文档与执行矩阵同步，避免“文档进度落后于代码进度”
- 收敛类型名、注释、状态文案
- 保持 schema 不动

### 方案 C：进入 schema 清理准备

适用场景：

- 你确认未来不会再回到多租户模式
- 你愿意接受更高风险、换取更彻底的结构清理

建议做法：

- 先做数据迁移方案设计
- 明确哪些表和字段可以废弃
- 在真正动 Prisma schema 前，先准备回滚方案
