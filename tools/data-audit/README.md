# tools/data-audit — 数据来源与许可登记（W9）

## 为什么有它

论文与开源的第一问是"这些数据哪来的、能不能用、什么时候取的"。此前这些答案散在
README、脚本头注释与台账里，**且没有任何判据**保证新增数据资产会被登记——
新增一件数据文件，没有任何东西会提醒你补来源（AGENTS §七-7 的典型形态）。

## 是什么

| 文件                   | 角色                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `source-registry.json` | **权威源**：一组一行/一组多件，登记来源、许可、取数时间、覆盖范围、质量判据                             |
| `source-registry.mjs`  | 守卫：`git ls-files backend/data backend/static` 取**全集**（派生，不手写清单），逐件核对是否被某组覆盖 |

## 怎么用

```bash
node tools/data-audit/source-registry.mjs          # 核对；有未登记资产 ⇒ exit 1
node tools/data-audit/source-registry.mjs --json   # 机器可读
```

**新增数据资产时**：先在 `source-registry.json` 里登记，否则守卫红。
**来源一时查不清时**：把该组 `provenanceStatus` 置 `"pending"`，守卫会把它当**要还的债**打印出来
（当前 2 组待还：`flood-precomputed`、`terrain-tiles`）——**不允许静默留空**。

## 字段口径

| 字段               | 含义                                                                  |
| ------------------ | --------------------------------------------------------------------- |
| `source`           | 来源（能引证到机构/脚本；引不到就写「未确认」并把 status 置 pending） |
| `license`          | 许可或使用约束（发表/开源前必须逐条核）                               |
| `fetchedAt`        | 取数时间或"由哪条命令生成"                                            |
| `coverage`         | 覆盖范围（时间/空间/粒度）                                            |
| `quality`          | 可复跑的判据命令（不是形容词）                                        |
| `provenanceStatus` | `confirmed` / `pending`（pending = 债）                               |

## 质量检查（`quality-check.mjs`）

```bash
node tools/data-audit/quality-check.mjs          # 人读表格；有 FAIL 即 exit 1
node tools/data-audit/quality-check.mjs --json   # 机器可读
```

判据由登记表驱动（资产集由 `git ls-files` 派生），覆盖**文件型资产**：

| 族     | 判据                                                                                  |
| ------ | ------------------------------------------------------------------------------------- |
| 序列   | `data.<港>.historical/forecast`：月份严格递增不重复、值有限、各港点数一致             |
| 空间   | `spatial` 锚点、设施点 `lng/lat`、水域面顶点必须落在项目域（lon 107–111 / lat 20–23） |
| 结构   | 设施点 id 唯一且含高程；洪涝统计非负；水位模拟区间含默认值                            |
| 元数据 | 文件自带 `updatedAt/createdAt` 只**报告**不判红（那是给人看的债）                     |

**诚实边界（别当已覆盖）**：**库内表**的质量判据——3 张承重表的空值率 / 范围越界 / 几何有效性——
**尚未做**。它需要 DB 客户端路径与 CI 门控口径（不做门控就会在 CI 里必红或悄悄跳过），属下一笔。
本件**不假装覆盖了库**。
