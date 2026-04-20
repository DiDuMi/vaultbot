# 去租户化重构计划

## 1. 文档目的

本文档用于为当前项目提供一份可持续执行的“彻底去租户化”重构计划，目标不是只做命名替换，而是逐步把系统从“多租户内核 + 单项目外观”收敛为“单项目内核 + 历史兼容层”。

这份文档重点解决三个问题：

- 后续每一轮重构做什么
- 为什么这样排序
- 如何在多人/多轮协作下不丢上下文

本文档默认与以下文档配套使用：

- `docs/SINGLE_OWNER_REFACTOR_PLAN.md`
- `docs/SINGLE_OWNER_STATUS.md`
- `docs/PROJECT_ISSUES_AND_PRIORITIES.md`
- `docs/UX_BOT_AUDIT_20260415.md`

## 2. 当前架构判断

### 2.1 当前真实状态

当前项目并不是“已经去租户化，只剩少量历史命名”，而是：

- 运行时仍通过 `TENANT_CODE -> tenantId` 建立主上下文
- 服务层虽然引入了 `project-*` 别名，但底层仍大量调用 `tenant-*`
- 数据库仍以 `Tenant / TenantMember / TenantVaultBinding / TenantTopic` 为核心骨架
- 绝大多数业务表仍显式依赖 `tenantId`
- Bot、worker、统计、配置、权限都仍带租户语义

因此，当前更准确的描述是：

- 已完成一轮“兼容式单项目收口”
- 尚未完成“彻底去租户化”

### 2.2 当前最主要的问题

当前问题不是单点代码脏，而是运行模型和产品心智不一致：

1. 运行模型仍是单 tenant 兼容模式
2. 产品心智已经在向单项目模式迁移
3. 维护语义同时存在 `tenant` 与 `project`
4. 用户体验仍残留平台式菜单和权限结构

这会持续带来三类损耗：

- 稳定性损耗：配置漂移、环境误配、错误 tenant 命中
- 研发损耗：新旧语义并存，接口和判断容易重复
- 体验损耗：菜单、角色、设置组织方式不符合单项目产品形态

## 3. 重构总目标

### 3.1 目标定义

本次重构的目标是把系统稳定收敛成：

- 单项目运行
- 单拥有者治理
- 普通用户访问
- 最小必要的历史兼容

换句话说，最终目标不是“保留多租户能力但默认只开一个”，而是：

- 多租户不再是默认心智
- 多租户不再是主要实现模型
- 多租户如果保留，也只能存在于兼容层

### 3.2 成功标准

满足以下条件时，才可认为“去租户化基本完成”：

- 业务主链路不再依赖外层显式传递 `tenantId`
- Bot/UI 层不再出现租户治理心智
- 服务层主接口不再以 `tenant-*` 语义组织
- 运维层不再通过 tenant 概念理解系统状态
- 生产环境不存在“误命中新 tenant”导致配置像被重置的风险
- 旧 `shareCode`、旧内容、副本交付链路保持可用

## 4. 重构原则

- KISS：先收口运行模型，再清理结构
- DRY：不再长期维护 `tenant` 与 `project` 两套对等入口
- YAGNI：不为假设中的未来平台化继续保留过重抽象
- 单一职责：业务能力、兼容层、迁移层、运维层边界必须清楚

补充原则：

- 不先做破坏性 schema 迁移
- 不先破坏旧分享链路
- 不先做大规模目录重命名
- 每一阶段都必须能独立验收
- 每一阶段都必须能说明回滚方式

## 5. 目标架构

### 5.1 目标心智模型

未来系统应统一围绕以下模型组织：

- `Project`
- `Owner`
- `Member`
- `Visitor`
- `Asset`
- `Collection`
- `Replica`
- `Broadcast`
- `ProjectSetting`

不再把以下概念作为外层主语：

- `Tenant`
- `TenantAdmin`
- `TenantVaultBinding`
- `TenantTopic`

### 5.2 目标分层

建议将架构收敛为四层：

#### A. Project Context Layer

职责：

- 提供唯一项目上下文
- 统一项目级配置与环境校验
- 屏蔽 `TENANT_CODE -> tenantId` 的历史细节

#### B. Application Service Layer

职责：

- 对 Bot、worker、脚本提供统一 `project-*` 用例接口
- 权限、设置、内容、发现、推送按项目语义组织

#### C. Compatibility Layer

职责：

- 在迁移期间兼容旧 schema、旧 `tenantId`、旧分享链路
- 将单项目语义映射到底层历史结构

约束：

- 兼容层只能向下暴露，不得继续向上扩散

#### D. Infrastructure Layer

职责：

- Prisma / Telegram / Redis / Queue / Worker 基础设施
- 存储群、话题、副本等技术实现

## 6. 分阶段计划

### 阶段 0：基线确认与上下文固化

目标：

- 确认当前代码、环境、文档、风险判断一致
- 固化后续多轮改造的上下文入口

