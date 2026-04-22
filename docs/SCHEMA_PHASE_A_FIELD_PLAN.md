# Schema 阶段 A 字段设计草案

## 1. 文档定位

本文档用于承接：

- [SCHEMA_CLEANUP_DESIGN.md](/E:/MU/chucun/docs/SCHEMA_CLEANUP_DESIGN.md)
- [SCHEMA_CLEANUP_INVENTORY.md](/E:/MU/chucun/docs/SCHEMA_CLEANUP_INVENTORY.md)

目标不是直接执行迁移，而是明确阶段 A 里：

- 哪些表值得先加 `projectId`
- 哪些表当前不值得加
- 字段、索引、backfill、切换顺序应该怎么控制

当前日期基线：`2026-04-21`

## 2. 当前设计前提

基于当前盘点结果，可以先固定几个前提：

- 当前本地库只有 1 个活跃 `Tenant`
- 已盘点业务表都只命中同一个 `tenantId`
- 当前系统仍是单项目心智 + 多租户兼容内核
- 阶段 A 只能做 additive migration，不能做 destructive migration

因此，阶段 A 的设计原则是：

- 先加字段，不删字段
- 先补索引，不删旧索引
- 先 backfill，不切主读路径
- 先挑真正有边界价值的表，不追求一次性全表对齐

## 3. 阶段 A 总体策略

### 3.1 设计目标

阶段 A 只解决一件事：

把未来大概率会保留、且当前高层读写频繁命中的业务表，提前准备好 `projectId` 兼容字段。

### 3.2 明确不做的事

阶段 A 不做以下动作：

- 不删除任何 `tenantId`
- 不删除任何 `Tenant*` 表
- 不把 `Tenant` 直接重命名成 `Project`
- 不一次性给所有表补 `projectId`
- 不在生产上切换主读路径

### 3.3 核心判断规则

只有满足以下任一条件的表，才值得在阶段 A 优先补 `projectId`：

- 该表大概率会长期保留
- 该表是高层服务或 worker 的主查询入口
- 该表当前已有明显的 `tenantId` 查询/唯一约束，是未来切读的关键阻塞

不满足这些条件的表，先不进阶段 A。

## 4. 表级分层决策

## 4.1 P0：阶段 A 首批建议加 `projectId` 的表

这些表最值得优先进入字段设计。

### `TenantSetting`

原因：

- 高层设置读写频繁命中
- 当前大量查询依赖 `tenantId_key`
- 未来极大概率会演进为 `ProjectSetting`

建议：

- 新增可空 `projectId`
- backfill：`projectId = tenantId`
- 新增唯一约束：`(projectId, key)`
- 保留旧唯一约束：`(tenantId, key)`

### `Asset`

原因：

- 资产是核心业务主表
- 打开、发现、上传、交付都要经过它
- 当前 `[tenantId, collectionId]` 索引是核心入口

建议：

- 新增可空 `projectId`
- backfill：`projectId = tenantId`
- 新增索引：`(projectId, collectionId)`
- 保留旧索引：`(tenantId, collectionId)`

### `Collection`

原因：

- 与 `Asset` 一起构成高层内容主语
- 后续发现链路切读一定会碰到它

建议：

- 新增可空 `projectId`
- backfill：`projectId = tenantId`
- 先补普通索引，不急着加新的复杂约束

### `TenantUser`

原因：

- 用户命中频率高
- 当前唯一键和索引都强依赖 `tenantId`
- 最终大概率保留为 project 语义用户表

建议：

- 新增可空 `projectId`
- backfill：`projectId = tenantId`
- 新增唯一约束：`(projectId, tgUserId)`
- 新增索引：`(projectId, tgUserId)`、`(projectId, username)`
- 保留旧约束和旧索引

### `UserPreference`

原因：

- 已是 project-first 外层语义常用配置表
- 当前唯一键是 `(tenantId, tgUserId, key)`

建议：

- 新增可空 `projectId`
- backfill：`projectId = tenantId`
- 新增唯一约束：`(projectId, tgUserId, key)`
- 新增索引：`(projectId, tgUserId)`

### `Event`

原因：

- 统计、排行、行为日志高度依赖
- 当前索引 `(tenantId, userId, type)` 是典型切读阻塞点

建议：

- 新增可空 `projectId`
- backfill：`projectId = tenantId`
- 新增索引：`(projectId, userId, type)`

### `UploadBatch`

原因：

- 上传与交付链路关键表
- 当前 `(tenantId, assetId)` 是重要过滤维度

建议：

- 新增可空 `projectId`
- backfill：`projectId = tenantId`
- 新增索引：`(projectId, assetId)`

### `Broadcast`

原因：

- 推送草稿、发送、调度都依赖它
- 当前 `(tenantId, status, nextRunAt)` 是明显主索引

建议：

- 新增可空 `projectId`
- backfill：`projectId = tenantId`
- 新增索引：`(projectId, status, nextRunAt)`

## 4.2 P1：阶段 A 次批建议加 `projectId` 的表

这些表值得补，但优先级低于 P0。

### `Tag`

原因：

- 发现链路常用
- 当前唯一约束 `(tenantId, name)` 明显依赖 tenant 语义

建议：

- 新增可空 `projectId`
- backfill：`projectId = tenantId`
- 新增唯一约束：`(projectId, name)`

### `AssetComment`

原因：

