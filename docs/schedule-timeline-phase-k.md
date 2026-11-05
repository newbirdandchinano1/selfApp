# 日程表时间线 · 阶段 K

默认切换到时间线日视图；App `timeline_write` 在桌面 J 读路径对齐后默认开。

## 变更

| 项 | 行为 |
|----|------|
| App 日视图 | 阶段 L 起固定时间线（无经典格子 UI） |
| `SCHEDULE_TIMELINE_WRITE_DEFAULT` | `true`（无键 / 读失败 → 按分钟写入；可设置关回选格） |
| 桌面 `timeline_ui` | 默认 `true`；可关回三列经典格子 |
| 桌面 `timeline_write` | 仍默认 `false`（决议：桌面写路径谨慎开） |

已显式写入 `0` 的用户仍走其本地选择（尊重其选择）。

## 观察期（≥1–2 周）

关注：同步错误率、orphaned 激增、崩溃、桌面读分钟错位。  
通过后再评估停双写 / DROP 旧列（决议 #17，依赖桌面写入稳定 ≥14 天）。

## 回滚

- App：设置关掉「按分钟写入」
- 代码：将 `SCHEDULE_TIMELINE_WRITE_DEFAULT` 改回 `false`
