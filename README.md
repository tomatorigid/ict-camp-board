# ict-camp-board

第十一届华为 ICT 大赛 · 昇腾 AI 算子开发赛道（决赛）参赛队 **哦不对一一哦对的对的** 的提交看板。

静态页，纯前端渲染，无后端、无登录、无第三方依赖。

## 看板显示什么

每道题一行卡片，取自 CANNJudge 公开排名接口里本队的记录：

| 字段 | 来源 |
|------|------|
| 最新提交者 | 排名接口的 `submitter.nickname` |
| 提交时间 | `create_time`，接口返回 UTC，页面统一换算成北京时间（UTC+8） |
| 分数 | `score`（单题 0–100 分） |
| 状态 | `status`（如 `Pass`），未提交的题显示"未提交" |
| 单个测试点用时 | `result[].time`（微秒），与 `testcases[].tbest`（全场最佳）对照 |
| 排名 | `rank` |

隐藏测试点（`testcase_status = Hidden`）在接口里不含用时，页面用灰色格子表示，不做估算。

分数、状态、用时**一律以 CANNJudge 测试界面为准**；本页面只是同一份公开数据的可视化，若与界面不一致，以界面为准并在仓库提 issue。

## 数据怎么刷新

两种方式，效果相同：

1. **自动**：`.github/workflows/refresh.yml` 每 6 小时跑一次 `fetch_data.py`，`data.json` 有变化就提交；也可以在 Actions 页手动 `Run workflow`。
2. **手动**：本地执行

   ```bash
   python fetch_data.py        # 覆盖 data.json
   git add data.json && git commit -m "chore: refresh" && git push
   ```

`fetch_data.py` 只访问两个公开接口，不需要 token：

```
GET https://cannjudge.cn/api/problems/contest/<contest_id>
GET https://cannjudge.cn/api/problems/<problem_id>/ranking?page=1&size=50&q=<队伍名>
```

队伍名、赛事 ID 写在脚本顶部的 `TEAM` / `CONTEST_ID` 常量里。

## 本地预览

```bash
cd ict-camp-board
python -m http.server 8000
# 打开 http://127.0.0.1:8000/
```

`index.html` 用 `fetch('data.json')` 读数据，直接用 `file://` 打不开，必须起静态服务器。

## 目录

```
index.html              页面骨架
assets/style.css        样式
assets/app.js           渲染逻辑（卡片 / 筛选 / 排序 / 测试点明细）
data.json               数据快照，由 fetch_data.py 生成
fetch_data.py           抓取脚本
```

## 维护提示

- 题目难度与名称取自题目接口；难度系数用于页头的"难度加权合计"（难题 ×3、中题 ×2、易题 ×1）。
- 若赛事题号或 `contest_id` 变化，改 `fetch_data.py` 顶部常量即可。
- 页面不写入任何账号信息，抓取的是公开数据。
