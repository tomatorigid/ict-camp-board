#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""拉取 CANNJudge 接口上本队 10 道题的提交数据，生成 site/data.json。

公开接口（不需要登录）：
  GET /api/problems/contest/<contestId>               -> 题目列表
  GET /api/problems/<problemId>/ranking?q=<队伍名>     -> 该题排名（含最新提交者/分数/测试点用时/tbest）

折线图历史数据（history 字段）分两路：
  1) mine   —— 本队账号的完整提交历史：GET /api/submissions/user/<uid>（需登录）
               + GET /api/submissions/<sid> 详情（只补新增 sid）。
               登录方式（优先级依次）：环境变量 CANNJUDGE_COOKIE /
               同目录 .cannjudge_cookie 文件 / CANNJUDGE_ACCOUNT+CANNJUDGE_PASSWORD 自动登录
               （验证码是内联 SVG，<text> 明文，直接解析）。拿不到登录态时保留旧数据。
  2) rivals —— 公开 ranking 前 N 名每次刷新的快照点（每人每次最新提交一个点），
               按 submission_id 去重增量累积，随时间自动形成对手曲线。

用法:
  python fetch_data.py            # 写入同目录 data.json
  python fetch_data.py --check    # 只打印，不写文件
  python fetch_data.py --no-history   # 跳过历史部分（老行为）
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

BASE = "https://cannjudge.cn"
TEAM = "哦不对一一哦对的对的"

# Windows GBK 控制台打不出 emoji（✅/⏳），统一切 UTF-8（CI/Linux 上无副作用）
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

# 决赛分两批下发赛题：第一批已开放，第二批 2027/01/05 起。拿到第二批的 contest_id 后填进来即可，
# 其余代码不用改；页面上会自动多出一组卡片。
BATCHES = [
    {
        "key": "b1",
        "label": "第一批",
        "period": "2026/11/02 – 2026/12/28",
        "start": "2026-11-02",
        "end": "2026-12-28 23:59:00",
        "min_problems": 10,
        "contest_id": "6a9e2d04bf41025d60f21804",
    },
    {
        "key": "b2",
        "label": "第二批",
        "period": "2027/01/05 – 2027/03/04",
        "start": "2027-01-05",
        "end": "2027-03-04 23:59:00",
        "min_problems": 10,
        "contest_id": None,  # TODO: 开放后填入
    },
]

# 名称以题目列表接口为准，这里只保留展示顺序与难度兜底值
FALLBACK_DIFFICULTY = {
    "ConcatD": 3,
    "ConfusionTransposeD": 3,
    "CTCLossV2": 2,
    "LayerNormV3": 2,
    "MultilabelMarginLoss": 2,
    "PadV3Grad": 3,
    "PReluGradUpdate": 1,
    "QuantUpdateScatter": 2,
    "StridedSliceGrad": 3,
    "SyncBatchNormGatherStats": 2,
}

CST = timezone(timedelta(hours=8))
UA = {"User-Agent": "Mozilla/5.0 (ICT_CAMP dashboard data fetcher)"}


def get(path, retries=3, timeout=30):
    url = BASE + path
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            last = e
            time.sleep(1.5 * (i + 1))
    raise SystemExit(f"请求失败: {url}\n{last}")


def iso_local(dt_str):
    """2026-11-11T07:56:45.018Z -> 2026-11-11 15:56:45 (UTC+8)"""
    if not dt_str:
        return None
    s = dt_str.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return dt_str
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(CST).strftime("%Y-%m-%d %H:%M:%S")


def us_of(v):
    """排行榜行里的 time / tbest 单位是 ms → μs（None 原样返回）。"""
    if v is None:
        return None
    try:
        return round(float(v) * 1000, 1)
    except (TypeError, ValueError):
        return None


