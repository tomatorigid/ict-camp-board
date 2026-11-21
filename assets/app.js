/* ICT 算子开发 · 队伍题目面板
 * 数据来自 data.json（fetch_data.py 从 CANNJudge 公开接口生成）
 * 设计：瑞士国际主义（归藏设计语言）
 */
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);

  const DIFF = {
    3: { label: "难 ×3", cls: "d3" },
    2: { label: "中 ×2", cls: "d2" },
    1: { label: "易 ×1", cls: "d1" },
  };

  const STATUS_CLS = {
    Pass: "pass",
    "Wrong Answer": "fail",
    "Runtime Error": "fail",
    "Compile Error": "fail",
    "Time Limit Exceeded": "fail",
  };

  const STATUS_ZH = {
    Pass: "通过",
    "Wrong Answer": "答案错误",
    "Runtime Error": "运行异常",
    "Compile Error": "编译失败",
    "Time Limit Exceeded": "超时",
    Skipped: "未执行",
    Hidden: "隐藏",
  };

  const state = {
    data: null,
    filter: "all",
    sort: "id",
    selected: null,
    loadedAt: Date.now(),
    trendMetric: "a", // a=平均用时(μs) s=分数
  };

  const btnRefresh = $("#btn-refresh");
  const statusEl = $("#refresh-status");

  /* ---------- 小工具 ---------- */
  const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

  const fmt = (v, d = 2) => {
    const n = num(v);
    return n === null ? "—" : n.toFixed(d);
  };

  const us = (v, d = 2) => {
    const n = num(v);
    return n === null ? "—" : n.toFixed(d);
  };

  function esc(s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function hhmmss(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  // 平均倍数：可见测试点 Σ(ours) / Σ(best)，越小越好
  function gapOf(p) {
    const rows = (p.testcases || []).filter((t) => num(t.time) !== null && num(t.best) > 0);
    if (!rows.length) return null;
    let ours = 0;
    let best = 0;
    for (const t of rows) {
      ours += num(t.time);
      best += num(t.best);
    }
    return best > 0 ? ours / best : null;
  }

  function passedCount(p) {
    return (p.testcases || []).filter((t) => t.status === "Pass").length;
  }

  function isBehind(p) {
    if (!p.submitted) return false;
    const r = num(p.rank);
    return r === null || r > 100;
  }

  /* ---------- 头部 ---------- */
  function renderHeader() {
    const m = state.data.meta || {};
    const s = state.data.summary || {};
    const total = s.total_problems || (state.data.problems || []).length || 10;

    if (m.team) $("#team-line").textContent = m.team;
    if (m.contest) $("#contest-line").textContent = m.contest;

    $("#n-submitted").textContent = s.submitted ?? "—";
    $("#n-submitted-sub").textContent = `/ ${total} 题`;
    $("#n-passed").textContent = s.passed ?? "—";
    $("#n-passed-sub").textContent = `/ ${total} 题`;
    $("#n-score").textContent = fmt(s.score_sum, 2);
    $("#n-weighted").textContent = fmt(s.weighted_sum, 2);

    const bits = [];
    if (m.generated_at) bits.push(`抓取 ${m.generated_at}`);
    if (m.contest_end) bits.push(`截止 ${m.contest_end}`);
    $("#meta-line").textContent = bits.join("　·　");

    renderBatches();
    if (m.source) $("#src-link").href = m.source;
  }

  function renderBatches() {
    const wrap = $("#batch-line");
    const list = (state.data.meta && state.data.meta.batches) || [];
    if (!list.length) {
      wrap.innerHTML = "";
      return;
    }
    // 当前批次：结束时间未到且最靠前的那个；都过期则最后一个
    const now = Date.now();
    let active = list[list.length - 1];
    for (const b of list) {
      const end = b.end ? new Date(b.end).getTime() : null;
      if (end && end > now) {
        active = b;
        break;
      }
    }
    wrap.innerHTML = list
      .map((b) => {
        const on = b === active ? " on" : "";
        const cnt = b.problem_count ? `${b.problem_count} 题` : "";
        return `<span class="batch${on}"><b>${esc(b.label)}</b><span>${esc(b.period || "")}</span>${
          cnt ? `<span class="cd">${esc(cnt)}</span>` : ""
        }</span>`;
      })
      .join("");
  }

  /* ---------- 列表 ---------- */
  function visibleProblems() {
    const all = state.data.problems || [];
    const filtered = all.filter((p) => {
      if (state.filter === "pass") return p.status === "Pass";
      if (state.filter === "pending") return !p.submitted;
      if (state.filter === "behind") return isBehind(p);
      return true;
    });

    const key = state.sort;
    const score = (v) => (num(v) === null ? -1 : num(v));
    return filtered.slice().sort((a, b) => {
      if (key === "score") return score(b.score) - score(a.score);
      if (key === "rank") {
        const ra = num(a.rank);
        const rb = num(b.rank);
        if (ra === null && rb === null) return a.id - b.id;
        if (ra === null) return 1;
        if (rb === null) return -1;
        return ra - rb;
      }
      if (key === "gap") {
        const ga = gapOf(a);
        const gb = gapOf(b);
        if (ga === null && gb === null) return a.id - b.id;
        if (ga === null) return 1;
        if (gb === null) return -1;
        return gb - ga;
      }
      if (key === "time") return String(b.submit_time || "").localeCompare(String(a.submit_time || ""));
      return a.id - b.id;
    });
  }

  function barRow(t) {
    const time = num(t.time);
    const best = num(t.best);
    const ratio = time !== null && best > 0 ? time / best : null;
    const width = time !== null && best > 0 ? Math.max(2, Math.min(100, (best / time) * 100)) : 0;
    const warn = ratio !== null && ratio > 1.5 ? " warn" : "";
    return `<div class="tc-row">
      <span class="i">${String(t.i).padStart(2, "0")}</span>
      <span class="us">${us(time, 0)}</span>
      <span class="tc-bar" title="best ${us(best, 0)} μs"><i style="width:${width.toFixed(1)}%"></i></span>
      <span class="rel${warn}">${ratio === null ? "—" : ratio.toFixed(2) + "×"}</span>
    </div>`;
  }

  function ordinalOf(p) {
    const list = state.data.problems || [];
    const i = list.indexOf(p);
    return i < 0 ? 0 : i + 1;
  }

  function card(p) {
    const ord = ordinalOf(p);
    const d = DIFF[p.difficulty] || { label: `难度 ${p.difficulty ?? "?"}`, cls: "" };
    const score = num(p.score);
    const rank = num(p.rank);
    const gap = gapOf(p);
    const sel = state.selected === p.id ? " sel" : "";
    const empty = p.submitted ? "" : " empty";

    const scoreHtml = !p.submitted
      ? `<div class="score-v none">未提交</div>`
      : score === null
      ? `<div class="score-v none">—</div>`
      : `<div class="score-v">${score.toFixed(2)}<small>分</small></div>`;

    const rankHtml = rank === null
      ? `<div class="rank-line">${p.submitted ? esc(STATUS_ZH[p.status] || p.status || "—") : "—"}</div>`
      : `<div class="rank-line"><b>#${rank}</b>${isBehind(p) ? `<span class="flag">未进前 100</span>` : ""}</div>`;

    const rows = (p.testcases || []).slice(0, 5).map(barRow).join("");

    return `<article class="card${sel}${empty}" data-id="${p.id}">
      <div class="card-top">
        <span class="card-idx">${String(ord).padStart(2, "0")}</span>
        <div class="card-head">
          <div class="card-slug">${esc(p.slug || "")}</div>
          <h3 class="card-title">${esc(p.title)}</h3>
        </div>
        <span class="badge ${d.cls}">${esc(d.label)}</span>
      </div>
      <div class="score-row">
        ${scoreHtml}
        ${rankHtml}
      </div>
      <div class="kv">
        <span>倍数 <b>${gap === null ? "—" : gap.toFixed(2) + "×"}</b></span>
        <span>通过 <b>${passedCount(p)}</b>/${p.testcase_total || 50}</span>
      </div>
      <div class="kv">
        <span>${p.submitted ? esc(STATUS_ZH[p.status] || p.status) : "未提交"}</span>
        <span class="who">${p.submitted ? esc(p.submitter || "—") : "—"}</span>
      </div>
      <div class="kv kv-dim">
        <span>提交于</span>
        <span>${p.submit_time ? esc(hhmmss(p.submit_time)) : "—"}</span>
      </div>
      <div class="tc-list">${rows}</div>
    </article>`;
  }

  function renderGrid() {
    const list = visibleProblems();
    $("#grid").innerHTML = list.map(card).join("");
    const all = (state.data.problems || []).length;
    const hint =
      list.length === all
        ? `共 ${all} 题　·　点击任意卡片查看 50 个测试点明细`
        : `筛出 ${list.length} / ${all} 题　·　点击卡片查看明细`;
    $("#hint").textContent = hint;

    $("#grid").querySelectorAll(".card").forEach((el) => {
      el.addEventListener("click", () => select(Number(el.dataset.id)));
    });
  }

  /* ---------- 明细 ---------- */
  function select(id) {
    state.selected = state.selected === id ? null : id;
    renderGrid();
    renderDetail();
  }

  function renderDetail() {
    const box = $("#detail");
    const id = state.selected;
    if (id === null) {
      box.hidden = true;
      $("#detail-body").innerHTML = "";
      return;
    }
    const p = (state.data.problems || []).find((x) => x.id === id);
    if (!p) {
      box.hidden = true;
      return;
    }

    const d = DIFF[p.difficulty] || { label: `难度 ${p.difficulty}` };
    $("#detail-eyebrow").textContent = `题目 ${String(ordinalOf(p)).padStart(2, "0")} · ${d.label} · ${p.slug || ""}`;
    $("#detail-title").textContent = p.title;

    const gap = gapOf(p);
    const tcs = p.testcases || [];
    const total = p.testcase_total || Math.max(50, tcs.length);

    const cells = [];
    for (let i = 1; i <= total; i += 1) {
      const t = tcs.find((x) => x.i === i);
      const st = t ? t.status : "Hidden";
      const cls = STATUS_CLS[st] || (st === "Skipped" ? "hidden" : "");
      const tip = t && num(t.time) !== null ? `#${i} ${us(t.time, 0)} μs / best ${us(t.best, 0)}` : `#${i} ${STATUS_ZH[st] || st || "未知"}`;
      cells.push(`<span class="tc ${cls}" title="${esc(tip)}">${i}</span>`);
    }

    const visible = tcs.filter((t) => num(t.time) !== null);
    const tableRows = visible
      .map((t) => {
        const ratio = num(t.best) > 0 ? num(t.time) / num(t.best) : null;
        const cls = STATUS_CLS[t.status] || "";
        return `<tr>
          <td>#${String(t.i).padStart(2, "0")}</td>
          <td>${esc(STATUS_ZH[t.status] || t.status || "—")}</td>
          <td class="num">${us(t.time, 0)} μs</td>
          <td class="num">${us(t.best, 0)} μs</td>
          <td class="num">${ratio === null ? "—" : ratio.toFixed(2) + "×"}</td>
        </tr>`;
      })
      .join("");

    $("#detail-body").innerHTML = `
      <div class="kv">
        <span>状态 <b>${p.submitted ? esc(STATUS_ZH[p.status] || p.status) : "未提交"}</b></span>
        <span>分数 <b>${fmt(p.score)}</b></span>
        <span>名次 <b>${num(p.rank) === null ? "—" : "#" + num(p.rank)}</b></span>
        <span>平均倍数 <b>${gap === null ? "—" : gap.toFixed(2) + "×"}</b></span>
        <span>提交人 <b>${esc(p.submitter || "—")}</b></span>
        <span>提交于 <b>${p.submit_time ? esc(hhmmss(p.submit_time)) : "—"}</b></span>
      </div>
      <div class="legend">
        <span class="p">通过</span><span class="f">失败</span><span>隐藏 / 未执行</span>
      </div>
      <div class="tc-grid">${cells.join("")}</div>
      ${
        tableRows
          ? `<table>
              <thead><tr><th>测试点</th><th>状态</th><th class="num">用时</th><th class="num">最佳</th><th class="num">倍数</th></tr></thead>
              <tbody>${tableRows}</tbody>
            </table>`
          : `<p class="hint mono">该题暂无可见测试点数据。</p>`
      }
      <div id="trend" class="trend"></div>
      <p class="hint mono">
        ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noreferrer">题目页</a>` : ""}
        ${p.ranking_url ? `　·　<a href="${esc(p.ranking_url)}" target="_blank" rel="noreferrer">提交排名</a>` : ""}
      </p>`;
    box.hidden = false;
    renderTrend(p);
  }

  /* ---------- 提交历史折线图（SVG） ---------- */
  function renderTrend(p) {
    const host = $("#trend");
    if (!host) return;
    const hist = p.history || {};
    const mineRaw = hist.mine || [];
    const teamRaw = hist.team || [];
    const rivals = hist.rivals || [];
    // 本队 = 登录账号全量历史（mine） + 排行榜行快照（team，覆盖其他队友账号），按提交 id 去重
    const mineSids = new Set(mineRaw.map((x) => x.k));
    const mine = mineRaw.concat(teamRaw.filter((x) => x && !mineSids.has(x.k)));
    const m = state.trendMetric;

    const head = `<div class="tr-head">
        <b>提交趋势 · ${m === "a" ? "可见测试点平均用时（μs，越低越好）" : "排行榜分数（越高越好）"}</b>
        <span class="tr-toggle">
          <button data-metric="a" class="${m === "a" ? "on" : ""}">平均用时</button>
          <button data-metric="s" class="${m === "s" ? "on" : ""}">分数</button>
        </span>
        <span class="tr-note">本队 ${mine.length} 次提交 · 对手快照 ${rivals.length} 点${m === "s" ? " · 本队历史分数平台不返回，仅对手有" : ""}</span>
      </div>`;

    if (!mine.length && !rivals.length) {
      host.innerHTML = head + `<p class="hint mono">暂无历史数据（fetch_data.py 加入 history 后自动出现）。</p>`;
      return;
    }
    const pts = [];
    for (const pt of mine) {
      // 分数模式：平台只给排行榜最新一次的分数，历史提交不返回 → 0 分视为无数据
      if (m === "s" && !(num(pt.s) > 0)) continue;
      if (num(pt[m]) !== null) pts.push({ ...pt, v: num(pt[m]), mine: true });
    }
    for (const pt of rivals) if (num(pt[m]) !== null) pts.push({ ...pt, v: num(pt[m]), mine: false });
    host.innerHTML = head + (pts.length ? buildTrendSvg(pts) : `<p class="hint mono">该指标下暂无数据（历史分数只有带登录态时才能补到）。</p>`);
    host.querySelectorAll(".tr-toggle button").forEach((b) =>
      b.addEventListener("click", () => {
        state.trendMetric = b.dataset.metric;
        renderTrend(p);
      })
    );
  }

  function ptTime(p) {
    const d = new Date(String(p.t || "").replace(" ", "T"));
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }

  function buildTrendSvg(pts) {
    const W = 760, H = 240, L = 52, R = 12, T = 14, B = 30;
    // 横轴 = 提交次序（等间距），不是真实时间比例：所有点按时间排序后各占一个槽位
    const ordered = pts.slice().sort((a, b) => (ptTime(a) || 0) - (ptTime(b) || 0));
    ordered.forEach((p, i) => { p.xi = i; });
    const N = ordered.length;

    const vs = pts.map((x) => x.v);
    let y0 = Math.min(...vs), y1 = Math.max(...vs);
    if (y0 === y1) { y0 -= Math.max(1, Math.abs(y0) * 0.1); y1 += Math.max(1, Math.abs(y1) * 0.1); }
    const pad = (y1 - y0) * 0.08;
    y0 -= pad; y1 += pad;
    if (y0 < 0) y0 = 0;
    const X = (i) => L + (N > 1 ? (i / (N - 1)) * (W - L - R) : (W - L - R) / 2);
    const Y = (v) => H - B - ((v - y0) / (y1 - y0)) * (H - T - B);
    const f = (n) => (n >= 100 ? String(Math.round(n)) : String(+n.toFixed(1)));

    let grid = "";
    for (let i = 0; i <= 3; i += 1) {
      const v = y0 + ((y1 - y0) * i) / 3;
      const y = Y(v);
      grid += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" class="tr-grid"/>` +
        `<text x="${L - 6}" y="${y + 4}" text-anchor="end" class="tr-lab">${f(v)}</text>`;
    }
    // 日期刻度：5 个等距槽位，标注该槽位那次提交的日期（同日期只标一次，优先保留最右侧）
    const dateOf = (qi) => {
      const t = ptTime(ordered[qi]);
      return t === null ? "" : `${new Date(t).getMonth() + 1}/${new Date(t).getDate()}`;
    };
    const ticks = [];
    for (let i = 0; i <= 4; i += 1) {
      ticks.push({ qi: N > 1 ? Math.round((i * (N - 1)) / 4) : 0, text: dateOf(N > 1 ? Math.round((i * (N - 1)) / 4) : 0) });
    }
    let last = "";
    for (const t of ticks) {
      if (t.text === last) t.text = "";
      else last = t.text;
    }
    if (ticks.length > 1 && !ticks[ticks.length - 1].text) {
      const own = dateOf(ticks[ticks.length - 1].qi);
      for (let i = ticks.length - 2; i >= 1; i -= 1) {
        if (ticks[i].text) { ticks[i].text = ""; break; }
      }
      ticks[ticks.length - 1].text = own;
    }
    ticks.forEach((t, i) => {
      if (!t.text) return;
      const anchor = i === 0 ? "start" : i === 4 ? "end" : "middle";
      grid += `<text x="${X(t.qi).toFixed(1)}" y="${H - 10}" text-anchor="${anchor}" class="tr-lab">${t.text}</text>`;
    });
    // 槽位引导线（点少时才画，避免糊成一片）
    if (N > 1 && N <= 40) {
      for (const p of ordered) {
        grid += `<line x1="${X(p.xi).toFixed(1)}" y1="${T}" x2="${X(p.xi).toFixed(1)}" y2="${H - B}" class="tr-slot"/>`;
      }
    }

    const byUser = {};
    for (const p of pts) {
      const key = (p.mine ? "M|" : "R|") + p.u;
      (byUser[key] = byUser[key] || { mine: p.mine, u: p.u, pts: [] }).pts.push(p);
    }
    let paths = "", dots = "";
    for (const k of Object.keys(byUser)) {
      const s = byUser[k];
      s.pts.sort((a, b) => a.xi - b.xi);
      if (s.pts.length > 1 && (s.mine || s.pts.length >= 3)) {
        const d = s.pts
          .map((p, i) => `${i ? "L" : "M"}${X(p.xi).toFixed(1)},${Y(p.v).toFixed(1)}`)
          .join("");
        paths += `<path d="${d}" class="tr-line ${s.mine ? "mine" : "rival"}"/>`;
      }
      for (const p of s.pts) {
        const cls = s.mine ? `mine ${STATUS_CLS[p.st] || ""}` : "rival";
        const tip = `${p.u} · ${hhmmss(p.t)} · ${STATUS_ZH[p.st] || p.st || ""} · ` +
          (state.trendMetric === "a" ? `${f(p.v)} μs` : `分数 ${f(p.v)}`) +
          (p.n != null ? ` · 可见通过 ${p.n}` : "");
        dots += `<circle cx="${X(p.xi).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="${s.mine ? 3.6 : 2.2}" class="tr-dot ${cls}"><title>${esc(tip)}</title></circle>`;
      }
    }
    const hasMine = pts.some((p) => p.mine);
    const mineUsers = [...new Set(pts.filter((p) => p.mine).map((p) => p.u))];
    const rivalUsers = [...new Set(pts.filter((p) => !p.mine).map((p) => p.u))];
    return `<svg viewBox="0 0 ${W} ${H}" class="tr-svg">${grid}${paths}${dots}</svg>` +
      `<div class="tr-legend">${hasMine ? `<span><i class="sw mine"></i>本队（${esc(mineUsers.join(" / "))}，每次提交）</span>` : ""}<span><i class="sw rival"></i>对手（排行榜前 30 名快照，${rivalUsers.length} 人，随刷新累积）</span><span class="tr-xhint">横轴按提交次序等间距 · 悬停看用户名/时间/状态</span></div>`;
  }

  /* ---------- 交互 ---------- */
  $("#filters").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-filter]");
    if (!btn) return;
    state.filter = btn.dataset.filter;
    $("#filters").querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === btn));
    renderGrid();
  });

  $("#sort").addEventListener("change", (e) => {
    state.sort = e.target.value;
    renderGrid();
  });

  $("#detail-close").addEventListener("click", () => {
    state.selected = null;
    renderGrid();
    renderDetail();
  });

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  async function loadData(manual) {
    if (manual) {
      btnRefresh.disabled = true;
      setStatus("正在拉取最新数据…");
    }
    try {
      const res = await fetch(`data.json?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      state.data = await res.json();
      state.loadedAt = Date.now();
      renderHeader();
      renderGrid();
      renderDetail();
      const t = new Date(state.loadedAt);
      const p = (n) => String(n).padStart(2, "0");
      setStatus(`页面于 ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())} 拉取 · 每 5 分钟自动刷新`);
    } catch (err) {
      setStatus(`拉取失败：${err.message}（保留上次数据）`);
    } finally {
      if (manual) btnRefresh.disabled = false;
    }
  }

  btnRefresh.addEventListener("click", () => loadData(true));

  /* chrome 时钟 */
  function tick() {
    const el = $("#chrome-clock");
    if (!el) return;
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    el.textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  /* 自动刷新：每 5 分钟，页面隐藏时跳过，回前台补拉 */
  setInterval(() => {
    if (!document.hidden) loadData(false);
  }, 5 * 60 * 1000);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Date.now() - state.loadedAt > 5 * 60 * 1000) loadData(false);
  });

  tick();
  setInterval(tick, 1000);
  loadData(false);
})();
