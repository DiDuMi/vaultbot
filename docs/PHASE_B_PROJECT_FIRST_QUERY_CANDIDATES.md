# Phase B 后续 `project-first` 查询候选清单

## 1. 文档目的

这份文档用于承接：

- 生产 Phase A backfill 已完成
- 当前系统进入观察期
- 需要继续推进“哪些读查询可以在生产里进一步切到 `project-first`”

本文档不讨论破坏性 schema 清理，只讨论兼容期内的查询切换。

## 2. 当前前提

当前生产已经满足：

- 目标表 `projectId is null = 0`
- 目标表 `projectId is distinct from tenantId = 0`
- 生产仍然同时存在 `prod` 与 `vault`
- 当前运行主路径命中 `vault`

因此，后续切读仍必须坚持：

- 先 `projectId`
- 读不到时回退 `tenantId`
- 不假设生产里只有一个项目

## 3. 分类说明

本文把后续查询分成三类：

### A. 已基本 `project-first`

说明：

- 代码里已经优先按 `projectId` 查询
- 仍可能保留少量 `tenantId` 回退
- 暂不列为立即改造目标

### B. 可低风险继续推进

说明：

- 已有 `projectId` 可用
- 当前主要是读查询仍然 tenant-first
- 切换后对生产风险相对可控
- 建议作为下一批推进重点

### C. 暂缓

说明：

- 仍与高频运行链路深度耦合
- 或仍依赖兼容表结构理解
- 不建议在观察期未完成前推进

## 4. A 类：已基本 `project-first`

### 4.1 设置 / 偏好 / 用户映射

- [delivery-storage.ts](/E:/MU/chucun/src/services/use-cases/delivery-storage.ts)
  - `getPreference`
  - `getSetting`
- [delivery-preferences.ts](/E:/MU/chucun/src/services/use-cases/delivery-preferences.ts)
  - `listFollowKeywordSubscriptions`
  - `getUserNotifySettings`
  - `checkAndRecordUserNotification`
- [delivery-tenant-vault.ts](/E:/MU/chucun/src/services/use-cases/delivery-tenant-vault.ts)
  - `getProjectUserLabel`
  - `listCollections`
  - `getCollectionImpactCounts`
  - `listRecentAssetsInCollection`
- [delivery-core.ts](/E:/MU/chucun/src/services/use-cases/delivery-core.ts)
  - `getProjectMinReplicas`
  - `bootstrapProjectSettings`
  - `ensureInitialOwner`
- [delivery-factories.ts](/E:/MU/chucun/src/services/use-cases/delivery-factories.ts)
  - `createGetUserProfileSummary`
  - `createGetProjectAssetAccess`

状态：

- 已实现 `projectId -> tenantId` fallback

### 4.2 广播草稿 / 管理入口

- [delivery-admin.ts](/E:/MU/chucun/src/services/use-cases/delivery-admin.ts)
  - `listMyBroadcasts`
  - `getBroadcastById`
  - `findOwnedBroadcast(...)` 路径

状态：

- 已 project-first

### 4.3 discovery 管理 / 列表 / 搜索主入口

- [delivery-discovery.ts](/E:/MU/chucun/src/services/use-cases/delivery-discovery.ts)
  - `searchAssets`
  - `listTopTags`
  - `listAssetsByTagId`
  - `getUserAssetMeta`
  - `listUserBatches`
  - `listProjectBatches`
  - `listUserRecycledAssets`
  - `deleteUserAsset`
  - `recycleUserAsset`
  - `restoreUserAsset`
  - `listUserOpenHistory`
  - `listUserLikedAssets`

状态：

- 已大面积 project-first fallback

### 4.4 stats / worker / social 已推进的读链

- [delivery-stats.ts](/E:/MU/chucun/src/services/use-cases/delivery-stats.ts)
  - `getProjectHomeStats`
  - `getProjectStats`
  - `getProjectRanking`
  - `getProjectLikeRanking`
  - `getProjectVisitRanking`
  - `getProjectCommentRanking`
- [worker/index.ts](/E:/MU/chucun/src/worker/index.ts)
  - 广播目标 project 归属统一
  - follow notify 资产归属统一
- [delivery-social.ts](/E:/MU/chucun/src/services/use-cases/delivery-social.ts)
  - `listAssetComments`
  - `getAssetCommentCount`
  - `getAssetCommentContext`
  - `locateAssetComment`
  - `getCommentThread`
  - `getAssetLikeCount`
  - `hasAssetLiked`
  - `toggleAssetCommentLike`
  - `toggleAssetLike`
  - `addAssetComment` 中读前检查

状态：

- 已完成首轮或第二轮 project-first fallback

## 5. B 类：下一批可低风险推进

这些是当前最建议继续切的生产查询。

### B1. `worker/index.ts` 广播 / 通知读取语义进一步统一

主要查询：

