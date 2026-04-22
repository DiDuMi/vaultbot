# Schema 清理盘点报告

## 1. 文档定位

本文档用于承接 [SCHEMA_CLEANUP_DESIGN.md](/E:/MU/chucun/docs/SCHEMA_CLEANUP_DESIGN.md) 中定义的“生产数据盘点要求”。

用途：

- 固定 schema 清理前的数据盘点输出格式
- 记录当前生产或影子环境中的真实数据规模
- 为阶段 A 是否可以启动提供决策依据

本文档当前记录的是第一轮本地数据库盘点结果，可在后续盘点中继续更新。

## 2. 盘点元信息

- 盘点日期：`2026-04-21`
- 盘点环境：
  - 本地开发库
- 数据库实例：`postgresql://postgres:postgres@localhost:5432/chucun`
- 执行人：Codex
- 对应代码分支：`codex-simplify-single-owner`
- 对应 schema 版本：`prisma/schema.prisma @ 97a7bbc`
- 对应文档基线：
  - [SCHEMA_CLEANUP_DESIGN.md](/E:/MU/chucun/docs/SCHEMA_CLEANUP_DESIGN.md)
  - [SINGLE_OWNER_STATUS.md](/E:/MU/chucun/docs/SINGLE_OWNER_STATUS.md)

## 3. 结论摘要

### 3.1 总结论

- 是否只有 1 个活跃项目：是
- 是否发现非预期第二 `Tenant`：否
- 是否存在明显脏数据：否
- 是否建议启动阶段 A：可以开始阶段 A 设计准备，但仅限本地/影子环境，不等于可以直接执行生产迁移

### 3.2 核心判断

- 当前运行心智是否已可视为单项目：是
- 当前数据库是否仍明显依赖多租户兼容结构：是
- 当前是否具备进入 additive migration 设计的条件：是
- 当前是否绝对不应做 destructive migration：是

## 4. `Tenant` 主表盘点

### 4.1 租户列表

| Tenant ID | code | name | createdAt | updatedAt | 是否当前活跃 |
| --- | --- | --- | --- | --- | --- |
| `cmmd1wx2f00015m68o8c4s2x8` | `demo` | `demo` | `2026-03-05T05:54:57.254Z` | `2026-03-07T06:44:20.989Z` | 是 |

### 4.2 判断

- `Tenant` 总数：`1`
- 当前活跃 `Tenant` 数：`1`
- 是否存在历史遗留空项目：未发现
- 是否存在名称/编码异常：未发现

## 5. 关键兼容表盘点

### 5.1 `TenantMember`

| 维度 | 数值 |
| --- | --- |
| 总记录数 | `1` |
| 涉及 tenant 数 | `1` |
| OWNER 数 | `1` |
| ADMIN 数 | `0` |
| EDITOR 数 | `0` |
| SUPPORT 数 | `0` |
| ANALYST 数 | `0` |

观察：

- 是否真的还需要多成员模型：从当前本地数据看，需求非常弱，当前仅单 `OWNER`
- 是否存在非生产预期角色：未发现

### 5.2 `TenantVaultBinding`

| 维度 | 数值 |
| --- | --- |
| 总记录数 | `1` |
| 涉及 tenant 数 | `1` |
| PRIMARY 数 | `1` |
| BACKUP 数 | `0` |
| COLD 数 | `0` |

观察：

- 是否只剩单项目绑定：是
- 是否存在历史废弃绑定：未发现
- 是否存在 role 分布异常：未发现

### 5.3 `TenantTopic`

| 维度 | 数值 |
| --- | --- |
| 总记录数 | `2` |
| 涉及 tenant 数 | `1` |
| 涉及 vaultGroup 数 | `1` |
| 涉及 collection 数 | `2` |

观察：

- 是否仍有多个有效 collection topic 映射：有，但规模很小，当前表现为 `none` 与一个具体 collection 各 1 条
- 是否存在失效 topic：未发现
- 是否存在重复或异常版本：未发现

## 6. 业务表 `tenantId` 覆盖面盘点

建议至少覆盖以下表：

- `Asset`
- `Collection`
- `Tag`
- `AssetTag`
- `Event`
- `UploadBatch`
- `UserPreference`
- `TenantSetting`
- `Broadcast`
- `AssetComment`
- `AssetCommentLike`
- `AssetLike`

| 表名 | 总记录数 | tenantId 去重数 | 是否只落在单 tenant | 备注 |
| --- | --- | --- | --- | --- |
| Asset | `10` | `1` | 是 | 仅 1 个 tenant |
| Collection | `1` | `1` | 是 | 仅 1 个 tenant |
| Tag | `6` | `1` | 是 | 仅 1 个 tenant |
| AssetTag | `7` | `1` | 是 | 仅 1 个 tenant |
| Event | `191` | `1` | 是 | 仅 1 个 tenant |
| UploadBatch | `10` | `1` | 是 | 仅 1 个 tenant |
| UserPreference | `9` | `1` | 是 | 仅 1 个 tenant |
| TenantSetting | `3` | `1` | 是 | 仅 1 个 tenant |
| Broadcast | `1` | `1` | 是 | 仅 1 个 tenant |
| AssetComment | `31` | `1` | 是 | 仅 1 个 tenant |
| AssetCommentLike | `3` | `1` | 是 | 仅 1 个 tenant |
| AssetLike | `7` | `1` | 是 | 仅 1 个 tenant |

结论：

- 是否所有核心业务表都只落在同一个 `tenantId`：是
- 是否发现跨 tenant 历史污染：未发现

## 7. 存储与交付链路盘点

### 7.1 `VaultGroup`

