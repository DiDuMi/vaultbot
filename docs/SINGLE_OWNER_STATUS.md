# 单人项目化重构状态

## 当前结论

`codex-simplify-single-owner` 分支已经不再只是“隐藏部分多租户入口”，而是完成了一轮较完整的兼容式单人项目化收口。

当前状态更适合描述为：

- 日常运行心智已接近个人项目
- 多管理员与多存储群治理已被明显收口
- tenant 漂移风险已显著下降
- 顶层服务装配、worker 边界、Bot 主入口与运维入口已经明确以 `project` 为主语
- 阶段 A 的 P0 `projectId` 兼容字段方案已经完成三轮复演验证
- 阶段 B 已开始进入“P0 双写 + 低风险切读”执行期
- 生产 Phase A backfill 已执行完成，当前已进入观察期
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

### 7. 阶段 A 已完成三轮复演

阶段 A 当前已不只是设计稿，而是已经完成：

- 本地当前库演练通过
- 独立 shadow 库复演通过
- 生产备份恢复库复演通过

当前已确认：

- P0 表的 `projectId` 字段方案可落地
- A1 migration 可重复执行
- A2 backfill 可重复执行
- 对应影子环境 `preflight:project`、`build`、`test` 均已通过

### 8. 生产数据现实已确认

通过生产备份恢复库复演，当前已经确认：

- 当前生产运行命中的 `PROJECT_CODE`（或 legacy `TENANT_CODE`）是 `vault`
- 生产数据库中仍然实际存在两个 tenant：
  - `vault`
  - `prod`

这意味着：

- 当前可以按“单项目运行心智”继续推进
- 但还不能把数据库误判成“物理单项目态”
- 后续阶段 B/C 设计必须同时考虑：
  - 当前运行路径命中 `vault`
  - 历史 `prod` 数据仍需保持可读

### 9. 阶段 B 已开始落地

当前已落地的阶段 B 范围：

- P0 双写已进入代码
  - `delivery-storage`
  - `delivery-tenant-vault`
  - `delivery-core`
  - `upload`
  - `delivery-admin`
- 低风险切读已开始落地
  - `delivery-storage`
  - `delivery-tenant-vault`
  - `delivery-admin`
  - `delivery-core`
  - `upload`
- discovery 管理链路的 project-first fallback 已开始落地
  - `getUserAssetMeta`
  - `listUserBatches`
  - `listProjectBatches`
  - `listUserRecycledAssets`
  - `deleteUserAsset`
  - `recycleUserAsset`
  - `restoreUserAsset`

当前阶段 B 的执行特征是：

- 仍然保持旧 `tenantId` 路径可回退
- 只在局部入口上改成“先 `projectId`，后 `tenantId`”
- discovery 已进入“管理链路/列表链路”的封闭入口切读
- discovery 已开始进入搜索入口切读（`searchAssets` 已实现 project-first fallback）
- discovery 已开始进入标签索引/标签资产列表入口切读（`listTopTags` / `listAssetsByTagId` 已实现 project-first fallback）
- discovery 管理链路补齐：`setUserAssetSearchable` 已实现 project-first fallback
- discovery 用户历史链路开始切读：`listUserOpenHistory` 已实现 project-first fallback
- discovery 用户点赞链路开始切读：`listUserLikedAssets` 已实现 project-first fallback
- discovery Tag 查询入口补齐：`getTagById` / `getTagByName` 已实现安全回退（通过 `assetTag` 关联验证归属）

### 10. Bot 主入口已完成 project 化

当前已完成：

- `src/bot/project/index.ts` 成为真实主入口
- 共享 Bot core 已迁到 `src/bot/project/register-core.ts`
- `src/bot/project/composition.ts` 已接管大部分装配骨架
- `src/bot/tenant/index.ts` 已退化为兼容壳层
- `src/bot/tenant/register-core.ts` 已退化为兼容 re-export

这意味着：

- `project` 已经是事实上的唯一 Bot 主入口
- `tenant` 当前更多承担兼容层与实现承载层职责

### 11. 生产 Phase A backfill 已完成

当前已在生产执行：

- `scripts/schema-phase-a-backfill.sql`

执行结果：

- 目标表 `projectId is null = 0`
- 目标表 `projectId is distinct from tenantId = 0`

当前生产数据现实仍然是：

- `prod` 与 `vault` 两个历史项目同时存在
- 但目标表已经全部满足 `projectId = tenantId`
- 当前可进入观察期，而不是直接进入物理清理

### 12. 生产观察期模板已就位

当前已新增：

- `scripts/project-observation-audit.sql`
- `docs/PRODUCTION_OBSERVATION_RUNBOOK.md`

用途：

- 在 `24h / 72h / 7d` 窗口里持续确认最近写入继续双写
- 确认最近写入继续满足 `projectId = tenantId`
- 确认 project 分布没有异常漂移

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
- 并且生产数据库现实仍是“多 tenant 兼容内核 + 当前运行命中单项目”

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
- 阶段 B 以后若误把“当前运行 tenant = vault”当作“库里只有 vault”，会直接误伤 `prod` 历史数据

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

- 继续推进阶段 B
- 优先执行生产观察期巡检
- 观察稳定后，再扩展 P0 范围内双写与低风险切读
- 继续沿 discovery 的单点入口推进，而不是一次性切整条搜索/标签链
- 保持所有读路径继续支持 `tenantId` 回退
- 在更高风险发现链路切读前，先持续同步文档与执行矩阵

### 方案 C：进入 schema 清理准备

适用场景：

- 你希望在阶段 B 稳定后，继续规划更深层结构收口
- 但仍然不直接进入破坏性数据库清理

建议做法：

- 先完成观察期与阶段 B 的低风险落地
- 再评估哪些表可进入下一轮切读
- 暂不进入 `Tenant*` / `tenantId` 物理清理
## 2026-04-23 Addendum - Observation does not block low-risk cleanup

- Observation still gates destructive or irreversible work:
  - schema cleanup
  - removing tenant fallback
  - removing `tenantId` / `Tenant*`
- Observation does not gate compatible progress:
  - project wrapper consolidation
  - project-first service assembly cleanup
  - worker/upload/discovery naming cleanup
  - compatibility-preserving alias restructuring
- Latest local verification for these compatible rounds remains:
  - `npm run build` passed
  - `npm run test` passed
  - `195/195 passed`