def fetch_problem(problem, batch_key):
    pid = problem["_id"]
    slug = problem.get("canonical_name") or problem.get("name")
    q = urllib.parse.quote(TEAM)
    ranking = get(f"/api/problems/{pid}/ranking?page=1&size=50&q={q}")

    best = {}
    for tc in ranking.get("testcases") or []:
        best[tc.get("id") or tc.get("_id")] = tc.get("tbest")

    row = None
    for r in ranking.get("rows") or []:
        if ((r.get("team") or {}).get("team_name") or "") == TEAM:
            row = r
            break

    item = {
        "id": problem.get("ID"),
        "pid": pid,
        "batch": batch_key,
        "title": problem.get("title"),
        "slug": slug,
        "difficulty": problem.get("difficulty") or FALLBACK_DIFFICULTY.get(problem.get("title"), 1),
        "cann_version": problem.get("cann_version"),
        "start_time": iso_local(problem.get("start_time")),
        "end_time": iso_local(problem.get("end_time")),
        "testcase_total": ranking.get("total_testcase_count") or len(ranking.get("testcases") or []),
        "team_total_teams": ranking.get("total"),
        "url": f"{BASE}/public/ictcompetition/{slug}",
        "ranking_url": f"{BASE}/public/ictcompetition/{slug}/ranking",
    }

    if not row:
        item.update(
            {
                "submitted": False,
                "rank": None,
                "submitter": None,
                "status": "未提交",
                "score": 0.0,
                "submit_time": None,
                "testcases": [],
            }
        )
        return item

    results = row.get("result") or []
    tcs = []
    for idx, res in enumerate(results, start=1):
        tcs.append(
            {
                "i": idx,
                "status": res.get("testcase_status"),
                # 排行榜行里的 time/tbest 单位是 ms，统一换成 μs（历史点也按 μs 存）
                "time": us_of(res.get("time")),
                "precision": res.get("precision_ratio"),
                "best": us_of(best.get(res.get("testcase_id"))),
            }
        )

    item.update(
        {
            "submitted": True,
            "rank": row.get("rank"),
            "submitter": (row.get("submitter") or {}).get("nickname"),
            "status": row.get("status"),
            "score": row.get("score") or 0.0,
            "submit_time": iso_local(row.get("create_time")),
            "submission_id": row.get("submission_id"),
            "testcases": tcs,
        }
    )
    return item


# ------------------------------------------------------- 历史数据（折线图）

HISTORY_UID = "6add72601dac5d235b3dd74e"   # tomatorigid：全队提交都挂这个账号
RIVAL_TOP = 30      # 公开 ranking 取前 N 名做增量快照
RIVAL_CAP = 240     # 每题保留的对手快照点数
MINE_CAP = 150      # 每题保留的本队登录账号历史点数
TEAM_CAP = 240      # 每题保留的"队友快照"点数（排行榜行，含其他队友账号）


def api_full(path, method="GET", payload=None, cookie=None, timeout=30):
    """带 Cookie / POST 的通用请求，返回 (status, body, resp_headers)。"""
    url = BASE + urllib.parse.quote(path, safe="/?&=:%,")
    headers = dict(UA)
    headers["Accept"] = "application/json, text/plain, */*"
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if cookie:
        headers["Cookie"] = cookie
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8", "replace")
            try:
                body = json.loads(raw)
            except json.JSONDecodeError:
                body = raw
            return r.status, body, r.headers
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            body = raw
        return e.code, body, e.headers
    except (urllib.error.URLError, TimeoutError) as e:
        return 0, {"error": str(e)}, {}


def login_for_history():
    """邮箱+密码登录换 Cookie（自包含；验证码 SVG 内 <text> 是明文）。凭据走环境变量。"""
    import re
    account = os.environ.get("CANNJUDGE_ACCOUNT")
    password = os.environ.get("CANNJUDGE_PASSWORD")
    if not account or not password:
        return None
    for _ in range(4):
        st, cap, _h = api_full("/api/users/captcha")
        if st != 200 or not isinstance(cap, dict):
            return None
        cap = cap.get("data") or cap
        svg, cid = cap.get("image") or "", cap.get("captchaId") or ""
        code = "".join(re.findall(r"<text[^>]*>([^<]+)</text>", svg))
        if len(code) < 4 or not cid:
            return None
        st, body, hdrs = api_full("/api/users/login", "POST", {
            "loginType": "email" if "@" in account else "phone",
            "account": account, "password": password,
            "captchaId": cid, "captchaCode": code})
        if st == 200 and isinstance(body, dict) and body.get("code") == 0:
            pairs = [c.split(";", 1)[0].strip()
                     for c in (hdrs.get_all("Set-Cookie") if hasattr(hdrs, "get_all") else []) or []]
            if pairs:
                print(f"[history] 自动登录成功（{account}）")
                return "; ".join(pairs)
    print("[history] 自动登录失败（凭据或验证码问题），本轮跳过 mine")
    return None


def get_history_cookie():
    ck = (os.environ.get("CANNJUDGE_COOKIE") or "").strip()
    if ck:
        return ck
    local = Path(__file__).resolve().parent / ".cannjudge_cookie"
    if local.exists():
        return local.read_text(encoding="utf-8").strip()
    return login_for_history()


def avg_from_result(result_list):
    """返回 (平均用时us[可见点], 分数和, 可见Pass数)。time 单位 ms → 转 us。"""
    ts = [x.get("time") for x in result_list or [] if isinstance(x, dict) and x.get("time")]
    ss = [x.get("score") for x in result_list or [] if isinstance(x, dict) and isinstance(x.get("score"), (int, float))]
    npass = sum(1 for x in result_list or [] if isinstance(x, dict) and x.get("testcase_status") == "Pass")
    return (round(sum(ts) / len(ts) * 1000, 1) if ts else None,
            round(sum(ss), 3) if ss else None, npass)


