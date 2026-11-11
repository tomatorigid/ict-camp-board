/* ICT 算子开发 · 队伍看板
 * 数据来自 data.json（由 fetch_data.py 从 CANNJudge 公开接口生成）
 */
(async function () {
  const $ = (s) => document.querySelector(s);

  const DIFF = {
    3: { label: "难题 ×3", cls: "d3" },
    2: { label: "中题 ×2", cls: "d2" },
    1: { label: "易题 ×1", cls: "d1" },
  };

  let data = null;
  let filter = "all";
  let sortKey = "id";
  let selected = null;

  const fmt = (v, digits = 2) =>
    v === null || v === undefined || v === "" ? "—" : Number(v).toFixed(digits);

  const us = (v, digits = 2) =>
    v === null || v === undefined ? "—" : `${Number(v).toFixed(digits)} μs`;

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function renderHeader() {
    const m = data.meta;
    const s = data.summary;
    $("#contest-line").textContent = m.contest;
    $("#team-line").textContent = m.team;
    $("#meta-line").textContent =
      `数据抓取时间 ${m.generated_at}（UTC+8）　·　赛事截止 ${m.contest_end || "—"}　·　共 ${s.total_problems} 题`;
    $("#src-link").href = m.source;

    const cells = [
      ["已提交题数", `${s.submitted}<small> / ${s.total_problems}</small>`],
      ["已通过题数", `${s.passed}<small> / ${s.total_problems}</small>`],
      ["单题分数合计", `${fmt(s.score_sum, 1)}<small> 分</small>`],
      ["难度加权合计", `${fmt(s.weighted_sum, 1)}<small> 分</small>`],
    ];
    $("#summary").innerHTML = cells
      .map(
        ([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`
      )
      .join("");
  }

  function miniStrip(p) {
    if (!p.submitted) return "";
    return (
      `<div class="mini">` +
      p.testcases
        .map((t) => {
          const cls = t.status === "Pass" ? "pass" : t.status && t.status !== "Hidden" ? "fail" : "";
          return `<i class="${cls}" title="测试点 ${t.i}：${esc(t.status || "—")} ${t.time ? us(t.time) : ""}"></i>`;
        })
        .join("") +
      `</div>`
    );
  }

  function card(p) {
    const d = DIFF[p.difficulty] || DIFF[1];
    const sel = selected === p.id ? " sel" : "";
    const empty = p.submitted ? "" : " empty";
    const score = p.submitted ? fmt(p.score) : "—";
    const pct = p.submitted ? Math.max(0, Math.min(100, p.score)) : 0;
    return `
      <article class="card${sel}${empty}" data-id="${p.id}">
        <div class="card-top">
          <div>
            <div class="card-idx">#${p.id} · ${esc(p.slug)}</div>
            <h3>${esc(p.title)}</h3>
          </div>
          <span class="badge ${d.cls}">${d.label}</span>
        </div>
        <div class="score-row">
          <div class="score">${score}<small> 分</small></div>
          <div class="rank">${p.rank ? `第 ${p.rank} 名` : "未上榜"}</div>
        </div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="kv"><span>最新提交者</span><b>${esc(p.submitter || "—")}</b></div>
        <div class="kv"><span>提交时间</span><b>${esc(p.submit_time || "—")}</b></div>
        <div class="kv"><span>状态</span><b>${esc(p.status)}</b></div>
        ${miniStrip(p)}
      </article>`;
  }

  function visible() {
    let list = data.problems.slice();
    if (filter === "pass") list = list.filter((p) => p.status === "Pass");
    if (filter === "pending") list = list.filter((p) => !p.submitted);
    const by = {
      id: (a, b) => a.id - b.id,
      score: (a, b) => b.score - a.score || a.id - b.id,
      rank: (a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || b.score - a.score,
      time: (a, b) => String(b.submit_time || "").localeCompare(String(a.submit_time || "")),
    }[sortKey];
    return list.sort(by);
  }

  function renderGrid() {
    const list = visible();
    $("#grid").innerHTML = list.map(card).join("");
    $("#hint").textContent =
      list.length === 0 ? "该筛选下没有题目。" : `共 ${list.length} 题　·　点击卡片查看每个测试点的用时`;
    $("#grid").querySelectorAll(".card").forEach((el) => {
      el.addEventListener("click", () => {
        const id = Number(el.dataset.id);
        selected = selected === id ? null : id;
        renderGrid();
        renderDetail();
      });
    });
  }

  function renderDetail() {
    const box = $("#detail");
    const p = data.problems.find((x) => x.id === selected);
    if (!p) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    $("#detail-title").textContent = `#${p.id} ${p.title}　·　${p.status}　·　${fmt(p.score)} 分`;
    const d = DIFF[p.difficulty] || DIFF[1];

    if (!p.submitted) {
      $("#detail-body").innerHTML =
        `<p class="hint">这题还没有提交记录。题目页：<a href="${esc(p.url)}" target="_blank" rel="noreferrer">${esc(p.url)}</a></p>`;
      return;
    }

    const cells = p.testcases
      .map((t) => {
        const cls =
          t.status === "Pass" ? "pass" : t.status && t.status !== "Hidden" ? "fail" : "hidden";
        const title = `测试点 ${t.i}：${t.status || "—"}${t.time ? "，" + us(t.time) : ""}${
          t.best ? "，最佳 " + us(t.best) : ""
        }`;
        return `<div class="tc ${cls}" title="${esc(title)}">${t.i}</div>`;
      })
      .join("");

    const rows = p.testcases
      .filter((t) => t.status !== "Hidden")
      .map((t) => {
        const rel = t.best && t.time ? (t.time / t.best).toFixed(2) : "—";
        return `<tr><td class="num">${t.i}</td><td>${esc(t.status)}</td><td class="num">${us(
          t.time
        )}</td><td class="num">${us(t.best)}</td><td class="num">${rel === "—" ? "—" : rel + "×"}</td></tr>`;
      })
      .join("");

    const visibleCount = p.testcases.filter((t) => t.status !== "Hidden").length;

    $("#detail-body").innerHTML = `
      <div class="kv" style="margin-top:14px">
        <span>难度 ${d.label}</span>
        <span>排名 <b>${p.rank ?? "—"}</b></span>
        <span>最新提交者 <b>${esc(p.submitter || "—")}</b></span>
        <span>提交时间 <b>${esc(p.submit_time || "—")}</b></span>
        <span>测试点 <b>${p.testcase_total}</b>（公开 ${visibleCount}）</span>
      </div>
      <div class="tc-grid">${cells}</div>
      <div class="legend">
        <span class="p">Pass</span><span class="f">Fail/Error</span><span>未公开（Hidden）</span>
      </div>
      ${
        rows
          ? `<table><thead><tr><th>测试点</th><th>状态</th><th>本队用时</th><th>全场最佳</th><th>倍数</th></tr></thead><tbody>${rows}</tbody></table>`
          : `<p class="hint">该题没有公开测试点用时，只有分数可用。</p>`
      }
      <p class="hint">题目页：<a href="${esc(p.url)}" target="_blank" rel="noreferrer">${esc(
      p.url
    )}</a>　·　排名页：<a href="${esc(p.ranking_url)}" target="_blank" rel="noreferrer">${esc(
      p.ranking_url
    )}</a></p>`;
  }

  $("#filters").addEventListener("click", (e) => {
    const b = e.target.closest(".chip");
    if (!b) return;
    filter = b.dataset.filter;
    $("#filters").querySelectorAll(".chip").forEach((c) => c.classList.toggle("on", c === b));
    renderGrid();
  });

  $("#sort").addEventListener("change", (e) => {
    sortKey = e.target.value;
    renderGrid();
  });

  $("#detail-close").addEventListener("click", () => {
    selected = null;
    renderGrid();
    renderDetail();
  });

  try {
    const res = await fetch("data.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    document.querySelector("main").innerHTML =
      `<p class="hint">读取 data.json 失败：${esc(err.message)}。请在 <code>site/</code> 下起一个静态服务器（<code>python -m http.server 8000</code>），不要直接用 file:// 打开。</p>`;
    return;
  }

  renderHeader();
  renderGrid();
  renderDetail();
})();