| 维度 | 数值 |
| --- | --- |
| 总记录数 | `1` |
| ACTIVE 数 | `1` |
| DEGRADED 数 | `0` |
| BANNED 数 | `0` |

### 7.2 `AssetReplica`

| 维度 | 数值 |
| --- | --- |
| 总记录数 | `117` |
| ACTIVE 数 | `117` |
| BAD 数 | `0` |
| EVICTED 数 | `0` |
| 涉及 vaultGroup 数 | `1` |

### 7.3 上传与交付

| 表名 | 总记录数 | 关键状态分布 | 备注 |
| --- | --- | --- | --- |
| UploadBatch | `10` | `COMMITTED=10` | 无失败批次 |
| UploadItem | `117` | `SUCCESS=117` | 无失败条目 |
| Broadcast | `1` | `COMPLETED=1` | 无草稿残留 |
| BroadcastRun | `1` | `总数=1` | 与 Broadcast 对齐 |

观察：

- 当前是否依然依赖多副本治理：从本地数据看依赖很弱，当前仅单 vault group 运行
- 当前是否存在无有效副本的资产：本轮未发现
- 当前是否存在孤儿 `UploadItem` / `AssetReplica`：未发现

## 8. 异常与脏数据检查

建议按下面类别记录。

### 8.1 关联异常

| 异常类型 | 数量 | 说明 | 处理建议 |
| --- | --- | --- | --- |
| 无效 `vaultGroupId` | `0` | `TenantVaultBinding` 与 `TenantTopic` 未发现失效 vaultGroup | 暂无处理 |
| 无效 `collectionId` | `0` | `TenantTopic` 未发现失效 collection | 暂无处理 |
| 孤儿 `AssetReplica` | `0` | 未发现 replica 指向失效 asset | 暂无处理 |
| 孤儿 `UploadItem` | `0` | 未发现 replica 指向失效 uploadItem | 暂无处理 |
| 孤儿 `BroadcastRun` | `0` | 未发现 run 指向失效 broadcast | 暂无处理 |

### 8.2 语义异常

| 异常类型 | 数量 | 说明 | 处理建议 |
| --- | --- | --- | --- |
| 非预期第二 `Tenant` | `0` | 当前仅 `demo` 一个 tenant | 暂无处理 |
| 多 tenant 数据分裂 | `0` | 关键业务表均只命中一个 tenantId | 暂无处理 |
| role 分布异常 | `0` | 仅单 `OWNER`，符合单项目心智 | 暂无处理 |
| topic 映射异常 | `0` | 当前 2 条 topic 映射均有效 | 暂无处理 |
| setting 分布异常 | `0` | 当前 `TenantSetting` 共 3 条，均落在同一 tenant | 暂无处理 |

## 9. 对阶段 A 的影响判断

### 9.1 可启动项

- 是否可以开始设计 `projectId` 兼容字段：可以
- 是否可以开始准备 backfill 脚本：可以
- 是否可以先做只读视图或映射层：可以

### 9.2 暂不应启动项

- 是否暂不应切生产主读路径：是
- 是否暂不应双写：是，除非先完成影子环境验证
- 是否暂不应删除任何旧字段/旧表：是

### 9.3 决策结论

建议选择：

- 选项 A：只继续兼容式收口，暂不进入 schema 阶段
- 选项 B：进入阶段 A 设计，但不执行迁移
- 选项 C：进入阶段 A 并准备影子环境验证

当前推荐：

- 选项 B：进入阶段 A 设计，但不执行迁移

## 10. 建议 SQL 清单

以下 SQL 作为本轮盘点使用的模板，可按环境微调。

### 10.1 基础计数

```sql
select count(*) as tenant_count from "Tenant";
select count(*) as tenant_member_count from "TenantMember";
select count(*) as tenant_vault_binding_count from "TenantVaultBinding";
select count(*) as tenant_topic_count from "TenantTopic";
```

### 10.2 `tenantId` 去重范围

```sql
select 'Asset' as table_name, count(*) as row_count, count(distinct "tenantId") as tenant_scope from "Asset"
union all
select 'Collection', count(*), count(distinct "tenantId") from "Collection"
union all
select 'Tag', count(*), count(distinct "tenantId") from "Tag"
union all
select 'Event', count(*), count(distinct "tenantId") from "Event"
union all
select 'UploadBatch', count(*), count(distinct "tenantId") from "UploadBatch"
union all
select 'TenantSetting', count(*), count(distinct "tenantId") from "TenantSetting"
union all
select 'Broadcast', count(*), count(distinct "tenantId") from "Broadcast";
```

### 10.3 角色与绑定分布

```sql
select role, count(*) as member_count
from "TenantMember"
group by role
order by role;

select role, count(*) as binding_count
from "TenantVaultBinding"
group by role
order by role;
```

### 10.4 topic 分布

```sql
select "tenantId", "vaultGroupId", "collectionId", count(*) as topic_count
from "TenantTopic"
group by "tenantId", "vaultGroupId", "collectionId"
order by topic_count desc;
```

## 11. 填写完成后的下一步

本轮盘点完成后，下一步建议顺序：

1. 基于当前单 tenant 结果，单独产出阶段 A 的字段设计草案
2. 先写 backfill 与一致性校验脚本设计，不执行迁移
3. 在影子环境验证 additive migration 可行性
4. 等你确认后，再决定是否推进双写/切读准备

一句话结论：

盘点结果说明当前本地库已经非常接近“单项目兼容态”，因此可以开始阶段 A 的设计准备；但这仍不足以支持直接做生产 schema 清理或破坏性迁移。
