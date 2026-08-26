const API_URL = "https://script.google.com/macros/s/AKfycbxr8Y_47Vj8Z5tU9zl2VzF7n_uIJTq9hiFw16U0Mv4UEbQ6LMKlHR6wmQUF3pd0HSDb5g/exec";

const state = {
  payload: null,
  round: null,
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
        throw new Error(payload && payload.error ? payload.error : "API 응답 오류");
      }

      state.payload = payload;

      const enabledRounds = payload.rounds
        .filter(r => r.enabled)
        .sort((a, b) => Number(b.round) - Number(a.round));

      state.round = enabledRounds.length
        ? String(enabledRounds[0].round)
        : "ALL_TIME";

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
  const meta = state.payload.meta;

  document.title = meta.eventTitle || "Judging Results";
  $("eventTitle").textContent = meta.eventTitle || "Judging Results";
  $("eventSubtitle").textContent = meta.eventSubtitle || "Official judging results";
  $("updatedAt").textContent = meta.generatedAt
    ? `Updated ${new Date(meta.generatedAt).toLocaleString()}`
    : "";

  renderRoundFilters();

  if (state.round === "ALL_TIME") {
    renderAllTimeMode();
  } else {
    renderRoundMode();
  }

  renderScoringMethod();
}

function getRoundMeta() {
  return state.payload.rounds.find(
    r => String(r.round) === String(state.round)
  ) || null;
}

function getRoundEntries() {
  return state.payload.entries.filter(
    e => String(e.round) === String(state.round)
  );
}

function renderRoundFilters() {
  const container = $("roundFilters");
  container.innerHTML = "";

  const items = [
    { value: "ALL_TIME", label: "All-Time" },
    ...state.payload.rounds
      .filter(r => r.enabled)
      .sort((a, b) => Number(b.round) - Number(a.round))
      .map(r => ({
        value: String(r.round),
        label: r.label || `${r.round}회`
      }))
  ];

  items.forEach(item => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.label;
    button.className = state.round === item.value ? "active" : "";

    button.onclick = () => {
      state.round = item.value;
      state.group = "ALL";
      state.judge = "OVERALL";
      state.sortKey = "rank";
      state.sortDir = "asc";
      render();
    };

    container.appendChild(button);
  });
}

function renderRoundMode() {
  $("groupFilterRow").hidden = false;
  $("judgeFilterRow").hidden = false;

  renderGroups();
  renderJudgeFilters();
  renderRoundTable();
  renderSubcategoryAwards();
}

function renderAllTimeMode() {
  $("subcategorySection").hidden = true;
  $("groupFilterRow").hidden = true;
  $("judgeFilterRow").hidden = true;

  const standings = state.payload.allTime || [];

  $("summaryLabel1").textContent = "Participants";
  $("summaryValue1").textContent = standings.length;

  $("summaryLabel2").textContent = "Rounds";
  $("summaryValue2").textContent = state.payload.rounds.filter(r => r.enabled).length;

  $("summaryLabel3").textContent = "Ranking";
  $("summaryValue3").textContent = "Wins";

  $("rankingTitle").textContent = "All-Time Standings";
  renderAllTimeTable();
}

function renderGroups() {
  const entries = getRoundEntries();
  const groups = [...new Set(entries.map(p => p.group).filter(Boolean))];
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
      renderRoundTable();
      renderSubcategoryAwards();
    };

    container.appendChild(button);
  });
}

