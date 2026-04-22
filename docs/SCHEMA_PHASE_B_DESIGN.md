# Schema 阶段 B 设计稿

## 1. 文档定位

本文档用于承接阶段 A 三轮复演之后的下一阶段设计。

它承接：

- [SCHEMA_CLEANUP_DESIGN.md](/E:/MU/chucun/docs/SCHEMA_CLEANUP_DESIGN.md)
- [SCHEMA_PHASE_A_REHEARSAL_RESULT.md](/E:/MU/chucun/docs/SCHEMA_PHASE_A_REHEARSAL_RESULT.md)
- [SCHEMA_PHASE_A_PRISMA_CHANGESET.md](/E:/MU/chucun/docs/SCHEMA_PHASE_A_PRISMA_CHANGESET.md)

目标：

- 设计阶段 B 的双写 / 切读策略
- 明确哪些表可以先切，哪些必须继续兼容
- 把“当前运行 tenant = `vault`、库内仍有 `prod`”写成正式前提

本文档不是阶段 B 的执行单，也不是阶段 D 的清理方案。

## 2. 当前真实前提

基于第三次、生产备份恢复库复演，阶段 B 必须接受以下事实：

- 当前生产运行时命中的 `TENANT_CODE` 是 `vault`
- 生产数据库中实际存在两个 tenant：
  - `vault`
  - `prod`
- `vault` 是当前运行主路径
- `prod` 不是空壳，而是仍然有真实历史数据

关键数据规模：

- `Asset`
  - `vault`: `611`
  - `prod`: `225`
- `Event`
  - `vault`: `95205`
  - `prod`: `17691`
- `TenantUser`
  - `vault`: `2864`
  - `prod`: `388`
- `UploadBatch`
  - `vault`: `611`
  - `prod`: `225`
- `TenantSetting`
  - `vault`: `8`
  - `prod`: `8`

因此，阶段 B 不能再沿用这些错误前提：

- “生产数据库只有一个 tenant”
- “可以直接按物理单项目态切读”
- “只要当前运行正常，就可以忽略 `prod`”

## 3. 阶段 B 的目标

阶段 B 的目标不是清理旧字段，而是：

1. 让当前运行主路径开始优先写入 `projectId`
2. 让高价值读路径开始优先读 `projectId`
3. 同时保证：
   - 当前运行 tenant `vault` 不回归
   - 历史 `prod` 数据仍然可读
   - 旧 `tenantId` 兼容路径仍可回退

换句话说，阶段 B 是“让新旧结构并行稳定一段时间”，不是“宣布 tenant 已经没用了”。

## 4. 阶段 B 明确不做的事

阶段 B 不做以下事情：

- 不删除任何 `tenantId`
- 不删除任何旧索引/旧约束
- 不删除 `Tenant*` 兼容表
- 不直接把所有查询改成只认 `projectId`
- 不直接把数据库解释为“只有一个项目”
- 不进入 schema 物理清理

## 5. 阶段 B 的核心问题

阶段 B 必须回答这三个问题。

### 5.1 双写范围

双写到底覆盖谁：

- 只覆盖当前运行 tenant `vault`
- 还是覆盖库内所有已有 tenant 行

当前建议：

- 写路径双写应覆盖所有新写入和新更新
- 对历史存量数据，仍由 backfill 负责
- 不以“只服务 `vault`”为借口跳过 `prod` 的结构兼容

### 5.2 切读范围

哪些读路径可以优先切到 `projectId`：

- 当前运行时强依赖的主路径
- 但不能要求所有历史查询立即同步完成

当前建议：

- 先切“当前运行主路径会命中的读”
- 保留按 `tenantId` 回退的兼容读法

### 5.3 历史 `prod` 的策略

`prod` 到底怎么处理：

- 继续可读
- 暂不作为当前运行主路径
- 暂不做任何物理清理

当前建议：

- 阶段 B 只要求 `prod` 在新旧字段并行期间继续可读
- 不要求立刻让 `prod` 走 project-first 业务心智
- 但必须避免未来切读时把 `prod` 历史数据读坏

## 6. 建议的双写策略

## 6.1 双写对象

阶段 B 首批双写对象继续限定在 P0 表：

