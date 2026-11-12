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
      <span class="us">${us(time)}</span>
      <span class="tc-bar" title="best ${us(best)} μs"><i style="width:${width.toFixed(1)}%"></i></span>
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
      const tip = t && num(t.time) !== null ? `#${i} ${us(t.time)} μs / best ${us(t.best)}` : `#${i} ${STATUS_ZH[st] || st || "未知"}`;
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
          <td class="num">${us(t.time)} μs</td>
          <td class="num">${us(t.best)} μs</td>
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
      <p class="hint mono">
        ${p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noreferrer">题目页</a>` : ""}
        ${p.ranking_url ? `　·　<a href="${esc(p.ranking_url)}" target="_blank" rel="noreferrer">提交排名</a>` : ""}
      </p>`;
    box.hidden = false;
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