实施内容：

- 指定本文档为“去租户化主计划”
- 指定 `docs/SINGLE_OWNER_STATUS.md` 为“当前状态快照”
- 指定 `docs/ITERATION_NOTES.md` 为“每轮实施记录”
- 为后续任务建立统一术语：`project` 为对外主语，`tenant` 为兼容层术语

交付物：

- 本文档
- 更新后的迭代记录规范

验收标准：

- 后续任一轮改造都能仅依赖这三份文档快速恢复上下文

### 阶段 1：运行边界彻底单项目化

目标：

- 把“单 tenant 运行”升级为“单 project 运行”
- 将 tenant 从运行时主语降级为兼容实现细节

实施内容：

- 增加统一的 `project context` 获取入口
- 收口 `getTenantId()` 的扩散访问
- 明确生产环境固定唯一项目
- 继续强化以下保护：
  - 固定 `EXPECTED_TENANT_CODE`
  - 启用 `REQUIRE_EXISTING_TENANT=1`
  - 默认禁止隐式 bootstrap 新 tenant
- 启动期、健康检查、诊断接口改为优先描述 `project` 状态

建议改造点：

- `src/config.ts`
- `src/index.ts`
- `src/infra/persistence/tenant-guard.ts`
- `src/services/use-cases/delivery-core.ts`

风险：

- 若上下文封装不稳，可能影响所有业务调用

验收标准：

- 上层业务模块不再直接关心 `TENANT_CODE`
- 运行期不会因误配自动进入新 tenant

### 阶段 2：服务层去租户语义

目标：

- 不再让应用层持续围绕 `tenant-*` 接口开发

实施内容：

- 建立真正的 `project service` 接口，而不是简单别名
- 将 `tenant settings` 内隐为 `project settings`
- 将 `tenant admin` 能力重构为 `owner/project management`
- 权限模型统一为：
  - `isProjectOwner`
  - `isProjectMember`
  - `canManageProject`
  - `canPublishAsset`

建议改造点：

- `src/services/use-cases/delivery.ts`
- `src/services/use-cases/delivery-admin.ts`
- `src/services/use-cases/delivery-discovery.ts`
- `src/services/use-cases/delivery-preferences.ts`
- `src/services/use-cases/delivery-social.ts`
- `src/services/use-cases/delivery-stats.ts`

风险：

- 接口变更面广，容易引起 UI 与 worker 适配遗漏

验收标准：

- 应用层新增需求默认只写 `project-*`
- `tenant-*` 只留在兼容层与底层仓储附近

### 阶段 3：Bot 与交互层重组

目标：

- 让用户体验真正符合单项目产品，而不是多租户平台残影

实施内容：

- 首页按角色重组：
  - 普通用户：`列表 / 搜索 / 我的`
  - 拥有者：`分享 / 列表 / 推送 / 设置`
- 设置页按任务重组：
  - 内容管理
  - 运营工具
  - 系统配置
- 统一按钮语言、导航规则、返回路径
- 下线或隐藏多租户治理入口
- 将“租户成员 / 管理员”文案切换为“项目成员 / 项目拥有者”

建议改造点：

- `src/bot/tenant/*`
- `src/i18n/messages/*`
- `docs/UX_BOT_AUDIT_20260415.md` 中列出的高频页面

风险：

- 交互改造容易出现页面跳转和按钮回退不一致

验收标准：

- 普通用户和拥有者都能在 1 到 2 次点击内进入高频任务
- 菜单、页面、按钮语言不再要求用户理解“租户”概念

### 阶段 4：存储治理简化

目标：

- 从“租户级资源编排”收敛为“项目级存储配置”

实施内容：

- 把 `TenantVaultBinding / TenantTopic` 的业务主语改为项目存储配置
- 主存储与兜底存储分层，不再保留平台化扩容心智
- worker 优先围绕：
  - 交付稳定
  - 最低冗余
  - 失败修复
  - 可观测性
- 弱化多副本、多群治理、多角色治理之间的耦合

建议改造点：

- `src/services/use-cases/delivery-tenant-vault.ts`
- `src/services/use-cases/delivery-replica-selection.ts`
- `src/worker/*`

风险：

- 直接影响上传、复制、交付、补副本链路

验收标准：

- 主链路能清楚回答“内容存在哪里、如何交付、失败怎么修”
- 运维不需要以 tenant 维度理解存储状态

### 阶段 5：兼容层收缩

目标：

- 把历史租户能力压缩到最小范围

实施内容：

- 将 `tenant-*` 命名移动到内部兼容实现
- 清理外层类型名、注释、日志上下文字段
- 将诊断、脚本、测试全部切换到 `project` 语义
- 逐步减少外层对 `tenantId` 的显式依赖

风险：

- 这一步容易看起来“只是在改名”，必须坚持只改有边界价值的部分

验收标准：