- `TenantUser`
- `Asset`
- `Collection`
- `Event`
- `UploadBatch`
- `UserPreference`
- `TenantSetting`
- `Broadcast`

## 6.2 双写原则

所有新写入或更新应满足：

- `tenantId` 继续按旧逻辑写
- `projectId` 同时写入，且值与 `tenantId` 一致

写入原则：

- 不依赖运行时“当前 tenant 只有一个”的假设
- 以当前业务真实命中的 `tenantId` 为准
- 在代码里统一写成：
  - `projectId = resolvedTenantId`

## 6.3 双写位置建议

优先改这些集中入口：

- 设置写入入口
- 用户 upsert 入口
- 资产创建入口
- 上传批次创建入口
- 事件写入入口
- 推送草稿创建入口

原因：

- 它们是集中写入口
- 改动点少
- 更容易验证“旧写入没回归”

## 7. 建议的切读策略

## 7.1 切读总原则

阶段 B 的切读必须采用：

- 优先按 `projectId` 读
- 读不到时回退按 `tenantId` 读

原因：

- 阶段 B 仍处于兼容期
- 需要保证历史数据、回退路径、未完成 backfill 的边界都可控

## 7.2 推荐的切读顺序

建议从低风险到高风险：

1. `TenantSetting`
2. `UserPreference`
3. `TenantUser`
4. `Broadcast`
5. `Asset` / `Collection`
6. `UploadBatch`
7. `Event`

这样排的原因：

- 先切配置和用户映射
- 再切不直接影响交付主链路的对象
- 最后才碰事件和上传

## 7.3 暂不建议先切的部分

以下内容不建议在阶段 B 一上来就切：

- `TenantVaultBinding`
- `TenantTopic`
- `PermissionRule`
- `VaultGroup`
- `Tag` / `AssetTag`
- 评论/点赞互动表

原因：

- 它们不是 P0 主阻塞
- 与高频运行路径耦合更深
- 容易把阶段 B 扩成过大改造

## 8. 阶段 B 的代码设计建议

### 8.1 写路径封装

建议先把这些写入口收敛成共享 helper：

- `writeProjectScopedSetting`
- `writeProjectScopedUser`
- `writeProjectScopedAsset`
- `writeProjectScopedEvent`
- `writeProjectScopedBatch`
- `writeProjectScopedBroadcast`

核心要求：

- helper 内统一双写 `tenantId/projectId`
- 上层业务不分散重复写双字段逻辑

### 8.2 读路径封装

建议新增或收敛一类 helper：

- `findProjectScopedSetting`
- `findProjectScopedUser`
- `findProjectScopedAsset`
- `findProjectScopedBatch`
- `findProjectScopedBroadcast`

核心要求：

- helper 内统一实现：
  - 先 `projectId`
  - 后 `tenantId`

### 8.3 日志要求

阶段 B 的日志应开始区分两个概念：

- `runtimeProjectCode`
- `resolvedTenantId`

不要因为引入 `projectId` 就把底层真实命中关系写糊。

## 9. 阶段 B 的验证标准

只有满足以下条件，才能说阶段 B 开始进入可执行状态：

- 新写入都能同时落 `tenantId` 和 `projectId`
- 切读后的主路径对 `vault` 不回归
- `prod` 历史数据仍可读
- `npm run test` 通过
- `npm run build` 通过
- `npm run preflight:project` 通过
- 影子环境复演仍可通过

## 10. 风险点

阶段 B 的主要风险不是 schema，而是语义误判：

- 把“当前运行是 `vault`”误当成“库里只有 `vault`”
- 切读时只验证当前运行主路径，漏掉 `prod`
- helper 没收敛，导致双写逻辑到处复制
- 过早把低风险切读和高风险交付链路混在同一轮

## 11. 推荐的当前下一步

基于当前结果，最合理的推进顺序是：

1. 先写阶段 B 的 P0 双写设计草案
2. 明确每个写入口的落点文件
3. 再写阶段 B 的 P0 切读设计草案
4. 最后才开始小步改代码

一句话结论：

阶段 B 不是“把阶段 A 的 `projectId` 真正用起来”这么简单，而是要在“当前运行 tenant = `vault`、库内仍有 `prod`”的前提下，设计一套可双写、可切读、可回退的兼容期方案。
