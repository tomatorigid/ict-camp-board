#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""拉取 CANNJudge 公开接口上本队 10 道题的最新提交，生成 site/data.json。

接口全部是公开的，不需要登录、不需要 cookie：
  GET /api/problems/contest/<contestId>               -> 题目列表
  GET /api/problems/<problemId>/ranking?q=<队伍名>     -> 该题排名（含最新提交者/分数/测试点用时/tbest）

用法:
  python fetch_data.py            # 写入同目录 data.json
  python fetch_data.py --check    # 只打印，不写文件
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

BASE = "https://cannjudge.cn"
TEAM = "哦不对一一哦对的对的"

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
                "time": res.get("time"),
                "precision": res.get("precision_ratio"),
                "best": best.get(res.get("testcase_id")),
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只打印不写文件")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.json"))
    args = ap.parse_args()

    contest = None
    items = []
    used_batches = []
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
            items.append(item)
            flag = "✅" if item["status"] == "Pass" else ("⬜" if not item["submitted"] else "🟡")
            print(f"{flag} [{b['label']}] {item['id']} {item['title']:<24} rank={item['rank']} "
                  f"score={item['score']} {item['submitter'] or '-'} {item['submit_time'] or '-'}")
        used_batches.append({k: b[k] for k in ("key", "label", "period", "start", "end", "min_problems")})
        used_batches[-1]["problem_count"] = len(problems)

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
            "note": "数据来自 CANNJudge 公开接口 /api/problems/<id>/ranking，分数与状态以测试界面为准。",
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
