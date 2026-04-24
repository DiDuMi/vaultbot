# Schema 阶段 B P0 双写设计稿

## 1. 文档定位

本文档用于把阶段 B 的双写方案从原则落到代码入口。

它承接：

- [SCHEMA_PHASE_B_DESIGN.md](/E:/MU/chucun/docs/SCHEMA_PHASE_B_DESIGN.md)
- [SCHEMA_PHASE_A_REHEARSAL_RESULT.md](/E:/MU/chucun/docs/SCHEMA_PHASE_A_REHEARSAL_RESULT.md)

目标：

- 明确 P0 双写先改哪些写入口
- 明确每个入口当前落在哪个文件、哪类 Prisma 写操作
- 给后续“小步改代码”提供执行顺序

本文档不是实现结果，而是阶段 B 的写路径改造草案。

## 2. 当前真实前提

阶段 B 的 P0 双写必须始终建立在以下前提上：

- 当前生产运行 tenant 是 `vault`
- 生产数据库中仍真实存在 `prod`
- 新写入和新更新必须同时兼容这两个事实

因此，双写规则不是：

- “把所有东西写成当前固定项目”

而是：

- “在哪个 `tenantId` 上发生真实写入，就同步把同值写到 `projectId`”

统一表达：

- `projectId = resolvedTenantId`

## 3. 双写总原则

所有 P0 双写入口都应满足：

1. 继续写旧字段 `tenantId`
2. 同时写新字段 `projectId`
3. 新旧字段值保持一致
4. 不改主读路径
5. 不删除旧唯一约束和旧查询条件

## 4. P0 写入口地图

## 4.1 设置写入

### 入口 1

- 文件：[delivery-storage.ts](/E:/MU/chucun/src/services/use-cases/delivery-storage.ts)
- 函数：`upsertSetting`
- 当前写法：
  - `prisma.tenantSetting.upsert`
  - `where: { tenantId_key: { tenantId: projectId, key } }`
  - `create: { tenantId: projectId, key, value }`

阶段 B 建议：

- `update` 中补写 `projectId`
- `create` 中同时写 `tenantId` 和 `projectId`
- 若唯一约束已存在，优先切到 `where projectId_key`
- 保留旧 `where tenantId_key` 作为 fallback（兼容旧数据与旧索引窗口）

### 入口 2

- 文件：[delivery-core.ts](/E:/MU/chucun/src/services/use-cases/delivery-core.ts)
- 函数：`bootstrapProjectSettings`
- 当前写法：
  - `deps.prisma.tenantSetting.createMany`
  - `data: { tenantId: projectId, key, value }`

阶段 B 建议：

- `createMany` 数据项补 `projectId`

### 入口 3

- 文件：[delivery-core.ts](/E:/MU/chucun/src/services/use-cases/delivery-core.ts)
- 函数：`setProjectMinReplicas`
- 当前写法：
  - `deps.prisma.tenantSetting.upsert`

阶段 B 建议：

- 与 `delivery-storage.ts` 保持同一双写规则
- 避免这两处各写一套不一致逻辑

### 入口 4

- 文件：[delivery-discovery.ts](/E:/MU/chucun/src/services/use-cases/delivery-discovery.ts)
- 场景：回收/恢复可见性时的 `tenantSetting.upsert`

阶段 B 建议：

- 同样补写 `projectId`
- 但这条入口优先级低于设置中心入口，可放到第二轮

## 4.2 用户写入

### 入口 1

- 文件：[delivery-tenant-vault.ts](/E:/MU/chucun/src/services/use-cases/delivery-tenant-vault.ts)
- 函数：`upsertProjectUserFromTelegram`
- 当前写法：
  - `deps.prisma.tenantUser.upsert`
  - `where: { tenantId_tgUserId: { tenantId: projectId, tgUserId } }`
  - `create: { tenantId: projectId, ... }`

阶段 B 建议：

- `update` 中补 `projectId`
- `create` 中写 `tenantId` + `projectId`
- 仍保留旧唯一键命中方式

### 入口 2

- 文件：[bot/register-middlewares.ts](/E:/MU/chucun/src/bot/tenant/register-middlewares.ts)
- 场景：
  - 机器人中间件会调用 `upsertProjectUserFromTelegram`

阶段 B 含义：

- 一旦 `upsertProjectUserFromTelegram` 做好双写，Bot 活跃用户路径就会自动受益

## 4.3 偏好设置写入

### 入口

- 文件：[delivery-storage.ts](/E:/MU/chucun/src/services/use-cases/delivery-storage.ts)
- 函数：`upsertPreference`
- 当前写法：
  - `prisma.userPreference.upsert`
  - `where: { tenantId_tgUserId_key: { tenantId: projectId, tgUserId, key } }`
  - `create: { tenantId: projectId, tgUserId, key, value }`

阶段 B 建议：

- `update` 中补 `projectId`
- `create` 中写 `projectId`
- 保留旧 `tenantId_tgUserId_key` 查询方式

## 4.4 资产与上传写入

### 入口 1

- 文件：[upload.ts](/E:/MU/chucun/src/services/use-cases/upload.ts)
- 函数：`commitBatch`
- 当前写法：
  - `tx.asset.create`
  - `tx.uploadBatch.create`

这是阶段 B 最关键的写入口之一。

当前写法：

- `asset.create({ data: { tenantId, collectionId, title, description } })`
- `uploadBatch.create({ data: { tenantId, assetId, userId, chatId, status, items } })`

阶段 B 建议：

- `asset.create.data` 补 `projectId: tenantId`
- `uploadBatch.create.data` 补 `projectId: tenantId`