function renderJudgeFilters() {
  const roundMeta = getRoundMeta();
  const container = $("judgeFilters");
  container.innerHTML = "";

  const items = [
    { value: "OVERALL", label: "Overall" },
    ...roundMeta.judges.map((name, index) => ({
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
      renderRoundTable();
    };

    container.appendChild(button);
  });
}

function getFilteredRoundEntries() {
  let entries = getRoundEntries();

  if (state.group !== "ALL") {
    entries = entries.filter(p => p.group === state.group);
  }

  return entries;
}

function buildJudgeRanking(
  participants,
  judgeIndex,
  useStandardization,
  rankingScope
) {
  const rankMap = new Map();

  function rankOneSet(items) {
    const available = items.filter(
      p => p.judges[judgeIndex] && p.judges[judgeIndex].available
    );

    const sorted = [...available].sort((a, b) => {
      const aJudge = a.judges[judgeIndex];
      const bJudge = b.judges[judgeIndex];

      const aScore = useStandardization
        ? Number(aJudge.zScore)
        : Number(aJudge.rawScore);

      const bScore = useStandardization
        ? Number(bJudge.zScore)
        : Number(bJudge.rawScore);

      if (bScore !== aScore) return bScore - aScore;

      return String(a.no || "").localeCompare(
        String(b.no || ""),
        undefined,
        { numeric: true }
      );
    });

    let previousScore = null;
    let previousRank = 0;

    sorted.forEach((p, index) => {
      const judge = p.judges[judgeIndex];

      const score = useStandardization
        ? Number(judge.zScore)
        : Number(judge.rawScore);

      const sameScore =
        previousScore !== null &&
        Math.abs(score - previousScore) < 1e-12;

      const rank = sameScore
        ? previousRank
        : index + 1;

      rankMap.set(p, rank);

      previousScore = score;
      previousRank = rank;
    });
  }

  if (
    rankingScope === "GROUP" &&
    state.group === "ALL"
  ) {
    const groups = new Map();

    participants.forEach(p => {
      const key = p.group || "__ALL__";

      if (!groups.has(key)) {
        groups.set(key, []);
      }

      groups.get(key).push(p);
    });

    groups.forEach(items => rankOneSet(items));
  } else {
    rankOneSet(participants);
  }

  return rankMap;
}

function renderRoundTable() {
  const roundMeta = getRoundMeta();
  const participants = getFilteredRoundEntries();
  let rows = [...participants];

  const isJudgeRanking = state.judge !== "OVERALL";
  const judgeIndex = isJudgeRanking ? Number(state.judge) : null;

  const judgeRankMap = isJudgeRanking
    ? buildJudgeRanking(
        participants,
        judgeIndex,
        roundMeta.useStandardization,
        roundMeta.rankingScope
      )
    : null;

  if (isJudgeRanking) {
    rows = rows.filter(p => judgeRankMap.has(p));
  }

  if (state.query) {
    const q = state.query.toLowerCase();

    rows = rows.filter(p =>
      [p.username, p.track, p.no, p.group, p.participantId]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }

  $("summaryLabel1").textContent = "Participants";
  $("summaryValue1").textContent = participants.length;

  $("summaryLabel2").textContent = "Judges";
  $("summaryValue2").textContent = roundMeta.judgeCount;

  $("summaryLabel3").textContent = "Scoring";
  $("summaryValue3").textContent = roundMeta.useStandardization
    ? (
        roundMeta.standardizationScope === "GROUP"
          ? "Group Z"
          : "Z-Score"
      )
    : "Raw";

  const roundLabel = roundMeta.label || `${roundMeta.round}회`;

  if (isJudgeRanking) {
    $("rankingTitle").textContent =
      `${roundLabel} · ${roundMeta.judges[judgeIndex]} Ranking`;
  } else {
    $("rankingTitle").textContent =
      state.group === "ALL"
        ? (
            roundMeta.rankingScope === "GROUP"
              ? `${roundLabel} Group Results`
              : `${roundLabel} Final Results`
          )
        : `${roundLabel} · ${state.group} Results`;
  }

  renderRoundHeader(isJudgeRanking, roundMeta);

  const getRank = p =>
    isJudgeRanking
      ? judgeRankMap.get(p)
      : (
          state.group === "ALL" &&
          roundMeta.rankingScope !== "GROUP"
            ? p.overallRank
            : p.groupRank
        );

  const getScore = p => {
    if (!isJudgeRanking) return Number(p.finalScore);

    const judge = p.judges[judgeIndex];

    return roundMeta.useStandardization
      ? Number(judge.zScore)
      : Number(judge.rawScore);
  };

  const accessors = {
    rank: p => getRank(p),
    no: p => p.no || "",
    username: p => p.username || "",
    track: p => p.track || "",
    score: p => getScore(p)
  };

  const numericKeys = new Set(["rank", "score"]);

  rows.sort((a, b) => {
    const result = compareValues(
      accessors[state.sortKey](a),
      accessors[state.sortKey](b),
      numericKeys.has(state.sortKey)
    );

    if (result !== 0) {
      return state.sortDir === "asc" ? result : -result;
    }

    return compareValues(getRank(a), getRank(b), true);
  });

  const body = $("resultsBody");
  body.innerHTML = "";

  rows.forEach(p => {
    const rank = getRank(p);
    let scoreCell = "";

    if (isJudgeRanking) {
      const judge = p.judges[judgeIndex];

      if (roundMeta.useStandardization) {
        scoreCell = `
          <div class="judge-ranking-score">${signed(judge.zScore)}</div>
          <div class="meta">Raw ${number(judge.rawScore, 1)} / ${number(roundMeta.rawMax, 0)}</div>
        `;
      } else {
        scoreCell = `
          <div class="judge-ranking-score">${number(judge.rawScore, 1)}</div>
          <div class="meta">Raw Score / ${number(roundMeta.rawMax, 0)}</div>
        `;
      }
    } else {
      scoreCell = formatScore(p.finalScore);
    }

    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td><span class="rank-badge ${rank <= 3 ? "top" : ""}">${rank}</span></td>
      <td class="meta">${escapeHtml(p.no || "-")}</td>
      <td>
        <div class="participant-name">${escapeHtml(p.username)}</div>
        ${p.group ? `<div class="meta">${escapeHtml(p.group)}</div>` : ""}
      </td>
      <td class="meta">${escapeHtml(p.track || "-")}</td>
      <td class="score">${scoreCell}</td>
    `;

    tr.onclick = () => showRoundDetail(p, rank, judgeIndex);
    body.appendChild(tr);
  });

  $("emptyState").hidden = rows.length !== 0;
  bindSortButtons(renderRoundTable);
  updateSortIndicators();
}

function renderRoundHeader(isJudgeRanking, roundMeta) {
  const scoreLabel = isJudgeRanking
    ? (
        roundMeta.useStandardization
          ? `${roundMeta.judges[Number(state.judge)]} Z-Score`
          : `${roundMeta.judges[Number(state.judge)]} Raw Score`
      )
    : "Final Score";

  $("resultsHead").innerHTML = `
    <tr>
      ${sortableTh("Rank", "rank")}
      ${sortableTh("No.", "no")}
      ${sortableTh("Participant", "username")}
      ${sortableTh("Track", "track")}
      ${sortableTh(scoreLabel, "score")}
    </tr>
  `;
}

function renderAllTimeTable() {
  let rows = [...(state.payload.allTime || [])];

  if (state.query) {
    const q = state.query.toLowerCase();

    rows = rows.filter(p =>
      [p.username, p.participantId]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }

  const accessors = {
    rank: p => p.rank,
    username: p => p.username,
    wins: p => p.wins,
    seconds: p => p.seconds,
    thirds: p => p.thirds,
    podiums: p => p.podiums,
    appearances: p => p.appearances,
    averageRank: p => p.averageRank
  };

  const numericKeys = new Set([
    "rank", "wins", "seconds", "thirds",
    "podiums", "appearances", "averageRank"
  ]);

  rows.sort((a, b) => {
    const accessor = accessors[state.sortKey] || accessors.rank;

    const result = compareValues(
      accessor(a),
      accessor(b),
      numericKeys.has(state.sortKey)
    );

    if (result !== 0) {
      return state.sortDir === "asc" ? result : -result;
    }

    return compareValues(a.rank, b.rank, true);
  });

  $("resultsHead").innerHTML = `
    <tr>
      ${sortableTh("Rank", "rank")}
      ${sortableTh("Participant", "username")}
      ${sortableTh("Wins", "wins")}
      ${sortableTh("2nd", "seconds")}
      ${sortableTh("3rd", "thirds")}
      ${sortableTh("Podiums", "podiums")}
      ${sortableTh("Appearances", "appearances")}
      ${sortableTh("Avg Rank", "averageRank")}
    </tr>
  `;

  const body = $("resultsBody");
  body.innerHTML = "";

  rows.forEach(p => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td><span class="rank-badge ${p.rank <= 3 ? "top" : ""}">${p.rank}</span></td>
      <td>
        <div class="participant-name">${escapeHtml(p.username)}</div>
        <div class="meta">${escapeHtml(p.participantId)}</div>
      </td>
      <td class="stat-number stat-win">${p.wins}</td>
      <td class="stat-number">${p.seconds}</td>
      <td class="stat-number">${p.thirds}</td>
      <td class="stat-number">${p.podiums}</td>
      <td class="stat-number">${p.appearances}</td>
      <td class="stat-number">${number(p.averageRank, 2)}</td>
    `;

    tr.onclick = () => showAllTimeDetail(p);
    body.appendChild(tr);
  });

  $("emptyState").hidden = rows.length !== 0;
  bindSortButtons(renderAllTimeTable);
  updateSortIndicators();
}

function sortableTh(label, key) {
  return `
    <th>
      <button class="sort-button" type="button" data-sort="${key}">
        ${escapeHtml(label)}
        <span class="sort-indicator"></span>
      </button>
    </th>
  `;
}

function bindSortButtons(renderFn) {
  document.querySelectorAll(".sort-button").forEach(button => {
    button.onclick = () => {
      const key = button.dataset.sort;

      if (state.sortKey === key) {
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = key;

        state.sortDir = [
          "score", "wins", "seconds", "thirds",
          "podiums", "appearances"
        ].includes(key) ? "desc" : "asc";
      }

      renderFn();
    };
  });
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

function renderSubcategoryAwards() {
  const section = $("subcategorySection");
  const roundMeta = getRoundMeta();

  if (
    !roundMeta ||
    !roundMeta.enableSubcategories ||
    !roundMeta.subcategories ||
    !roundMeta.subcategories.length
  ) {
    section.hidden = true;
    return;
  }

  section.hidden = false;

  const participants = getFilteredRoundEntries();
  const grid = $("subcategoryGrid");
  const aggregation = roundMeta.subcategoryAggregation || "AVERAGE";

  $("subcategoryMethod").textContent =
    aggregation === "SUM"
      ? "Judge scores summed · Final Score와 별도"
      : "Judge scores averaged · Final Score와 별도";

  grid.innerHTML = roundMeta.subcategories
    .map(category => {
      const ranking = participants
        .map(p => ({
          participant: p,
          score: p.subcategories
            ? Number(p.subcategories[category.key])
            : NaN
        }))
        .filter(item => Number.isFinite(item.score))
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return String(a.participant.no || "").localeCompare(
            String(b.participant.no || ""),
            undefined,
            { numeric: true }
          );
        });

      if (!ranking.length) {
        return `
          <article class="award-card">
            <div class="award-card__header">
              <span>SUBCATEGORY</span>
              <h3>${escapeHtml(category.label)}</h3>
            </div>
            <div class="award-empty">점수 데이터 없음</div>
          </article>
        `;
      }

      const topScore = ranking[0].score;
      const winners = ranking.filter(
        item => Math.abs(item.score - topScore) < 1e-12
      );

      return `
        <article class="award-card">
          <div class="award-card__header">
            <span>SUBCATEGORY</span>
            <h3>${escapeHtml(category.label)}</h3>
          </div>

          <div class="award-winner">
            <span>WINNER${winners.length > 1 ? "S" : ""}</span>
            <strong>${winners.map(item => escapeHtml(item.participant.username)).join(" · ")}</strong>
            <em>${number(topScore, 2)}</em>
          </div>

          <div class="award-ranking">
            ${renderAwardPlaces(ranking)}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderAwardPlaces(ranking) {
  const rows = [];
  let previousScore = null;
  let previousRank = 0;

  ranking.forEach((item, index) => {
    const same =
      previousScore !== null &&
      Math.abs(item.score - previousScore) < 1e-12;

    const rank = same ? previousRank : index + 1;

    if (rank <= 3) {
      rows.push(`
        <div class="award-place">
          <span>#${rank}</span>
          <strong>${escapeHtml(item.participant.username)}</strong>
          <em>${number(item.score, 2)}</em>
        </div>
      `);
    }

    previousScore = item.score;
    previousRank = rank;
  });

  return rows.join("");
}

function renderScoringMethod() {
  const grid = $("methodGrid");
  grid.innerHTML = "";

  if (state.round === "ALL_TIME") {
    $("methodHeading").textContent = "전회차 종합 순위 기준";

    grid.innerHTML = `
      ${methodCard("Primary", "1위 횟수가 많은 참가자를 우선합니다.", "Wins: descending")}
      ${methodCard("Tie-break", "1위 횟수가 같으면 2위 횟수 → 3위 횟수 → 포디움 횟수 순으로 비교합니다.", "2nd → 3rd → Podiums")}
      ${methodCard("Final Tie-break", "여전히 같으면 평균 순위가 더 높은 참가자를 우선합니다.", "Average Rank: ascending")}
    `;
    return;
  }

  const r = getRoundMeta();
  $("methodHeading").textContent = `${r.label || `${r.round}회`} 평가 방식`;

  const standardizedText = r.useStandardization
    ? (
        r.standardizationScope === "GROUP"
          ? `각 Group 내부에서 Judge별 평균과 ${r.stdDev} 표준편차를 계산해 Raw Score를 표준화합니다.`
          : `Round 전체 참가자 기준으로 Judge별 평균과 ${r.stdDev} 표준편차를 계산해 Raw Score를 표준화합니다.`
      )
    : "이 회차는 표준화를 적용하지 않고 Judge Raw Score를 사용합니다.";

  const trimText =
    `Highest ${r.trimHighest}개 / Lowest ${r.trimLowest}개 제외 후 ` +
    `${r.aggregation} 방식으로 최종점수를 계산합니다.`;

  if (r.scoreInputMode === "BONUS_PENALTY") {
    grid.innerHTML = `
      ${methodCard(
        "Judge Raw Score",
        `각 심사위원은 기본 ${r.baseScore}점에서 Plus 0~75점을 더하고 Minus 점수를 감점합니다. 저장된 Raw Score를 최종 Judge 원점수로 사용합니다.`,
        `Base ${r.baseScore} + Plus - Minus = Raw`
      )}
      ${methodCard(
        "Standardization",
        standardizedText,
        r.useStandardization
          ? "Z-Score = (Raw - Judge Mean) / Judge Standard Deviation"
          : "Standardization = OFF"
      )}
      ${methodCard(
        "Final Score",
        trimText,
        `Trim High ${r.trimHighest} · Trim Low ${r.trimLowest} · ${r.aggregation}`
      )}
    `;
    return;
  }

  const rawText =
    `Basic ${r.basicMax} + Technical ${r.technicalMax} + ` +
    `Creativity ${r.creativityMax} + Impression ${r.impressionMax}`;

  grid.innerHTML = `
    ${methodCard("Raw Score", rawText, `Raw Score = ${r.rawMax} maximum`)}
    ${methodCard(
      "Standardization",
      standardizedText,
      r.useStandardization
        ? "Z-Score = (Raw - Judge Mean) / Judge Standard Deviation"
        : "Standardization = OFF"
    )}
    ${methodCard(
      "Final Score",
      trimText,
      `Trim High ${r.trimHighest} · Trim Low ${r.trimLowest} · ${r.aggregation}`
    )}
  `;
}

function methodCard(title, text, code) {
  return `
    <article>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(text)}</p>
      <code>${escapeHtml(code)}</code>
    </article>
  `;
}

function showRoundDetail(p, rank, selectedJudgeIndex) {
  const roundMeta = getRoundMeta();
  const judgeRankingActive = selectedJudgeIndex !== null;
  const selectedJudge = judgeRankingActive ? p.judges[selectedJudgeIndex] : null;

  const judgeRows = p.judges.map(j => {
    if (!j.available) {
      return `
        <section class="judge-entry judge-entry--unavailable">
          <div class="judge-row judge-row--unavailable">
            <div class="judge-name"><strong>${escapeHtml(j.name)}</strong></div>
            <div class="meta">세부 심사 데이터 없음</div>
          </div>
        </section>
      `;
    }

    const scoreLabel = roundMeta.useStandardization
      ? `<div class="judge-z"><span>Z-Score</span><strong>${signed(j.zScore)}</strong></div>`
      : `<div class="judge-z"><span>Judge Score</span><strong>${number(j.rawScore, 1)}</strong></div>`;

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
                  }">${
                    j.excludedReason === "highest"
                      ? "Highest · Excluded"
                      : "Lowest · Excluded"
                  }</span>`
                : ""
            }
          </div>

          <div class="judge-total">
            <span>Raw</span>
            <strong>${number(j.rawScore, 1)} / ${number(roundMeta.rawMax, 0)}</strong>
          </div>

          ${scoreLabel}
        </div>

        ${
          roundMeta.scoreInputMode === "BONUS_PENALTY"
            ? `
              <div class="criterion-strip criterion-strip--round13">
                ${round13Criterion("Base", j.baseScore, "base")}
                ${round13Criterion("Plus", j.bonus, "plus")}
                ${round13Criterion("Minus", j.penalty, "minus")}
                ${round13Criterion("Raw", j.rawScore, "raw")}
              </div>
            `
            : `
              <div class="criterion-strip">
                ${judgeCriterion("Basic", j.basic, roundMeta.basicMax)}
                ${judgeCriterion("Technical", j.technical, roundMeta.technicalMax)}
                ${judgeCriterion("Creativity", j.creativity, roundMeta.creativityMax)}
                ${judgeCriterion("Impression", j.impression, roundMeta.impressionMax)}
              </div>
            `
        }

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

  const headlineScore = judgeRankingActive && selectedJudge && selectedJudge.available
    ? (
        roundMeta.useStandardization
          ? `${signed(selectedJudge.zScore)} <small>Z</small>`
          : `${number(selectedJudge.rawScore, 1)} <small>Raw</small>`
      )
    : formatScore(p.finalScore);

  $("detailContent").innerHTML = `
    <div class="detail-inner">
      <div class="detail-title-row">
        <div>
          <p class="section-kicker">
            ${escapeHtml(roundMeta.label || `${roundMeta.round}회`)} · RANK #${rank}
          </p>
          <h2>${escapeHtml(p.username)}</h2>
          <p class="detail-sub">
            ${[p.group, p.no ? `No. ${p.no}` : "", p.track]
              .filter(Boolean)
              .map(escapeHtml)
              .join(" · ")}
          </p>
          ${
            p.calculationSource === "override"
              ? `<p class="detail-sub">Historical Final Score Override</p>`
              : ""
          }
        </div>

        <div class="detail-score">${headlineScore}</div>
      </div>

      ${
        roundMeta.scoreInputMode === "BONUS_PENALTY"
          ? `
            <div class="category-grid">
              ${round13SummaryCard("Base Score", roundMeta.baseScore, "base")}
              ${round13SummaryCard("Avg Plus", averageJudgeValue(p.judges, "bonus"), "plus")}
              ${round13SummaryCard("Avg Minus", averageJudgeValue(p.judges, "penalty"), "minus")}
              ${round13SummaryCard("Avg Raw", averageJudgeValue(p.judges, "rawScore"), "raw")}
            </div>
          `
          : `
            <div class="category-grid">
              ${categoryCard("Basic Skill", p.categoryAverages.basic, roundMeta.basicMax)}
              ${categoryCard("Technical Skill", p.categoryAverages.technical, roundMeta.technicalMax)}
              ${categoryCard("Creativity", p.categoryAverages.creativity, roundMeta.creativityMax)}
              ${categoryCard("Judge's impression", p.categoryAverages.impression, roundMeta.impressionMax)}
            </div>
          `
      }

      <p class="section-kicker judge-section-title">JUDGE SCORES & COMMENTS</p>
      <div class="judge-list">${judgeRows}</div>
    </div>
  `;

  $("detailDialog").showModal();
}

function showAllTimeDetail(p) {
  const history = [...p.history].sort(
    (a, b) => Number(b.round) - Number(a.round)
  );

  $("detailContent").innerHTML = `
    <div class="detail-inner">
      <div class="detail-title-row">
        <div>
          <p class="section-kicker">ALL-TIME RANK #${p.rank}</p>
          <h2>${escapeHtml(p.username)}</h2>
          <p class="detail-sub">${escapeHtml(p.participantId)}</p>
        </div>

        <div class="detail-score">${p.wins}<small> Wins</small></div>
      </div>

      <div class="alltime-stats">
        ${statCard("Wins", p.wins)}
        ${statCard("2nd", p.seconds)}
        ${statCard("3rd", p.thirds)}
        ${statCard("Podiums", p.podiums)}
        ${statCard("Appearances", p.appearances)}
        ${statCard("Avg Rank", number(p.averageRank, 2))}
      </div>

      <p class="section-kicker judge-section-title">ROUND HISTORY</p>

      <div class="history-list">
        ${history.map(h => `
          <div class="history-row">
            <div>
              <strong>${escapeHtml(h.label || `${h.round}회`)}</strong>
              <span>${escapeHtml(h.group || "")}</span>
            </div>
            <div class="history-rank">#${h.rank}</div>
            <div class="history-score">${number(h.finalScore, 3)}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;

  $("detailDialog").showModal();
}

function statCard(label, value) {
  return `
    <div class="stat-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function categoryCard(label, score, max) {
  return `
    <div class="category-card">
      <span>${escapeHtml(label)}</span>
      <strong>${number(score, 2)} <small>/ ${max}</small></strong>
    </div>
  `;
}

function round13SummaryCard(label, value, kind) {
  return `
    <div class="category-card round13-card round13-card--${kind}">
      <span>${escapeHtml(label)}</span>
      <strong>${number(value, 2)}</strong>
    </div>
  `;
}

function round13Criterion(label, value, kind) {
  const prefix =
    kind === "plus"
      ? "+"
      : (kind === "minus" ? "−" : "");

  return `
    <div class="criterion-item criterion-item--${kind}">
      <span>${escapeHtml(label)}</span>
      <strong>${prefix}${number(value, 1)}</strong>
    </div>
  `;
}

function averageJudgeValue(judges, key) {
  const values = judges
    .filter(j => j.available && j[key] !== null && j[key] !== undefined && j[key] !== "")
    .map(j => Number(j[key]))
    .filter(Number.isFinite);

  if (!values.length) return null;

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function judgeCriterion(label, score, max) {
  return `
    <div class="criterion-item">
      <span>${escapeHtml(label)}</span>
      <strong>${number(score, 1)} <small>/ ${max}</small></strong>
    </div>
  `;
}

function compareValues(a, b, numeric) {
  if (numeric) {
    const av = Number(a);
    const bv = Number(b);

    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  }

  return String(a || "").localeCompare(
    String(b || ""),
    undefined,
    { numeric: true, sensitivity: "base" }
  );
}

function formatScore(value) {
  return number(value, state.payload.meta.scorePrecision || 3);
}

function number(value, digits) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "—";
}

function signed(value) {
  if (value === null || value === undefined || value === "") return "—";

  const n = Number(value);
  const precision = state.payload.meta.scorePrecision || 3;

  if (!Number.isFinite(n)) return "—";

  return `${n > 0 ? "+" : ""}${n.toFixed(precision)}`;
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
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

  if (!state.payload) return;

  if (state.round === "ALL_TIME") {
    renderAllTimeTable();
  } else {
    renderRoundTable();
  }
});

$("dialogClose").addEventListener("click", () => $("detailDialog").close());

$("detailDialog").addEventListener("click", event => {
  if (event.target === $("detailDialog")) {
    $("detailDialog").close();
  }
});

loadResults();
