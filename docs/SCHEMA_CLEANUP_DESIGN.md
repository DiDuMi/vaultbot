# Schema 清理设计稿

## 1. 文档定位

本文档用于描述“兼容式单项目收口”完成后，未来如何安全评估并逐步执行 schema 清理。

它不是立即执行的删表方案，而是：

- 为后续 Prisma / PostgreSQL 清理提供设计边界
- 为生产数据盘点、迁移脚本、回滚脚本提供统一口径
- 明确哪些可以先做，哪些当前阶段绝对不能做

本文档与以下文档配套使用：

- `docs/DETENANT_REFACTOR_PLAN.md`
- `docs/DETENANT_EXECUTION_MATRIX.md`
- `docs/SINGLE_OWNER_STATUS.md`
- `docs/ITERATION_NOTES.md`
- `docs/SCHEMA_CLEANUP_READINESS.md`

当前日期基线：`2026-04-21`

## 2. 当前阶段判断

截至当前仓库状态，更准确的判断是：

- 业务与运行心智已接近单项目
- 生产入口、运维入口、核心服务入口已大幅 project-first
- 数据库仍然是多租户兼容内核
- schema 清理仍处于“设计阶段”，还不应直接执行物理删改

因此，当前目标不是“立刻去掉 Tenant”，而是：

1. 继续完成低风险兼容收口
2. 先把 schema 清理方案设计清楚
3. 只有在生产连续稳定后，才决定是否真正动库

## 3. 当前 schema 真实状态

以下内容基于当前 [schema.prisma](/E:/MU/chucun/prisma/schema.prisma)。

### 3.1 兼容内核主骨架

当前数据库仍以这些模型作为主骨架：

- `Tenant`
- `TenantMember`
- `TenantUser`
- `VaultGroup`
- `TenantVaultBinding`
- `TenantTopic`

其中：

- `Tenant` 仍是几乎所有业务表的根外键来源
- `TenantMember` 仍承载成员与角色
- `TenantVaultBinding` 仍承载项目与存储群绑定
- `TenantTopic` 仍承载项目与话题映射

### 3.2 仍显式依赖 `tenantId` 的业务表

当前 schema 中仍显式带 `tenantId` 的模型包括：

- `TenantMember`
- `TenantUser`
- `VaultGroup`
- `TenantVaultBinding`
- `TenantTopic`
- `Asset`
- `Tag`
- `AssetTag`
- `Collection`
- `PermissionRule`
- `Event`
- `UploadBatch`
- `UserPreference`
- `TenantSetting`
- `Broadcast`
- `AssetComment`
- `AssetCommentLike`
- `AssetLike`

这说明当前还远没有进入“只剩几个历史字段”的阶段。

### 3.3 对清理设计最重要的事实

当前设计必须接受以下事实：

- 旧 `shareCode` 链路仍要继续工作
- worker 上传、复制、交付链路仍以底层兼容结构为真实落点
- 多数查询、索引、唯一约束都围绕 `tenantId`
- 直接删除 `Tenant*` 或批量重命名 `tenantId` 会立刻进入高风险区

## 4. 清理目标

## 4.1 总目标

目标不是把所有名字机械替换成 `project`，而是把数据库结构收敛到“单项目产品”真正需要的最小集合。

建议的目标状态：

- 对外与高层代码统一使用 `project`
- 数据库只保留单项目运行真正需要的结构
- 历史多租户兼容结构要么被收缩到最小，要么被迁移并删除
- 旧 `shareCode`、上传、交付、推送、设置链路保持稳定

### 4.2 非目标

本文档不以以下事项为目标：

- 当前阶段直接改 Prisma schema
- 当前阶段直接跑破坏性迁移
- 当前阶段直接重命名 `src/bot/tenant/*`
- 当前阶段大范围替换所有 `tenant` 文本
- 当前阶段一次性修所有乱码文案

## 5. 推荐的最终结构方向

这部分是推荐方向，不代表本轮立即执行。

### 5.1 推荐保留的核心业务结构

这些模型代表单项目系统仍然需要的核心业务能力，建议保留，只是未来可能换成 project 语义命名：

- `Tenant` -> 推荐最终演进为 `Project`
- `TenantUser` -> 推荐最终演进为 `ProjectUser` 或等价单项目用户表
- `Asset`
- `Collection`
- `Tag`
- `AssetTag`
- `AssetReplica`
- `VaultGroup`
- `Event`
- `UploadBatch`
- `UploadItem`
- `Broadcast`
- `BroadcastRun`
- `AssetComment`
- `AssetCommentLike`
- `AssetLike`
- `UserPreference`
- `TenantSetting` -> 推荐最终演进为 `ProjectSetting`

