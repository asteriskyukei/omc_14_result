const API_URL = "https://script.google.com/macros/s/AKfycbyQglWD4OAD15g20-I6Q4hcPoXsQ-l4FAKJb6i7eIbBkqhkU7yPrrufBh5U1qXGNvaHUQ/exec";

const state = {
  payload: null,
  group: "ALL",
  judge: "OVERALL",
  query: "",
  sortKey: "rank",
  sortDir: "asc"
};

const $ = id => document.getElementById(id);

function loadResults() {
  const callbackName = "__judgingResultsCallback";
  const script = document.createElement("script");

  window[callbackName] = payload => {
    try {
      if (!payload || payload.ok !== true) {
        throw new Error(payload?.error || "API 응답 오류");
      }

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
  $("updatedAt").textContent = meta.generatedAt
    ? `Updated ${new Date(meta.generatedAt).toLocaleString()}`
    : "";

  renderGroups();
  renderJudgeFilters();
  renderTable();
}

function renderGroups() {
  const groups = [...new Set(
    state.payload.participants.map(p => p.group).filter(Boolean)
  )];

  const container = $("groupFilters");
  container.innerHTML = "";

  [["ALL", "All"], ...groups.map(g => [g, g])].forEach(([value, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.className = state.group === value ? "active" : "";

    button.onclick = () => {
      state.group = value;
      state.sortKey = "rank";
      state.sortDir = "asc";
      renderGroups();
      renderTable();
    };

    container.appendChild(button);
  });
}

function renderJudgeFilters() {
  const container = $("judgeFilters");
  container.innerHTML = "";

  const items = [
    { value: "OVERALL", label: "Overall" },
    ...state.payload.meta.judges.map((name, index) => ({
      value: String(index),
      label: name
    }))
  ];

  items.forEach(item => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.label;
    button.className = state.judge === item.value ? "active" : "";

    button.onclick = () => {
      state.judge = item.value;
      state.sortKey = "rank";
      state.sortDir = "asc";
      renderJudgeFilters();
      renderTable();
    };

    container.appendChild(button);
  });
}

function getGroupParticipants() {
  return state.group === "ALL"
    ? [...state.payload.participants]
    : state.payload.participants.filter(p => p.group === state.group);
}

function buildJudgeRanking(participants, judgeIndex) {
  const sorted = [...participants].sort((a, b) => {
    const aScore = Number(a.judges[judgeIndex].zScore);
    const bScore = Number(b.judges[judgeIndex].zScore);

    if (bScore !== aScore) return bScore - aScore;

    return String(a.no || "").localeCompare(
      String(b.no || ""),
      undefined,
      { numeric: true }
    );
  });

  const rankMap = new Map();
  let previousScore = null;
  let previousRank = 0;

  sorted.forEach((p, index) => {
    const score = Number(p.judges[judgeIndex].zScore);
    const sameScore =
      previousScore !== null &&
      Math.abs(score - previousScore) < 1e-12;

    const rank = sameScore ? previousRank : index + 1;
    rankMap.set(p, rank);

    previousScore = score;
    previousRank = rank;
  });

  return rankMap;
}

function compareValues(a, b, numeric = false) {
  if (numeric) {
    const av = Number(a);
    const bv = Number(b);

    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  }

  return String(a ?? "").localeCompare(
    String(b ?? ""),
    undefined,
    { numeric: true, sensitivity: "base" }
  );
}

function updateSortIndicators() {
  document.querySelectorAll(".sort-button").forEach(button => {
    const indicator = button.querySelector(".sort-indicator");
    const active = button.dataset.sort === state.sortKey;

    button.classList.toggle("active", active);

    if (indicator) {
      indicator.textContent = active
        ? (state.sortDir === "asc" ? "↑" : "↓")
        : "↕";
    }
  });
}

function renderTable() {
  const groupParticipants = getGroupParticipants();
  let rows = [...groupParticipants];

  const isJudgeRanking = state.judge !== "OVERALL";
  const judgeIndex = isJudgeRanking ? Number(state.judge) : null;
  let judgeRankMap = null;

  if (isJudgeRanking) {
    judgeRankMap = buildJudgeRanking(groupParticipants, judgeIndex);
  }

  if (state.query) {
    const q = state.query.toLowerCase();

    rows = rows.filter(p =>
      [p.username, p.track, p.no, p.group]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }

  $("participantCount").textContent = groupParticipants.length;

  const groupLabel = state.group === "ALL" ? "All" : state.group;

  if (isJudgeRanking) {
    const judgeName = state.payload.meta.judges[judgeIndex];
    $("rankingTitle").textContent = `${judgeName} Ranking · ${groupLabel}`;
    $("scoreHeaderLabel").textContent = `${judgeName} Z-Score`;
  } else {
    $("rankingTitle").textContent =
      state.group === "ALL"
        ? "Final Results"
        : `${state.group} Results`;

    $("scoreHeaderLabel").textContent = "Final Score";
  }

  const getRank = p =>
    isJudgeRanking
      ? judgeRankMap.get(p)
      : (state.group === "ALL" ? p.overallRank : p.groupRank);

  const getScore = p =>
    isJudgeRanking
      ? Number(p.judges[judgeIndex].zScore)
      : Number(p.finalScore);

  const accessors = {
    rank: p => getRank(p),
    no: p => p.no || "",
    username: p => p.username || "",
    track: p => p.track || "",
    score: p => getScore(p)
  };

  const numericKeys = new Set(["rank", "score"]);

  rows.sort((a, b) => {
    const av = accessors[state.sortKey](a);
    const bv = accessors[state.sortKey](b);

    const result = compareValues(
      av,
      bv,
      numericKeys.has(state.sortKey)
    );

    if (result !== 0) {
      return state.sortDir === "asc" ? result : -result;
    }

    const rankResult = compareValues(getRank(a), getRank(b), true);
    if (rankResult !== 0) return rankResult;

    return compareValues(a.no || "", b.no || "");
  });

  const body = $("resultsBody");
  body.innerHTML = "";

  rows.forEach(p => {
    const rank = getRank(p);
    let scoreCell = "";

    if (isJudgeRanking) {
      const judge = p.judges[judgeIndex];

      scoreCell = `
        <div class="judge-ranking-score">${signed(judge.zScore)}</div>
        <div class="meta">Raw ${Number(judge.rawScore).toFixed(1)} / 100</div>
      `;
    } else {
      scoreCell = formatScore(p.finalScore);
    }

    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>
        <span class="rank-badge ${rank <= 3 ? "top" : ""}">${rank}</span>
      </td>
      <td class="meta">${escapeHtml(p.no || "-")}</td>
      <td>
        <div class="participant-name">${escapeHtml(p.username)}</div>
        ${p.group ? `<div class="meta">${escapeHtml(p.group)}</div>` : ""}
      </td>
      <td class="meta">${escapeHtml(p.track || "-")}</td>
      <td class="score">${scoreCell}</td>
    `;

    tr.onclick = () => showDetail(p, rank, judgeIndex);
    body.appendChild(tr);
  });

  $("emptyState").hidden = rows.length !== 0;
  updateSortIndicators();
}

function hasJudgeCriteria(judge) {
  return [
    judge.basic,
    judge.technical,
    judge.creativity,
    judge.impression
  ].every(value =>
    value !== undefined &&
    value !== null &&
    value !== "" &&
    Number.isFinite(Number(value))
  );
}

function showDetail(p, rank, selectedJudgeIndex = null) {
  const missingCriteria = p.judges.some(j => !hasJudgeCriteria(j));

  const judgeRows = p.judges.map(j => {
    const criteriaHtml = hasJudgeCriteria(j)
      ? `
        <div class="criterion-strip">
          ${judgeCriterion("Basic", j.basic, 20)}
          ${judgeCriterion("Technical", j.technical, 30)}
          ${judgeCriterion("Creativity", j.creativity, 25)}
          ${judgeCriterion("Impression", j.impression, 25)}
        </div>
      `
      : `
        <div class="criterion-unavailable">
          세부 심사점수가 API 응답에 없습니다.
        </div>
      `;

    return `
      <section class="judge-entry ${j.excluded ? "excluded" : ""}">
        <div class="judge-row">
          <div class="judge-name">
            <strong>${escapeHtml(j.name)}</strong>
            ${
              j.excluded
                ? `<span class="excluded-badge ${
                    j.excludedReason === "highest"
                      ? "excluded-highest"
                      : "excluded-lowest"
                  }">
                    ${
                      j.excludedReason === "highest"
                        ? "Highest · Excluded"
                        : "Lowest · Excluded"
                    }
                  </span>`
                : ""
            }
          </div>

          <div class="judge-total">
            <span>Raw</span>
            <strong>${Number(j.rawScore).toFixed(1)} / 100</strong>
          </div>

          <div class="judge-z">
            <span>Z-Score</span>
            <strong>${signed(j.zScore)}</strong>
          </div>
        </div>

        ${criteriaHtml}

        ${
          j.comment
            ? `
              <div class="judge-comment">
                <span class="comment-label">Comment</span>
                <p>${escapeHtml(j.comment)}</p>
              </div>
            `
            : ""
        }
      </section>
    `;
  }).join("");

  const judgeRankingActive = selectedJudgeIndex !== null;
  const selectedJudge = judgeRankingActive
    ? p.judges[selectedJudgeIndex]
    : null;

  const rankingLabel = judgeRankingActive
    ? `${selectedJudge.name} RANK #${rank}`
    : `RANK #${rank}`;

  const headlineScore = judgeRankingActive
    ? `${signed(selectedJudge.zScore)} <small>Z</small>`
    : formatScore(p.finalScore);

  const apiWarning = missingCriteria
    ? `
      <div class="api-warning">
        현재 배포된 Apps Script API가 세부 심사점수를 반환하지 않고 있습니다.
        v7의 <strong>Code.gs</strong>로 교체한 뒤
        <strong>배포 관리 → 수정 → 새 버전</strong>으로 재배포하면 실제 점수가 표시됩니다.
      </div>
    `
    : "";

  $("detailContent").innerHTML = `
    <div class="detail-inner">
      <div class="detail-title-row">
        <div>
          <p class="section-kicker">${escapeHtml(rankingLabel)}</p>
          <h2>${escapeHtml(p.username)}</h2>
          <p class="detail-sub">
            ${
              [
                p.group,
                p.no ? `No. ${p.no}` : "",
                p.track
              ]
                .filter(Boolean)
                .map(escapeHtml)
                .join(" · ")
            }
          </p>

          ${
            judgeRankingActive
              ? `<p class="detail-sub">Raw Score ${Number(selectedJudge.rawScore).toFixed(1)} / 100</p>`
              : ""
          }
        </div>

        <div class="detail-score">${headlineScore}</div>
      </div>

      <div class="category-grid">
        ${categoryCard("Basic Skill", p.categoryAverages.basic, 20)}
        ${categoryCard("Technical Skill", p.categoryAverages.technical, 30)}
        ${categoryCard("Creativity", p.categoryAverages.creativity, 25)}
        ${categoryCard("Judge's impression", p.categoryAverages.impression, 25)}
      </div>

      ${apiWarning}

      <p class="section-kicker judge-section-title">JUDGE SCORES & COMMENTS</p>
      <div class="judge-list">${judgeRows}</div>
    </div>
  `;

  $("detailDialog").showModal();
}

function categoryCard(label, score, max) {
  const value = Number(score);

  return `
    <div class="category-card">
      <span>${escapeHtml(label)}</span>
      <strong>
        ${Number.isFinite(value) ? value.toFixed(2) : "—"}
        <small>/ ${max}</small>
      </strong>
    </div>
  `;
}

function judgeCriterion(label, score, max) {
  const value = Number(score);

  return `
    <div class="criterion-item">
      <span>${escapeHtml(label)}</span>
      <strong>
        ${Number.isFinite(value) ? value.toFixed(1) : "—"}
        <small>/ ${max}</small>
      </strong>
    </div>
  `;
}

function formatScore(n) {
  const value = Number(n);

  return Number.isFinite(value)
    ? value.toFixed(state.payload?.meta?.scorePrecision ?? 3)
    : "—";
}

function signed(n) {
  const value = Number(n);
  const precision = state.payload?.meta?.scorePrecision ?? 3;

  if (!Number.isFinite(value)) return "—";

  return `${value > 0 ? "+" : ""}${value.toFixed(precision)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showFatal(message) {
  $("loading").innerHTML = `
    <div class="fatal">
      <strong>결과를 불러오지 못했습니다.</strong>
      <span>${escapeHtml(message)}</span>
    </div>
  `;
}

$("searchInput").addEventListener("input", event => {
  state.query = event.target.value.trim();
  if (state.payload) renderTable();
});

$("dialogClose").addEventListener("click", () => $("detailDialog").close());

$("detailDialog").addEventListener("click", event => {
  if (event.target === $("detailDialog")) {
    $("detailDialog").close();
  }
});

document.querySelectorAll(".sort-button").forEach(button => {
  button.addEventListener("click", () => {
    const key = button.dataset.sort;

    if (state.sortKey === key) {
      state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
    } else {
      state.sortKey = key;
      state.sortDir = key === "score" ? "desc" : "asc";
    }

    if (state.payload) renderTable();
  });
});

loadResults();