- 开发者阅读上层代码时，基本不再接触租户主语

### 阶段 6：Schema 清理评估与落地

目标：

- 在兼容式去租户化稳定后，决定是否进行物理清理

实施前置条件：

- 阶段 1 至 5 已稳定运行一段时间
- 已完成生产验证
- 已形成回滚方案
- 已完成数据迁移脚本设计

候选清理对象：

- `TenantMember`
- `TenantVaultBinding`
- `TenantTopic`
- `PermissionRule`
- 业务表中的显式 `tenantId`

不建议在以下情况下推进：

- 旧分享链路尚不稳定
- worker 复制与交付链路仍频繁改动
- 缺少回滚演练

验收标准：

- 物理结构清理不会破坏线上主链路
- 新结构比旧结构明显更简单，而不是只换一套名字

## 7. 模块级改造顺序建议

建议按下面顺序推进，而不是按目录平均铺开：

1. 运行上下文与启动校验
2. 服务层公共接口
3. 权限与设置
4. Bot 首页与设置页
5. 搜索/标签/列表/历史等发现链路
6. 推送与管理链路
7. 存储、副本、worker
8. 测试、脚本、文档、诊断接口
9. 最后再评估 schema

这样排序的原因：

- 先收口主语和边界
- 再收口高频应用层
- 最后再碰高风险基础设施和数据结构

## 8. 上下文保障机制

这一节是本文档最重要的部分之一，用来确保后续多轮协作不丢上下文。

### 8.1 文档职责分工

- `docs/DETENANT_REFACTOR_PLAN.md`
  - 负责长期目标、阶段计划、排序依据、边界约束
- `docs/SINGLE_OWNER_STATUS.md`
  - 负责记录当前已经做到哪里
- `docs/ITERATION_NOTES.md`
  - 负责记录每一轮具体做了什么、遗留什么、下一轮接什么

### 8.2 迭代记录模板

后续每一轮迭代建议在 `docs/ITERATION_NOTES.md` 追加以下内容：

```md
## YYYY-MM-DD - 迭代主题

### 本轮目标

### 实际改动

### 已验证内容

### 未解决问题

### 风险与观察

### 下一轮建议
```

### 8.3 术语约束

后续文档和代码说明建议统一：

- 对外产品语义：`project`
- 历史兼容语义：`tenant`
- 不再把 `tenant` 当作新功能设计主语

### 8.4 任务承接规则

后续无论谁继续推进，都应先读：

1. 本文档
2. `docs/SINGLE_OWNER_STATUS.md`
3. `docs/ITERATION_NOTES.md`

再进入代码实施，避免每次重新做全量判断。

## 9. 验证策略

每一阶段都至少覆盖以下验证：

- 启动与配置校验
- 上传链路
- 打开链路
- 搜索/标签/列表
- 设置读写
- 推送草稿与发送
- 旧 `shareCode` 访问
- worker 定时任务

建议最低执行：

- `npm run test`
- `npm run build`

如果阶段涉及交付链路或 worker，还应补充：

- 存储群可写性验证
- 副本选择验证
- 旧资源打开验证

## 10. 回滚策略

每一阶段都必须能回答以下问题：

- 如果失败，代码如何回退
- 如果失败，配置如何回退
- 如果失败，数据是否受影响
- 如果失败，旧分享是否仍可打开

阶段 1 到 5 原则上应尽量保持：

- schema 不变或只做可逆变更
- 数据结构不做破坏性清理
- 兼容路径先保留

只有阶段 6 才考虑真正的不可逆结构清理。

## 11. 风险矩阵

### P0 风险

- 环境变量误配导致进入错误 tenant
- 设置写入仍落在历史 tenant 维度
- 旧分享链路在重构中被误伤

### P1 风险

- 服务接口表面改名但底层边界未收敛
- Bot 页面重组后回退路径混乱
- worker 与应用层对存储状态理解不一致

### P2 风险

- 过早进入 schema 清理
- 大规模重命名导致噪音远大于收益
- 一边改体验一边改底层，导致问题定位困难

## 12. 近期执行建议

建议下一轮直接从“阶段 1：运行边界彻底单项目化”开始，但只做低风险收口：

- 建立统一 `project context`
- 收口 `getTenantId()` 入口
- 梳理启动期、配置期、诊断期的 project 语义
- 记录当前外层仍然直接依赖 `tenant-*` 的模块清单

在这一步完成前，不建议直接推进 schema 清理，也不建议优先做大规模目录重命名。

## 13. 结论

这个项目真正要做的不是“删掉几个 tenant 单词”，而是把系统主运行模型从租户模式切换为项目模式。

正确路径应当是：

- 先稳定运行边界
- 再重建服务层主语
- 再重组交互与存储治理
- 最后再决定是否做物理清理

这样做的好处是：

- 对生产更稳
- 对用户更友好
- 对后续维护更省心
- 对多轮协作更不容易丢上下文