### 5.2 推荐收缩或废弃的兼容结构

这些结构原则上不应长期保持当前形态：

- `TenantMember`
- `TenantVaultBinding`
- `TenantTopic`
- `PermissionRule`

推荐方向：

- `TenantMember`
  - 若最终仍需要成员能力，则收敛为最小 project 角色绑定
  - 若最终只保留单拥有者运营，可继续弱化，甚至降为单拥有者配置
- `TenantVaultBinding`
  - 收敛为项目存储配置，而不是多租户绑定模型
- `TenantTopic`
  - 收敛为项目/集合对应的交付路由配置，而不是租户话题映射
- `PermissionRule`
  - 若外层已稳定收敛到更简单可见性规则，可考虑并入资产/集合可见性模型

### 5.3 推荐字段方向

对未来长期结构，推荐：

- 外层术语统一使用 `projectId`
- 物理层不要一次性全表硬改
- 对会长期保留的表，优先考虑“新增兼容字段 + 双写 + 切读”
- 对明确会被删除的兼容表，不建议为了短期好看再补一轮大规模重命名

## 6. 生产数据盘点要求

真正进入 schema 清理前，必须先做数据盘点。没有盘点结果，不允许进入迁移执行。

### 6.1 必须回答的问题

- `Tenant` 当前有多少有效项目
- 是否只有 1 个生产活跃 `Tenant`
- `TenantMember` 当前有多少记录，角色分布是什么
- `TenantVaultBinding` 当前有多少记录，`PRIMARY/BACKUP/COLD` 分布是什么
- `TenantTopic` 当前有多少记录，按 `vaultGroupId / collectionId` 的分布是什么
- 各业务表当前实际涉及多少个不同 `tenantId`
- 是否存在历史脏数据：
  - 空绑定
  - 无效 `vaultGroupId`
  - 无效 `collectionId`
  - 孤儿 `AssetReplica`
  - `tenantId` 不一致的关联记录

### 6.2 建议盘点输出

建议在后续单独产出一份盘点报告，例如：

- `docs/SCHEMA_CLEANUP_INVENTORY.md`
- `docs/SCHEMA_CLEANUP_READINESS.md`

建议至少包含：

- 盘点时间
- 盘点环境
- 每张关键表的记录数
- `tenantId` 去重数
- 是否存在非预期第二项目
- 异常数据列表
- 是否满足进入阶段 A 的条件

### 6.3 建议 SQL 模板

以下 SQL 仅作为盘点模板，真正执行前应先在影子环境验证：

```sql
select count(*) as tenant_count from "Tenant";

select id, code, name, "createdAt", "updatedAt"
from "Tenant"
order by "createdAt" asc;

select role, count(*) as member_count
from "TenantMember"
group by role
order by role;

select role, count(*) as binding_count
from "TenantVaultBinding"
group by role
order by role;

select "tenantId", count(*) as topic_count
from "TenantTopic"
group by "tenantId"
order by topic_count desc;

select 'Asset' as table_name, count(distinct "tenantId") as tenant_scope from "Asset"
union all
select 'Collection', count(distinct "tenantId") from "Collection"
union all
select 'Tag', count(distinct "tenantId") from "Tag"
union all
select 'Event', count(distinct "tenantId") from "Event"
union all
select 'UploadBatch', count(distinct "tenantId") from "UploadBatch"
union all
select 'Broadcast', count(distinct "tenantId") from "Broadcast";
```

## 7. 迁移阶段设计

这里采用你当前最适合的四阶段设计：A、B、C、D。

### 7.1 阶段 A：加兼容字段 / 视图 / 映射

目标：

- 为未来迁移铺路
- 保持生产路径稳定
- 所有变更必须可逆

建议动作：

- 先冻结一版当前 schema 与生产数据盘点结果
- 为后续长期保留的表设计 `projectId` 兼容字段方案
- 为极少数高价值场景提供只读兼容视图或映射层
- 准备 backfill 脚本，但先不切主读路径

建议原则：

- 只做 additive migration，不做 destructive migration
- 只给未来会保留的表加兼容字段
- 对明确准备删除的兼容表，不要为了“名字整齐”先补一轮大迁移

推荐优先级：

1. `Tenant` / `TenantSetting`
2. `Asset` / `Collection`
3. `Broadcast` / `Event` / `UploadBatch`
4. 其余表视实际收益决定

阶段 A 退出条件：

- 盘点完成
- 字段/视图/映射设计完成
- backfill 脚本完成并在影子环境验证
- 不改生产主读路径

### 7.2 阶段 B：双写或双读

目标：

- 让新旧结构并行一段时间
- 验证新结构不会破坏线上行为

