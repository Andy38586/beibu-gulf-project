# CLAUDE.md — 指针，不是副本

> **本项目的作业协议只有一份：[`AGENTS.md`](./AGENTS.md)。** 开工前读它，交付前按它的自查表过一遍。
>
> 本文件**故意不复制任何规则条文**：抄一份就是第二个口径，"冲突时以 AGENTS.md 为准"这句话救不了不读它的人。**在本文件里重新贴规则 = 违规。**

## 只给指路

| 你要找的                                                  | 去哪里                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------- |
| 铁律 / 任务→必读→回写矩阵 / 流程摘要                      | `AGENTS.md` §一 · §二 · §三                                               |
| 必须停下来问用户的 10 种情形                              | `AGENTS.md` §四                                                           |
| 「完成」定义 E1–E5 / 改完必跑 / 变异四式 / 绿的四条硬口径 | `AGENTS.md` §五                                                           |
| 记录义务（一单元一笔、修+测+台账同笔、commit 口径）       | `AGENTS.md` §六，细则见 `docs/契约/K4-开发与门禁契约.md`                  |
| 十类禁忌与修法形状                                        | `AGENTS.md` §七                                                           |
| 交付前自查（每格挂产物）                                  | `docs/契约/K4-开发与门禁契约.md`                                          |
| 文档三层、时间戳、权威切换与退役规则                      | `docs/宪法/C3-信息源宪法.md`                                              |
| 全量文档索引与阅读入口                                    | `docs/文档地图.md`                                                        |
| 技术规则集（改代码前按改动面查）                          | `docs/契约/K1-技术规则集.md`                                              |
| 审查窗六节交付与 `§0` 契约                                | `docs/根基文档/审查体系专项/审查体系约定.md`、`tools/audit-kit/README.md` |

## 技术栈速览（这部分 AGENTS.md 不写，可在此处维护）

Vue 3 + Pinia + Element Plus + ECharts + Cesium/OL 双引擎前端；NestJS 后端；PostGIS。
**前端没有独立 `package.json`，脚本全在仓库根**：`npm run typecheck`（前端）／`npm run typecheck --prefix backend`（后端）／`npm test`／`npm --prefix backend test`／`npm run cruise`／`npm run types:check`／`npm run stylelint`／`npm run guard:v3`／`npm run ci:local`（合并前）。
commit 格式由 `.husky/commit-msg` 的 commitlint 强制（`@commitlint/config-conventional`）：形式 `type: 中文说明`，type 取值与「禁 `type(scope):` 括号写法」的口径以 `AGENTS.md` §六 为准。
一个符合口径的示例（仅示意，规则本身不在此复制）：
例：`docs: 把协议抄本改成指针，消灭第二个口径`
已知 flake：`backend/test/task.e2e-spec.ts` 墙钟计时断言（归属与处置见 `AGENTS.md` §五「失败项归属」）。

## 本文件的机器约束

`tools/v3-guard/protocol-single-source.mjs` 断言：本文件**不得出现**禁忌表／铁律条文／"六类禁忌"之类的复制内容（命中即红）。要改规则，改 `AGENTS.md`；要改文档归类，改 `docs/宪法/C3-信息源宪法.md`。
