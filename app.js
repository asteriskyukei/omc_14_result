const API_URL = "https://script.google.com/macros/s/AKfycbwpI27rTfbfHZG9fuJorfxX1Qh-BaZtNc0pBDRe0zweUvRp_VOf99p8xinKyogIGIIgVQ/exec";

const state = { payload: null, group: "ALL", query: "" };
const $ = id => document.getElementById(id);

function loadResults() {
  if (!API_URL || API_URL.includes("PASTE_YOUR")) {
    showFatal("app.js의 API_URL에 Apps Script 웹 앱 /exec 주소를 입력하세요.");
    return;
  }

  const callbackName = "__judgingResultsCallback";
  const script = document.createElement("script");

  window[callbackName] = payload => {
    try {
      if (!payload || payload.ok !== true) throw new Error(payload?.error || "API 응답 오류");
      state.payload = payload;
      render();
      $("loading").classList.add("hidden");
    } catch (err) {
      showFatal(err.message);
    } finally {
      delete window[callbackName];
      script.remove();
    }
  };

  const url = new URL(API_URL);
  url.searchParams.set("callback", callbackName);
  url.searchParams.set("_", Date.now());
  script.src = url.toString();
  script.onerror = () => showFatal("결과 API에 연결하지 못했습니다.");
  document.body.appendChild(script);
}

function render() {
  const { meta, participants } = state.payload;
  document.title = meta.eventTitle || "Judging Results";
  $("eventTitle").textContent = meta.eventTitle || "Judging Results";
  $("eventSubtitle").textContent = meta.eventSubtitle || "Official judging results";
  $("judgeCount").textContent = meta.judges.length;
  $("participantCount").textContent = participants.length;
  $("updatedAt").textContent = meta.generatedAt ? `Updated ${new Date(meta.generatedAt).toLocaleString()}` : "";
  renderGroups();
  renderTable();
}

function renderGroups() {
  const groups = [...new Set(state.payload.participants.map(p => p.group).filter(Boolean))];
  const container = $("groupFilters");
  container.innerHTML = "";
  [["ALL","All"], ...groups.map(g => [g,g])].forEach(([value,label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.className = state.group === value ? "active" : "";
    button.onclick = () => {
      state.group = value;
      renderGroups();
      renderTable();
    };
    container.appendChild(button);
  });
}

function renderTable() {
  let rows = [...state.payload.participants];

  if (state.group !== "ALL") rows = rows.filter(p => p.group === state.group);

  if (state.query) {
    const q = state.query.toLowerCase();
    rows = rows.filter(p => [p.username,p.track,p.no,p.group].join(" ").toLowerCase().includes(q));
  }

  rows.sort((a,b) => {
    const ar = state.group === "ALL" ? a.overallRank : a.groupRank;
    const br = state.group === "ALL" ? b.overallRank : b.groupRank;
    return ar - br;
  });

  $("rankingTitle").textContent = state.group === "ALL" ? "Final Results" : `${state.group} Results`;
  const body = $("resultsBody");
  body.innerHTML = "";

  rows.forEach(p => {
    const rank = state.group === "ALL" ? p.overallRank : p.groupRank;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="rank-badge ${rank <= 3 ? "top" : ""}">${rank}</span></td>
      <td class="meta">${escapeHtml(p.no || "-")}</td>
      <td><div class="participant-name">${escapeHtml(p.username)}</div>${p.group ? `<div class="meta">${escapeHtml(p.group)}</div>` : ""}</td>
      <td class="meta">${escapeHtml(p.track || "-")}</td>
      <td class="score">${formatScore(p.finalScore)}</td>
    `;
    tr.onclick = () => showDetail(p, rank);
    body.appendChild(tr);
  });

  $("emptyState").hidden = rows.length !== 0;
}

function showDetail(p, rank) {
  const judgeRows = p.judges.map(j => `
    <div class="judge-entry ${j.excluded ? "excluded" : ""}">
      <div class="judge-row">
        <span>
          ${escapeHtml(j.name)}
          ${j.excluded ? `<em class="excluded-badge">${j.excludedReason === "highest" ? "Highest · Excluded" : "Lowest · Excluded"}</em>` : ""}
        </span>
        <span>${Number(j.rawScore).toFixed(1)} / 100</span>
        <span class="z">${signed(j.zScore)}</span>
      </div>
      ${j.comment ? `<div class="judge-comment">${escapeHtml(j.comment)}</div>` : ""}
    </div>
  `).join("");

  $("detailContent").innerHTML = `
    <div class="detail-inner">
      <div class="detail-title-row">
        <div>
          <p class="section-kicker">RANK #${rank}</p>
          <h2>${escapeHtml(p.username)}</h2>
          <p class="detail-sub">${[p.group,p.no ? `No. ${p.no}` : "",p.track].filter(Boolean).map(escapeHtml).join(" · ")}</p>
        </div>
        <div class="detail-score">${formatScore(p.finalScore)}</div>
      </div>

      <div class="category-grid">
        ${categoryCard("Basic Skill",p.categoryAverages.basic,20)}
        ${categoryCard("Technical Skill",p.categoryAverages.technical,30)}
        ${categoryCard("Creativity",p.categoryAverages.creativity,25)}
        ${categoryCard("Judge's impression",p.categoryAverages.impression,25)}
      </div>

      <p class="section-kicker">JUDGE SCORES & COMMENTS</p>
      <div class="judge-list">${judgeRows}</div>
    </div>
  `;

  $("detailDialog").showModal();
}

function categoryCard(label,score,max) {
  return `<div class="category-card"><span>${escapeHtml(label)}</span><strong>${Number(score).toFixed(2)} <small>/ ${max}</small></strong></div>`;
}
function formatScore(n) { return Number(n).toFixed(state.payload?.meta?.scorePrecision ?? 3); }
function signed(n) {
  const value = Number(n), precision = state.payload?.meta?.scorePrecision ?? 3;
  return `${value > 0 ? "+" : ""}${value.toFixed(precision)}`;
}
function escapeHtml(value) {
  return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function showFatal(message) {
  $("loading").innerHTML = `<div style="max-width:620px;padding:24px;text-align:center"><strong style="display:block;margin-bottom:12px">결과를 불러오지 못했습니다.</strong><span style="color:#9aa3af;line-height:1.7">${escapeHtml(message)}</span></div>`;
}
$("searchInput").addEventListener("input", e => {
  state.query = e.target.value.trim();
  if (state.payload) renderTable();
});
$("dialogClose").addEventListener("click", () => $("detailDialog").close());
$("detailDialog").addEventListener("click", e => {
  if (e.target === $("detailDialog")) $("detailDialog").close();
});
loadResults();