- `broadcast.findUnique`
- 运行中状态轮询
- 通知日志与 project 归属语义

当前表现：

- 已完成第一批 project 归属统一
- 仍有少量语义与字段使用可继续收口

为什么适合下一批：

- 风险中等
- 对 worker 主线理解有帮助

推进建议：

- 继续围绕 project scope id 统一读语义

### B2. `delivery-factories.ts`

主要函数：

- `createGetUserProfileSummary`
- `createGetProjectAssetAccess`

当前表现：

- 明显仍以 `tenantId` 为查询核心
- 聚合了用户画像、访问计数、打开记录、资产访问判断

为什么适合下一批：

- 都是读取型聚合
- 有明确 `getRuntimeProjectId()` 上下文
- 可按 helper 方式做 `project-first`，再保留 `tenantId` 回退

推进建议：

1. 先切 `createGetUserProfileSummary`
2. 再切 `createGetProjectAssetAccess`

### B3. `delivery-preferences.ts`

主要函数：

- 跟随关键词 / 通知频控相关偏好读取

当前表现：

- `findMany` 仍以 `tenantId` 过滤为主

为什么适合下一批：

- 属于配置/偏好层
- 风险低于交付主链路

推进建议：

- 先引入 `projectId` 过滤，再保留 `tenantId` 回退

### B4. `delivery-stats.ts`

主要函数：

- 首页统计
- 排行
- 趋势聚合

当前表现：

- 基本仍是 `tenantId` 维度统计

为什么适合下一批：

- 只读聚合
- 不直接改写数据
- 当前生产观察期里很适合开始验证 project-first 读统计是否稳定

风险点：

- 查询量大
- 需要注意性能与索引命中

推进建议：

1. 先切首页统计类
2. 再切排行类
3. 每步都观察 SQL 性能

## 6. C 类：暂缓

### C1. `delivery-social.ts`

当前表现：

- 虽然第一批、第二批读链已开始 project-first fallback
- 但更深层互动链、通知链和写前上下文仍然强耦合

为什么暂缓：

- 虽然是读写混合链路，但复杂度比 discovery 管理链更高
- 回退策略、聚合逻辑、通知链路耦合重

建议：

- 放到观察期稳定后单独评估

### C2. `delivery-tenant-vault.ts`

当前表现：

- `TenantMember`
- `TenantVaultBinding`
- `TenantTopic`
- `Collection` 第一批低风险读链已开始收口

为什么暂缓：

- 这些对象本身还是兼容期核心结构
- 很多查询不只是“查字段”，而是“查兼容表”

建议：

- 等 schema 兼容阶段更往后再动

### C3. `delivery-replica-selection.ts`

当前表现：

- 已 project-oriented 暴露，但底层强耦合 `TenantVaultBinding`

为什么暂缓：

- 直接影响交付主链路
- 不适合在观察期里贸然扩大改动

### C4. `worker/replication-worker.ts`

当前表现：

- 深度依赖 `TenantVaultBinding` / `TenantTopic`

为什么暂缓：

- 复制主链路风险高
- 当前只建议保持兼容稳定，不建议继续深切

## 7. 推荐推进顺序

基于当前生产状态，推荐的下一批顺序：

1. [worker/index.ts](/E:/MU/chucun/src/worker/index.ts) 广播 / 通知读取语义进一步统一
2. [delivery-factories.ts](/E:/MU/chucun/src/services/use-cases/delivery-factories.ts) 剩余聚合
3. [delivery-preferences.ts](/E:/MU/chucun/src/services/use-cases/delivery-preferences.ts) 剩余偏好状态读取
4. [delivery-stats.ts](/E:/MU/chucun/src/services/use-cases/delivery-stats.ts) 剩余边角统计

暂缓：

5. [delivery-social.ts](/E:/MU/chucun/src/services/use-cases/delivery-social.ts) 深层互动链
6. [delivery-tenant-vault.ts](/E:/MU/chucun/src/services/use-cases/delivery-tenant-vault.ts) 绑定 / topic 深层逻辑
7. [delivery-replica-selection.ts](/E:/MU/chucun/src/services/use-cases/delivery-replica-selection.ts)
8. [worker/replication-worker.ts](/E:/MU/chucun/src/worker/replication-worker.ts)

## 8. 每批推进要求

后续每一批都应满足：

- 只改一个文件或一条封闭查询链
- 先 `projectId`
- 后 `tenantId`
- 保留兼容 fallback
- `npm run test`
- `npm run build`
- 如涉及生产敏感聚合，再补充观察期 SQL 或手工验收

## 9. 当前建议的下一步

最合理的下一步是：

1. 先观察生产 `24h`
2. 观察通过后，再决定是继续收口 worker 语义，还是进入更高耦合的 social / vault 深层逻辑

原因：

- 当前低风险主干读链已经推进较深
- 后续增量开始明显接近中风险区域