- 已是活跃业务表
- 当前索引依赖 `tenantId`

建议：

- 新增可空 `projectId`
- backfill：`projectId = tenantId`
- 新增索引：`(projectId, assetId, createdAt)`、`(projectId, authorUserId, createdAt)`

### `AssetCommentLike`

建议：

- 新增可空 `projectId`
- backfill：`projectId = tenantId`
- 新增唯一约束：`(projectId, commentId, userId)`
- 新增索引：`(projectId, commentId, createdAt)`、`(projectId, userId, createdAt)`

### `AssetLike`

建议：

- 新增可空 `projectId`
- backfill：`projectId = tenantId`
- 新增唯一约束：`(projectId, assetId, userId)`
- 新增索引：`(projectId, assetId, createdAt)`、`(projectId, userId, createdAt)`

## 4.3 P2：当前先不进阶段 A 的表

这些表不是永远不动，而是当前不值得作为阶段 A 首批对象。

### `TenantMember`

原因：

- 当前盘点结果只有 1 条 `OWNER`
- 更像兼容模型而不是长期核心模型
- 很可能未来直接收缩或替代，而不是单纯补字段

当前建议：

- 阶段 A 不加 `projectId`
- 先保留 `tenantId`
- 等角色模型最终方案稳定后再决定

### `TenantVaultBinding`

原因：

- 更像兼容性存储绑定
- 最终更可能被“项目存储配置”替代

当前建议：

- 阶段 A 不加 `projectId`
- 先保留现状
- 先做模型替代设计，再决定是否迁移

### `TenantTopic`

原因：

- 当前更像交付路由兼容表
- 是否保留、如何保留，依赖后续 topic 路由方案

当前建议：

- 阶段 A 不加 `projectId`
- 先维持 `tenantId` 兼容命中

### `PermissionRule`

原因：

- 最终结构可能直接被更简单的可见性模型替代
- 现在补字段容易做成“先迁后删”的噪音工程

当前建议：

- 阶段 A 不加 `projectId`

### `VaultGroup`

原因：

- 它本身更接近基础设施对象
- 是否需要 project 直连，要先看 `TenantVaultBinding` 的替代设计

当前建议：

- 阶段 A 先不加 `projectId`

### `AssetTag`

原因：

- 当前 `tenantId` 更像去范式化冗余字段
- 它的主业务关系已经由 `assetId + tagId` 定义

当前建议：

- 阶段 A 先不加 `projectId`
- 后续等 `Asset` 和 `Tag` 稳定后再评估是否还需要冗余 project 维度

## 4.4 本就不需要 `projectId` 的表

这些表当前没有 `tenantId`，阶段 A 不需要额外补 project 维度：

- `AssetReplica`
- `UploadItem`
- `BroadcastRun`

原因：

- 它们已经通过父表间接归属到项目
- 当前不是 `tenantId` 迁移的主要阻塞点

## 5. 字段与约束设计建议

### 5.1 字段设计

统一建议：

- 字段名：`projectId`
- 第一阶段类型：与 `tenantId` 相同，使用 `String`
- 第一阶段约束：可空

为什么先可空：

- 便于先发 additive migration
- 便于 backfill
- 便于影子环境验证

### 5.2 backfill 规则

阶段 A 的 backfill 统一按下面规则执行：

- `projectId = tenantId`

当前盘点结果只有单 tenant，因此这条规则在本地库是成立的。
但仍然不能直接假设生产一定成立，生产环境仍需独立盘点确认。

### 5.3 索引与唯一约束

原则：

- 新增 `projectId` 对应索引/唯一约束
- 保留原 `tenantId` 对应索引/唯一约束
- 不在阶段 A 删除旧索引

### 5.4 外键策略

阶段 A 暂不建议立刻为所有 `projectId` 建新外键指向 `Tenant(id)`。

原因：

- 当前 `Tenant` 本身未来还可能演进为 `Project`
- 先加字段和索引更稳
- 新外键可以放到阶段 B 或阶段 C 前再加

可选策略：

- 如果某张表数据量小、影子环境验证稳定，再单独评估补外键

## 6. 推荐实施顺序

建议按下面顺序推进，而不是一次性全加：

1. `TenantSetting`
2. `TenantUser`
3. `UserPreference`
4. `Asset`
5. `Collection`
6. `Event`
7. `UploadBatch`
8. `Broadcast`
9. `Tag`
10. `AssetComment` / `AssetCommentLike` / `AssetLike`

这样排的原因：

- 先低风险配置与用户维度
- 再内容主表
- 再统计与上传
- 最后处理互动类表

## 7. 阶段 A 的最小验收

只有满足以下条件，才能说阶段 A 字段准备成功：

- 新增字段 migration 可在影子环境执行
- backfill 脚本可重复执行且结果稳定
- 新旧索引并存时查询行为不变
- 不影响 `npm run test`
- 不影响 `npm run build`
- 不影响 `npm run preflight:project`

## 8. 当前建议的下一步

基于这份字段设计草案，下一步最合适的是：

1. 先把 P0 表整理成一份具体 migration 草案
2. 单独写 backfill 脚本设计
3. 明确每张表新增哪些索引和唯一约束
4. 只在影子环境验证，不直接进生产

一句话结论：

阶段 A 不应该是“给所有表都补一个 `projectId`”，而应该是“只给长期保留且高频命中的核心表补最小必要字段，为后续双写/切读铺路”。