def fetch_mine(cookie, seen_sids):
    """本队账号完整提交历史 → {problem_id: [点]}。只对没见过的 sid 拉详情（详情带逐点用时）。"""
    rows, skip = [], 0
    while True:
        st, data, _h = api_full(f"/api/submissions/user/{HISTORY_UID}?skip={skip}&limit=50", cookie=cookie)
        if st != 200:
            print(f"[history] mine 列表 HTTP {st}，本轮跳过")
            return {}
        lst = data if isinstance(data, list) else ((data.get("data") or {}).get("list") if isinstance(data, dict) else None) or []
        if not lst:
            break
        rows += lst
        if len(lst) < 50:
            break
        skip += 50
    out, fetched = {}, 0
    for r in rows:
        pid, sid = r.get("problem_id"), r.get("_id")
        if not pid or not sid:
            continue
        a = s = None
        n = None
        if sid not in seen_sids:
            st, d, _h = api_full(f"/api/submissions/{sid}", cookie=cookie)
            if st == 200 and isinstance(d, dict):
                res = d.get("result") or []
                a, s, n = avg_from_result(res)
                fetched += 1
                time.sleep(0.25)
        out.setdefault(pid, []).append({
            "k": sid, "t": iso_local(r.get("create_time")),
            "u": (r.get("user") or {}).get("nickname") or "tomatorigid",
            "st": r.get("status"), "a": a, "s": s, "n": n})
    if fetched:
        print(f"[history] mine：{len(rows)} 条记录，新拉详情 {fetched} 条")
    return out


def fetch_rivals(problem_id):
    """公开 ranking 前 N 名的当前行 → 每人一个快照点（main 里按 k 去重增量合并）。"""
    st, data, _h = api_full(f"/api/problems/{problem_id}/ranking?page=1&size={RIVAL_TOP}")
    rows = (data.get("rows") if isinstance(data, dict) else None) or []
    pts = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        u = r.get("user") or {}
        a, _s, n = avg_from_result(r.get("result") or [])
        t = r.get("create_time") or (r.get("submission") or {}).get("create_time")
        pts.append({"k": f"{u.get('_id', '?')}|{r.get('submission_id') or t}",
                    "t": iso_local(t), "u": u.get("nickname") or "?",
                    "st": r.get("status"), "a": a, "s": r.get("score"), "n": n})
    return pts


def team_snapshot(item):
    """本队当前排行榜行 → 一个快照点（用于队友账号/匿名 CI 也能累积本队历史）。"""
    if not item.get("submitted") or not item.get("submission_id"):
        return None
    ts = [t.get("time") for t in item.get("testcases") or [] if t.get("time")]
    npass = sum(1 for t in item.get("testcases") or [] if t.get("status") == "Pass")
    return {
        "k": item["submission_id"],
        "t": item.get("submit_time"),
        "u": item.get("submitter") or "?",
        "st": item.get("status"),
        "a": round(sum(ts) / len(ts), 1) if ts else None,
        "s": item.get("score"),
        "n": npass,
    }


