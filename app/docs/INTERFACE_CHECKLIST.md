# FRIGO Interface Checklist

Day 1 接口登记；开发者 B 提出，Owner A 尚未确认。最后整理：2026-11-05。

所有条目目前均为 **Proposed**。名称、用途和使用方是讨论起点；函数名中的 `()` 不表示已确定无参数。同步/异步、参数、返回类型、错误处理均未锁定。本轮不创建类型声明、桩函数或实现。

## 状态与确认记录

`Proposed → Agreed → Implemented → Tested`

- Proposed：已提出，等待 Owner 与使用方讨论。
- Agreed：双方明确确认名称、语义、参数、返回值与错误约定，并在条目下记录确认人、日期及 PR/讨论链接。不能仅由 AI 改状态认定已确认。
- Implemented：实现已完成，记录实现位置，尚不代表测试通过。
- Tested：相关测试已通过，记录测试命令、日期和结果。
- 每次更新同步修改 Last Updated。已确认接口的新修改应单独登记变更提案，保留当前有效约定，获确认后再实施。

## 初始接口

| Interface Name | Owner | Used By | Purpose | Parameters | Return Type | Error Format | Status | Last Updated |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `wallet.getBalance()` | A | B：repair / detector / voyage / exploration（拟） | 查询当前 GP 余额 | 待双方确认 | 待双方确认；包括同步/异步 | 待双方确认 | Proposed | 2026-11-05 |
| `transaction.execute()` | A | B：repair / detector / voyage / exploration（拟） | 请求一次经济操作；扣费、结果保存与重复调用的边界需讨论 | 待双方确认 | 待双方确认；包括同步/异步 | 待双方确认 | Proposed | 2026-11-05 |
| `gameStorage.load()` | A | A：初始化；B：恢复游戏进度（拟） | 读取已保存的数据；读取范围和存档版本待讨论 | 待双方确认 | 待双方确认；包括同步/异步 | 待双方确认 | Proposed | 2026-11-05 |
| `gameStorage.save()` | A | A：数据保存；B：游戏进度保存（拟） | 保存数据；与 transaction 的职责边界待讨论 | 待双方确认 | 待双方确认；包括同步/异步 | 待双方确认 | Proposed | 2026-11-05 |
| `clock.getLocalDate()` | A | A：每日奖励；B：story / letters / detector（拟） | 提供本地日期；日期格式、跨日和测试时钟待讨论 | 待双方确认 | 待双方确认；包括同步/异步 | 待双方确认 | Proposed | 2026-11-05 |
| `food.getSnapshot()` | A | B：detector / exploration（拟） | 查询食物状态；字段、只读约束和副本语义待讨论 | 待双方确认 | 待双方确认；包括同步/异步 | 待双方确认 | Proposed | 2026-11-05 |
| `food.subscribeEvents()` | A | B：detector / progression（拟） | 订阅食物操作；事件种类、载荷、取消订阅和重复处理待讨论 | 待双方确认 | 待双方确认；包括同步/异步 | 待双方确认 | Proposed | 2026-11-05 |

## 逐项确认与验证记录

确认某一接口时在此新增记录，使用以下模板。未填写不代表已确认。

- Interface Name：
- 提案/变更说明：
- 已确认的 Parameters / Return Type / Error Format（含同步/异步）：
- Owner 与使用方确认人、日期、PR/讨论链接：
- 实现文件：
- 测试命令、日期、结果及未验证事项：
- Status / Last Updated：

## Day 1 查重与验证

- 基线：`origin/main` 的 `def9de0`。
- 在现有 HTML / JS / TS / Markdown 中搜索上述接口名称及核心方法名，未找到对应接口实现。
- 原网页有内部 `save()`，仅用于 `frigoFridgeTune` 网页调参数据，不是游戏存档服务；不修改，也不直接视为可复用跨模块接口。
- 本轮只有文档和空目录占位，无可执行游戏模块或游戏测试框架；接口状态全部保持 Proposed。
