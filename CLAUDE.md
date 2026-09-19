# CLAUDE.md

> 完整协议在 [`AGENTS.md`](./AGENTS.md)：**开工前必读，交付前必查**。冲突时以 AGENTS.md 为准。

## 三条铁律

1. **证据先行** — 结论挂 `file:line` / 实测输出。无法确认就写「无法确认，需读 X」。
2. **不猜、不补、不编** — 先 grep 确认机制**存在且被调用**。禁止把注释当实现。
3. **改完必验证** — 不跑验证等于没完成。

## 开工前必读（不许跳）

1. `docs/根基文档/项目全景.md`（架构 + **工程红线**）
2. `docs/根基文档/04-防复发清单.md` **对应节**（渲染 A｜数据 B｜状态 C｜错误 D｜架构 E｜门禁 F｜安全 G｜文档 H｜清理 I）
3. `docs/待解决问题.md` — 已立案的按**原编号**接手，不新开号

## 六类禁忌（违反 = 不合格）

| #   | 禁忌       | 要求                                                       |
| --- | ---------- | ---------------------------------------------------------- |
| 1   | 契约单向   | 改跨端字段/枚举 → 两侧同改 + 补断言。禁止 `as` 缝合        |
| 2   | 写了就不管 | 新增守卫/清理/schema → 同 commit 内给出**调用点或测试**    |
| 3   | 无据的宣称 | 每个"已 X"都要有断言能验证；**引用的路径必须存在**         |
| 4   | 错级释放   | 新增监听/定时器/请求 → 同 commit 内写注销，与注册同作用域  |
| 5   | 无对照门禁 | 新增门禁 → 附一个能让它**变红**的样本                      |
| 6   | 扩展不继承 | 新增模块/通道 → 同步扩张守护规则、契约校验、清理、文档清单 |

## 必须停下来问用户

新增依赖 ｜ 改 schema 或删数据 ｜ 重写 git 历史 ｜ 凭据密钥 ｜ 跨 3+ 模块 ｜ **文档与实现矛盾（不自行选边）** ｜ 顺手重构 ｜ 验证无法完成

## 验证命令

```bash
npm run typecheck                    # 前端
npm run typecheck --prefix backend   # 后端
npm test                             # 前端测试
npm --prefix backend test            # 后端测试
npm run cruise                       # 架构契约
npm run types:check                  # 契约门禁
npm run guard:v3                     # v3 守卫
npm run ci:local                     # 全量门禁（合并前）
```

**前端没有独立 package.json**，脚本全在仓库根。已知 flake：`backend/test/task.e2e-spec.ts` 墙钟计时断言。

## git

commit 格式 **Conventional Commits**（`.husky/commit-msg` 的 commitlint 强制）：`type(scope): 中文说明`
type ∈ `feat｜fix｜docs｜chore｜refactor｜perf｜test｜ci｜build｜style｜revert`，scope 小写可选。
例：`fix(task): 穷尽派生 TASK_DOMAINS，修复 forecast-map 域恒 400`
**每修一项即提交**；禁 squash；禁 `--no-verify`。