def merge_history(old_hist, mine_by_pid, rival_by_pid, refresh_mine, team_by_pid=None):
    """与旧 data.json 里的 history 合并（按 k 去重，点数封顶），返回 {problem_id: history}。
    没出现在本轮新数据里的旧点也原样保留（CI 匿名跑时 mine 不刷新但不会丢）。"""
    merged = {}
    pids = set(old_hist) | set(mine_by_pid or {}) | set(rival_by_pid or {}) | set(team_by_pid or {})
    for pid in pids:
        rivals = list((old_hist.get(pid) or {}).get("rivals") or [])
        keep = {p.get("k") for p in rivals}
        for p in (rival_by_pid or {}).get(pid, []):
            if p.get("k") not in keep:
                rivals.append(p)
                keep.add(p.get("k"))
        rivals.sort(key=lambda p: p.get("t") or "")

        team = list((old_hist.get(pid) or {}).get("team") or [])
        keept = {p.get("k") for p in team}
        for p in (team_by_pid or {}).get(pid, []):
            if p and p.get("k") not in keept:
                team.append(p)
                keept.add(p.get("k"))
        team.sort(key=lambda p: p.get("t") or "")

        mine = list((old_hist.get(pid) or {}).get("mine") or [])
        if refresh_mine:
            keepm = {p.get("k") for p in mine}
            for p in (mine_by_pid or {}).get(pid, []):
                if p.get("k") not in keepm:
                    mine.append(p)
                    keepm.add(p.get("k"))
            mine.sort(key=lambda p: p.get("t") or "")

        merged[pid] = {"rivals": rivals[-RIVAL_CAP:], "team": team[-TEAM_CAP:], "mine": mine[-MINE_CAP:]}
    return merged


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只打印不写文件")
    ap.add_argument("--no-history", action="store_true", help="跳过历史采集（老行为）")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.json"))
    args = ap.parse_args()

    # 旧 data.json 里的 history 先读出来，合并后写回（CI 匿名跑时也不会丢）
    old_hist = {}
    if not args.no_history and os.path.exists(args.out):
        try:
            with open(args.out, encoding="utf-8") as f:
                old = json.load(f)
            for p in old.get("problems") or []:
                if p.get("pid") and p.get("history"):
                    old_hist[p["pid"]] = p["history"]
        except (json.JSONDecodeError, OSError):
            pass

    cookie = None if args.no_history else get_history_cookie()
    seen_sids = {pt.get("k") for h in old_hist.values() for pt in (h.get("mine") or [])}
    mine_by_pid = fetch_mine(cookie, seen_sids) if cookie else {}

    contest = None
    items = []
    used_batches = []
    rival_by_pid = {}
    team_by_pid = {}
    for b in BATCHES:
        cid = b.get("contest_id")
        if not cid:
            used_batches.append({k: b[k] for k in ("key", "label", "period", "start", "end", "min_problems")})
            print(f"⏳ {b['label']}（{b['period']}）尚未开放，跳过")
            continue
        if contest is None:
            contest = get(f"/api/contests/{cid}")
        problems = get(f"/api/problems/contest/{cid}")
        problems.sort(key=lambda p: p.get("ID") or 0)
        for p in problems:
            item = fetch_problem(p, b["key"])
            if not args.no_history:
                rival_by_pid[p["_id"]] = fetch_rivals(p["_id"])
                snap = team_snapshot(item)
                if snap:
                    team_by_pid.setdefault(p["_id"], []).append(snap)
            items.append(item)
            flag = "✅" if item["status"] == "Pass" else ("⬜" if not item["submitted"] else "🟡")
            print(f"{flag} [{b['label']}] {item['id']} {item['title']:<24} rank={item['rank']} "
                  f"score={item['score']} {item['submitter'] or '-'} {item['submit_time'] or '-'}")
        used_batches.append({k: b[k] for k in ("key", "label", "period", "start", "end", "min_problems")})
        used_batches[-1]["problem_count"] = len(problems)

    if not args.no_history:
        hist = merge_history(old_hist, mine_by_pid, rival_by_pid, refresh_mine=bool(cookie), team_by_pid=team_by_pid)
        for item in items:
            item["history"] = hist.get(item["pid"]) or {"mine": [], "team": [], "rivals": []}
        print("[history] 点数（mine+team+rivals）：",
              {i["slug"]: f'{len(i["history"]["mine"])}+{len(i["history"]["team"])}+{len(i["history"]["rivals"])}' for i in items})

    contest = contest or {}
    total_score = sum(i["score"] for i in items)
    weighted = sum(i["score"] * i["difficulty"] for i in items)
    data = {
        "meta": {
            "generated_at": datetime.now(CST).strftime("%Y-%m-%d %H:%M:%S"),
            "generated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "team": TEAM,
            "contest": contest.get("title") or "第十一届华为ICT大赛｜昇腾AI算子开发赛道（决赛）",
            "contest_end": iso_local(contest.get("end_time")),
            "batches": used_batches,
            "current_batch": next((b["key"] for b in used_batches if b.get("problem_count")), None),
            "source": f"{BASE}/public/ictcompetition",
            "note": "数据来自 CANNJudge 公开接口 /api/problems/<id>/ranking；history.mine 来自登录接口（本队登录账号的全量提交），"
                    "history.team 是本队排行榜行的增量快照（含其他队友账号），history.rivals 是公开排行榜前 N 名的增量快照。"
                    "分数与状态以测试界面为准。",
        },
        "summary": {
            "score_sum": round(total_score, 2),
            "weighted_sum": round(weighted, 2),
            "submitted": sum(1 for i in items if i["submitted"]),
            "passed": sum(1 for i in items if i["status"] == "Pass"),
            "total_problems": len(items),
        },
        "problems": items,
    }

    if args.check:
        print(json.dumps(data["summary"], ensure_ascii=False))
        return
    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"\n已写入 {args.out}  (总分 {total_score:.2f}，加权 {weighted:.2f})")


if __name__ == "__main__":
    main()
