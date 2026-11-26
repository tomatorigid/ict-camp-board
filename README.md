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

## 提交趋势折线图

点开任意题目卡片，明细块下方有一条折线图：

- **横轴**：提交次序（每次提交占一个等间距槽位），刻度上标该位置的提交日期（北京时间）
- **纵轴**：默认"可见测试点平均用时"（μs，越低越好），可切到"排行榜分数"（越高越好）
- **本队**（蓝线）：历次提交，点色区分状态（蓝=Pass，黑=其他）；两条来源合并去重：
  - `problems[].history.mine` — 登录账号（tomatorigid）的全量提交历史，能一次拿全
  - `problems[].history.team` — 本队排行榜行的**增量快照**，用来补上队友账号（如 everclover）的提交；每刷新一次多一个点
- **对手**（灰点）：排行榜前 30 名的快照，每次刷新只追加新的 submission，不重复；由 `problems[].history.rivals` 提供

> 切到"分数"时只画对手：CANNJudge 只对排行榜上**最新一次**提交给分数，历史提交详情里没有分数字段，所以本队历史折线只在"平均用时"下有数据。

历史数据是**增量累积**的：CANNJudge 的提交列表接口只对本人开放（匿名 401、查他人 403），所以本队历史靠带登录态抓取（`/api/submissions/user/<uid>`）；队友的历史只能靠每次刷新时抓本队排行榜行（`history.team`）慢慢积累，对手历史靠对排行榜做快照。第一次运行后折线是空的，随着刷新逐渐变长。

> 单位统一为 **μs**：排行榜接口返回的 `time`/`tbest` 是 ms，`fetch_data.py` 里的 `us_of()` 会乘 1000 转成 μs，历史快照（`history.*.a`）同样存 μs，所以图上只有一条纵轴。

## 数据怎么刷新

三条路，效果相同，都是让 `fetch_data.py` 跑一次然后提交 `data.json`：

1. **页面上点「立即抓取」**（最快，见下节）；
2. **自动**：`.github/workflows/refresh.yml` 由 GitHub 的 schedule 触发，一次 run 里连续抓 8 轮（每 5 分钟一轮），`data.json` 有变化就提交；任何推送到 `main` 也会顺带触发一次；
3. **本地手动**：

   ```bash
   python fetch_data.py        # 覆盖 data.json
   git add data.json && git commit -m "chore: refresh" && git push
   ```

### 按需抓取（「立即抓取」按钮）

点它会发生三件事：

1. 新标签打开 `<仓库>/actions/workflows/refresh.yml`——在那里点 **Run workflow**，GitHub 立刻跑一次 `fetch_data.py`；
2. 本页每 8 秒重读一次 `data.json`，一旦 `meta.generated_at` 变新，整页自动换成新数据并显示「✅ 已更新」；
3. 4 分钟没等到就提示你稍后点「重读」，并给出本地命令。

**为什么不能一键直接抓？** 判题机接口 `cannjudge.cn/api/...` 响应里没有 `Access-Control-Allow-Origin`，
浏览器按同源策略不许页面读它的响应；页面又是 GitHub Pages 的纯静态文件，没有后端可以代抓。
所以「抓取」只能交给 GitHub Actions 执行——按钮做的是**把这条链路缩短到两个点击**，并把结果自动接回来。

> 想变成真正的一键（页面直接拿到实时数据），需要一个带 CORS 的中转：例如免费部署一个 Cloudflare Worker
> 转发 `cannjudge.cn/api/...`（顺带也能替你触发 Actions，token 存在 Worker 里）。
> 公开 CORS 代理（allorigins / codetabs / r.jina.ai 等）实测在境内网络基本不通，不建议依赖。

### 数据为什么会滞后（重要）

GitHub 的 `schedule` 是**尽力而为**的：实测这个仓库 15 天累计只跑了 40 多次（名义上每 10 分钟一次应该有 2000+ 次），
定时任务经常被顺延几个小时。所以 `data.json` 的 `meta.generated_at` 可能比真实时间旧很多，
页面上的"提交于"就可能是几小时前的快照——**不是页面算错时间**。

为此工作流改成「一次 run 连续抓 8 轮 × 5 分钟 ≈ 40 分钟」：即使 cron 被跳过几次，数据也不会停在几小时前。
另外 `push` 触发加了 `paths-ignore: data.json`，避免机器人自己的数据提交反复触发新一轮。

页面这一侧也不再悄悄显示旧数据：

- 页头多一行 **"最近一次提交"**，取全队所有题目里最晚的那次提交（与单张卡片的"提交于"区分开）；
- 每次加载都显示 **"数据抓取 11/26 11:47（N 分钟前）"**，滞后超过 45 分钟整条变蓝并提示"数据已滞后 N 小时"。

发现滞后想立刻更新：点页面上的「立即抓取」，或在本地跑一条命令（会顺带抓取并发布）：

```powershell
powershell -ExecutionPolicy Bypass -File site\publish.ps1 -Fetch
```

`fetch_data.py` 默认只访问公开接口，不需要 token：

```
GET https://cannjudge.cn/api/problems/contest/<contest_id>
GET https://cannjudge.cn/api/problems/<problem_id>/ranking?page=1&size=50&q=<队伍名>
```

队伍名、赛事 ID 写在脚本顶部的 `TEAM` / `CONTEST_ID` 常量里。

### 让 CI 也刷新本队历史（可选）

上面两个方向（本队历史 / 对手快照）里，对手快照匿名就能抓，**本队历史需要登录态**。在仓库 `Settings → Secrets and variables → Actions` 配任意一种即可：

| Secret | 说明 |
|--------|------|
| `CANNJUDGE_COOKIE` | 直接一条 `name=value; name2=value2` 的会话 Cookie |
| `CANNJUDGE_ACCOUNT` + `CANNJUDGE_PASSWORD` | 邮箱 + 密码，脚本会用验证码（内联 SVG，明文可解）自动登录 |

不配也能正常跑：`history.mine` 保留旧数据，`history.rivals` 照常增量更新。Cookie 过期后 CI 会打日志提示，重配一条新的即可。

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