### 入口 2

- 文件：[upload.ts](/E:/MU/chucun/src/services/use-cases/upload.ts)
- 场景：
  - `asset.update` 多处更新标题、描述、集合等

阶段 B 建议：

- 这些 `update` 不一定每处都要改
- 只要不改 `tenantId/projectId` 字段，可先不动
- 第一轮优先保证“新创建记录”双写正确

## 4.5 事件写入

### 入口 1

- 文件：[delivery-core.ts](/E:/MU/chucun/src/services/use-cases/delivery-core.ts)
- 函数：`trackOpen`
- 当前写法：
  - `deps.prisma.event.create({ data: { tenantId: projectId, userId, assetId, type: "OPEN" } })`

阶段 B 建议：

- `data` 补 `projectId: projectId`

### 入口 2

- 文件：[delivery-core.ts](/E:/MU/chucun/src/services/use-cases/delivery-core.ts)
- 函数：`trackVisit`
- 当前写法：
  - `deps.prisma.event.create({ data: { tenantId, userId, type: "IMPRESSION", payload } })`

阶段 B 建议：

- `data` 补 `projectId: tenantId`

说明：

- 事件写入量较大，但改动点很集中
- 是阶段 B 适合尽早完成的一类入口

## 4.6 推送草稿写入

### 入口 1

- 文件：[delivery-admin.ts](/E:/MU/chucun/src/services/use-cases/delivery-admin.ts)
- 函数：`createBroadcastDraft`
- 当前写法：
  - `deps.prisma.broadcast.create`
  - `data: { tenantId: projectId, creatorUserId, creatorChatId, status: "DRAFT", contentHtml: "" }`

阶段 B 建议：

- `create.data` 补 `projectId: projectId`

### 入口 2

- 文件：[delivery-admin.ts](/E:/MU/chucun/src/services/use-cases/delivery-admin.ts)
- 函数：
  - `updateBroadcastDraftContent`
  - `updateBroadcastDraftButtons`
  - `scheduleBroadcast`
  - `cancelBroadcast`

说明：

- 这些多数是按 `id` 更新，不重新写 `tenantId`
- 第一轮可以不改
- 但后续若要加强“update 也显式补 projectId”的一致性，可作为第二轮收口

## 5. 第一轮双写推荐顺序

建议按下面顺序推进，而不是一次铺开：

1. [delivery-storage.ts](/E:/MU/chucun/src/services/use-cases/delivery-storage.ts)
   - `upsertSetting`
   - `upsertPreference`
2. [delivery-tenant-vault.ts](/E:/MU/chucun/src/services/use-cases/delivery-tenant-vault.ts)
   - `upsertProjectUserFromTelegram`
3. [delivery-core.ts](/E:/MU/chucun/src/services/use-cases/delivery-core.ts)
   - `bootstrapProjectSettings`
   - `setProjectMinReplicas`
   - `trackOpen`
   - `trackVisit`
4. [upload.ts](/E:/MU/chucun/src/services/use-cases/upload.ts)
   - `commitBatch`
5. [delivery-admin.ts](/E:/MU/chucun/src/services/use-cases/delivery-admin.ts)
   - `createBroadcastDraft`

这样排序的原因：

- 先集中、低风险、好验证的写入口
- 再碰资产/上传
- 最后碰推送草稿

## 6. 第一轮明确不做的事

第一轮双写不建议同时做：

- 读路径切换
- `TenantMember` / `TenantVaultBinding` / `TenantTopic`
- `Tag` / `AssetTag`
- 评论/点赞表
- worker 深层写路径扩散清理

原因：

- 会把阶段 B 的第一步扩太大
- 不利于定位“是双写问题还是读路径问题”

## 7. 推荐的实现方式

### 7.1 轻量 helper 方案

优先推荐：

- 在现有 service 边界内新增轻量 helper
- 统一生成：
  - `createProjectScopedData({ tenantId, ...rest })`
  - 或更具体的 model helper

目标：

- 先减少重复
- 不做大重构

### 7.2 第一轮不要过度抽象

不建议第一轮就做：

- 通用 ORM 中间层
- 大而全 repository 改造
- 跨全部 model 的统一 DSL

原因：

- 当前最重要的是先让 P0 写路径稳定双写
- 不是设计新的持久化框架

## 8. 第一轮验证标准

第一轮双写改动完成后，至少应验证：

- 新建 `tenantSetting` 时 `tenantId/projectId` 同时存在
- 新建 `userPreference` 时 `tenantId/projectId` 同时存在
- 新建 `tenantUser` 时 `tenantId/projectId` 同时存在
- 新建 `asset` 与 `uploadBatch` 时 `tenantId/projectId` 同时存在
- 新建 `event` 时 `tenantId/projectId` 同时存在
- 新建 `broadcast` 草稿时 `tenantId/projectId` 同时存在
- `npm run test`
- `npm run build`
- `npm run preflight:project`

## 9. 当前建议的下一步

基于这份文档，下一步最合理的是：

1. 先改 [delivery-storage.ts](/E:/MU/chucun/src/services/use-cases/delivery-storage.ts)
2. 再改 [delivery-tenant-vault.ts](/E:/MU/chucun/src/services/use-cases/delivery-tenant-vault.ts)
3. 再改 [delivery-core.ts](/E:/MU/chucun/src/services/use-cases/delivery-core.ts)
4. 每轮都只做一小块并验证

一句话结论：

阶段 B 的 P0 双写不需要一上来大动架构，先把设置、用户、事件、资产/上传、推送草稿这些集中写入口逐个补上 `projectId`，就是当前最稳的起步方式。