建议动作：

- 应用层开始优先写入新兼容字段
- 保留旧字段写入，确保可回滚
- 读路径采用：
  - 优先读新字段
  - 缺失时回退旧字段
- 为 backfill 补齐历史数据

建议原则：

- 先双写，后双读切换
- 每次只推进一类表，不并发扩面
- 任何阶段都不能影响旧 `shareCode`

建议监控项：

- 新旧字段计数是否一致
- 关键查询命中率是否一致
- worker 交付、复制、补副本是否出现偏差
- `project-check` 是否正常

阶段 B 退出条件：

- 历史数据 backfill 完成
- 新旧写入一致性验证通过
- 关键读链路在影子环境与生产抽检中一致

### 7.3 阶段 C：切读路径

目标：

- 让系统正式以新结构为主读路径
- 保留短期兼容回退能力

建议动作：

- 高层读路径切到 `projectId` 或新结构
- 兼容层继续兜底旧字段
- 逐步减少对旧表和旧字段的直接查询

切换顺序建议：

1. 设置与运维查询
2. 非核心统计与后台查询
3. 发现链路
4. 上传与交付链路
5. worker 内部读路径

不建议的顺序：

- 一上来先切上传/交付主链路
- 在 Bot 高频入口和 worker 主链路同一轮同时切读

阶段 C 退出条件：

- 主读路径稳定运行
- 连续多轮人工验收通过
- 兼容回退仍然可用

### 7.4 阶段 D：清旧字段 / 旧表

目标：

- 删除已经不再使用的兼容结构
- 完成真正的物理收口

执行前必须同时满足：

- 生产连续多轮稳定
- 人工验收 checklist 连续通过
- 你已确认不再需要回到多租户模式
- 迁移脚本和回滚脚本都准备完毕
- 最好已在影子环境或备份环境完整演练过一次

建议动作：

- 删除已停用旧字段
- 删除已停用旧索引与旧唯一约束
- 删除已停用兼容表
- 清理 Prisma model / migration / 兼容脚本

最后才考虑的对象：

- `TenantMember`
- `TenantVaultBinding`
- `TenantTopic`
- 业务表中的旧 `tenantId`

## 8. 回滚设计

每一阶段都必须独立回答“怎么回退”，否则不能执行。

### 8.1 阶段 A 回滚

- 回滚类型：低风险、可逆
- 方法：
  - 回退代码
  - 删除未启用的新读路径
  - 保留新增字段即可，不要求立刻删

### 8.2 阶段 B 回滚

- 回滚类型：中风险，但应保持可逆
- 方法：
  - 切回旧读路径
  - 保留双写，或临时只写旧字段
  - backfill 数据不删除，只停止使用

### 8.3 阶段 C 回滚

- 回滚类型：中高风险
- 方法：
  - 通过 feature flag 或兼容分支切回旧读路径
  - 保持旧字段、旧表仍在
  - 禁止在读路径刚切换后立刻清理旧结构

### 8.4 阶段 D 回滚

- 回滚类型：高风险，部分不可逆
- 方法：
  - 只能依赖预先准备的数据库备份、快照或回滚脚本
  - 因此阶段 D 必须在演练后再执行

## 9. 验收标准

无论哪个阶段，至少都要覆盖这些验收点：

- 旧 `shareCode` 不受影响
- 上传链路稳定
- 交付链路稳定
- 推送与草稿稳定
- 设置读写稳定
- `project-check` 正常
- 生产人工验收连续通过

建议最低验证命令：

- `npm run test`
- `npm run build`
- `npm run preflight:project`

如果阶段涉及 worker / 交付 / 存储，还应补充：

- worker 心跳正常
- 副本选择正常
- 旧资源打开正常
- topic / vault group 路由未漂移

## 10. 明确禁止项

在当前阶段以及未来真正进入迁移前，以下动作都不建议直接做：

- 直接删除 `Tenant*`
- 直接删除所有 `tenantId`
- 直接重命名 `bot/tenant` 目录
- 一轮内同时改 schema、worker、Bot 高频入口
- 未做数据盘点就发起迁移
- 未准备回滚脚本就做破坏性变更

## 11. 推荐的当前下一步

基于当前阶段，最推荐的顺序是：

1. 继续做 P2-1 低风险兼容清理
2. 补齐 `docs/SCHEMA_CLEANUP_INVENTORY.md` 所需的数据盘点项
3. 先写迁移脚本设计，不执行迁移
4. 等生产连续稳定后，再决定是否启动阶段 A

一句话结论：

当前最合理的动作不是“开始删 tenant”，而是“把删 tenant 之前必须知道的事先设计清楚、盘点清楚、回滚清楚”。
