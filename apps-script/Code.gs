const CONFIG_SHEET = "Config";
const SCORE_SHEET = "Scores";
const ROUNDS_SHEET = "Rounds";

const MAX_JUDGES = 7;
const CURRENT_ROUND = 14;

function doGet(e) {
  try {
    const result = buildResults_();
    result.ok = true;
    return respond_(result, e);
  } catch (err) {
    return respond_({
      ok: false,
      error: String(err && err.message ? err.message : err)
    }, e);
  }
}

function buildResults_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const config = readConfig_(ss);
  const roundRules = readRoundRules_(ss, config);
  const scoreSheet = ss.getSheetByName(SCORE_SHEET);

  if (!scoreSheet) {
    throw new Error('"Scores" 시트가 없습니다.');
  }

  const values = scoreSheet.getDataRange().getValues();

  if (values.length < 2) {
    return {
      meta: buildMeta_(config),
      rounds: serializeRounds_(roundRules),
      entries: [],
      allTime: []
    };
  }

  const headers = values[0].map(String);
  validateBaseHeaders_(headers);

  const index = {};
  headers.forEach(function(h, i) {
    index[h] = i;
  });

  const rawRows = values.slice(1)
    .filter(function(row) {
      return row.some(function(v) {
        return v !== "";
      });
    })
    .filter(function(row) {
      return normalizeBoolean_(
        cell_(row, index, "Published", true)
      );
    });

  const entries = [];

  Object.keys(roundRules).forEach(function(roundKey) {
    const rule = roundRules[roundKey];

    if (!rule.enabled) {
      return;
    }

    const rows = rawRows.filter(function(row) {
      const roundValue = Number(
        cell_(row, index, "Round", CURRENT_ROUND)
      );

      return roundValue === Number(rule.round);
    });

    if (!rows.length) {
      return;
    }

    const participants = rows.map(function(row, offset) {
      return parseParticipant_(
        row,
        index,
        rule,
        offset + 2
      );
    });

    const groups = {};

    participants.forEach(function(p) {
      const key = p.group || "__ALL__";

      if (!groups[key]) {
        groups[key] = [];
      }

      groups[key].push(p);
    });

    /*
     * 회차별로 표준화 모집단을 다르게 적용한다.
     *
     * ROUND : 해당 회차 전체 참가자로 Judge Mean / StdDev 계산
     * GROUP : 각 Group 내부 참가자로 Judge Mean / StdDev 계산
     *
     * 12회 실제 시트는 GROUP + POPULATION 방식.
     * 13/14회는 ROUND 방식.
     */
    if (rule.standardizationScope === "GROUP") {
      Object.keys(groups).forEach(function(groupKey) {
        calculateGroupScores_(groups[groupKey], rule);
      });
    } else {
      calculateGroupScores_(participants, rule);
    }

    calculateSubcategoryAwards_(participants, rule);

    Object.keys(groups).forEach(function(groupKey) {
      rank_(groups[groupKey], "groupRank");
    });

    rank_(participants, "overallRank");

    participants.forEach(function(p) {
      entries.push(
        serializeParticipant_(p, rule)
      );
    });
  });

  return {
    meta: buildMeta_(config),
    rounds: serializeRounds_(roundRules),
    entries: entries,
    allTime: buildAllTime_(entries, roundRules)
  };
}

function parseParticipant_(row, index, rule, rowNumber) {
  const username = String(
    cell_(row, index, "Username", "") || ""
  ).trim();

  if (!username) {
    throw new Error(
      "Scores 시트 " + rowNumber +
      "행: Username이 비어 있습니다."
    );
  }

  const participantId = String(
    cell_(
      row,
      index,
      "ParticipantID",
      username
    ) || username
  ).trim();

  const finalScoreOverride = numberOrNull_(
    cell_(row, index, "FinalScoreOverride", "")
  );

  const p = {
    round: Number(rule.round),
    participantId: participantId,
    group: String(
      cell_(row, index, "Group", "") || ""
    ).trim(),
    no: String(
      cell_(row, index, "No", "") || ""
    ).trim(),
    username: username,
    track: String(
      cell_(row, index, "Track", "") || ""
    ).trim(),
    finalScoreOverride: finalScoreOverride,
    judges: []
  };

  for (let j = 1; j <= rule.judgeCount; j++) {
    if (rule.scoreInputMode === "BONUS_PENALTY") {
      p.judges.push(
        parseBonusPenaltyJudge_(
          row,
          index,
          rule,
          rowNumber,
          j,
          finalScoreOverride
        )
      );

      continue;
    }

    p.judges.push(
      parseCriteriaJudge_(
        row,
        index,
        rule,
        rowNumber,
        j,
        finalScoreOverride
      )
    );
  }

  if (
    rule.enableSubcategories &&
    rule.subcategories &&
    rule.subcategories.length
  ) {
    p.subcategoryJudgeScores = [];

    for (let j = 1; j <= rule.judgeCount; j++) {
      const scores = {};

      rule.subcategories.forEach(function(category) {
        const value = cell_(
          row,
          index,
          "J" + j + "_" + category.columnSuffix,
          ""
        );

        scores[category.key] =
          value === "" || value === null
            ? null
            : readSubcategoryScore_(
                value,
                rowNumber,
                "J" + j + "_" + category.columnSuffix
              );
      });

      p.subcategoryJudgeScores.push(scores);
    }
  } else {
    p.subcategoryJudgeScores = [];
  }

  return p;
}

function parseBonusPenaltyJudge_(
  row,
  index,
  rule,
  rowNumber,
  judgeNumber,
  finalScoreOverride
) {
  const prefix = "J" + judgeNumber;

  const bonusValue = cell_(
    row,
    index,
    prefix + "_Bonus",
    ""
  );

  const penaltyValue = cell_(
    row,
    index,
    prefix + "_Penalty",
    ""
  );

  const rawValue = cell_(
    row,
    index,
    prefix + "_Raw",
    ""
  );

  const allMissing =
    bonusValue === "" &&
    penaltyValue === "" &&
    rawValue === "";

  if (allMissing && finalScoreOverride !== null) {
    return unavailableJudge_(
      rule.judges[judgeNumber - 1],
      String(
        cell_(
          row,
          index,
          prefix + "_Comment",
          ""
        ) || ""
      ).trim()
    );
  }

  if (
    bonusValue === "" ||
    penaltyValue === "" ||
    rawValue === ""
  ) {
    throw new Error(
      "Scores 시트 " + rowNumber +
      "행: " + prefix +
      "_Bonus / " + prefix +
      "_Penalty / " + prefix +
      "_Raw를 모두 입력하세요."
    );
  }

  const bonus = Number(bonusValue);
  const penaltyInput = Number(penaltyValue);
  const rawScore = Number(rawValue);

  if (
    !Number.isFinite(bonus) ||
    bonus < 0 ||
    bonus > 75
  ) {
    throw new Error(
      "Scores 시트 " + rowNumber +
      "행: " + prefix +
      "_Bonus는 0~75 범위여야 합니다."
    );
  }

  if (!Number.isFinite(penaltyInput)) {
    throw new Error(
      "Scores 시트 " + rowNumber +
      "행: " + prefix +
      "_Penalty는 숫자여야 합니다."
    );
  }

  if (!Number.isFinite(rawScore)) {
    throw new Error(
      "Scores 시트 " + rowNumber +
      "행: " + prefix +
      "_Raw는 숫자여야 합니다."
    );
  }

  const penalty = Math.abs(penaltyInput);

  return {
    name: rule.judges[judgeNumber - 1],
    available: true,
    inputMode: "BONUS_PENALTY",
    baseScore: rule.baseScore,
    bonus: bonus,
    penalty: penalty,
    basic: null,
    technical: null,
    creativity: null,
    impression: null,

    // 저장된 Raw를 최종 Judge 원점수로 사용한다.
    rawScore: rawScore,

    // 검산용 값. 순위 계산에는 사용하지 않는다.
    calculatedRaw:
      rule.baseScore +
      bonus -
      penalty,

    comment: String(
      cell_(
        row,
        index,
        prefix + "_Comment",
        ""
      ) || ""
    ).trim(),

    zScore: null,
    scoreValue: null,
    excluded: false,
    excludedReason: ""
  };
}

function parseCriteriaJudge_(
  row,
  index,
  rule,
  rowNumber,
  judgeNumber,
  finalScoreOverride
) {
  const prefix = "J" + judgeNumber;

  const basicValue = cell_(
    row,
    index,
    prefix + "_Basic",
    ""
  );

  const technicalValue = cell_(
    row,
    index,
    prefix + "_Technical",
    ""
  );

  const creativityValue = cell_(
    row,
    index,
    prefix + "_Creativity",
    ""
  );

  const impressionValue = cell_(
    row,
    index,
    prefix + "_Impression",
    ""
  );

  const allPresent =
    basicValue !== "" &&
    technicalValue !== "" &&
    creativityValue !== "" &&
    impressionValue !== "";

  if (!allPresent && finalScoreOverride === null) {
    throw new Error(
      "Scores 시트 " + rowNumber +
      "행: " + prefix +
      " 세부 점수가 누락되었습니다. " +
      "세부 점수가 없는 과거 회차는 FinalScoreOverride를 입력하세요."
    );
  }

  if (!allPresent) {
    return unavailableJudge_(
      rule.judges[judgeNumber - 1],
      String(
        cell_(
          row,
          index,
          prefix + "_Comment",
          ""
        ) || ""
      ).trim()
    );
  }

  const judge = {
    name: rule.judges[judgeNumber - 1],
    available: true,
    inputMode: "CRITERIA",
    baseScore: null,
    bonus: null,
    penalty: null,

    basic: readScore_(
      basicValue,
      rule.basicMax,
      rowNumber,
      prefix + "_Basic"
    ),

    technical: readScore_(
      technicalValue,
      rule.technicalMax,
      rowNumber,
      prefix + "_Technical"
    ),

    creativity: readScore_(
      creativityValue,
      rule.creativityMax,
      rowNumber,
      prefix + "_Creativity"
    ),

    impression: readScore_(
      impressionValue,
      rule.impressionMax,
      rowNumber,
      prefix + "_Impression"
    ),

    comment: String(
      cell_(
        row,
        index,
        prefix + "_Comment",
        ""
      ) || ""
    ).trim(),

    zScore: null,
    scoreValue: null,
    excluded: false,
    excludedReason: ""
  };

  judge.rawScore =
    judge.basic +
    judge.technical +
    judge.creativity +
    judge.impression;

  return judge;
}

function unavailableJudge_(name, comment) {
  return {
    name: name,
    available: false,
    inputMode: null,
    baseScore: null,
    bonus: null,
    penalty: null,
    basic: null,
    technical: null,
    creativity: null,
    impression: null,
    rawScore: null,
    calculatedRaw: null,
    zScore: null,
    scoreValue: null,
    comment: comment || "",
    excluded: false,
    excludedReason: ""
  };
}

function calculateGroupScores_(participants, rule) {
  for (
    let judgeIndex = 0;
    judgeIndex < rule.judgeCount;
    judgeIndex++
  ) {
    const availableParticipants =
      participants.filter(function(p) {
        return (
          p.judges[judgeIndex] &&
          p.judges[judgeIndex].available
        );
      });

    const rawScores =
      availableParticipants.map(function(p) {
        return p.judges[judgeIndex].rawScore;
      });

    if (!rawScores.length) {
      continue;
    }

    const mean = average_(rawScores);

    const sd =
      rule.stdDev === "SAMPLE"
        ? sampleStdDev_(rawScores, mean)
        : populationStdDev_(rawScores, mean);

    availableParticipants.forEach(function(p) {
      const judge = p.judges[judgeIndex];

      if (rule.useStandardization) {
        judge.zScore =
          sd === 0
            ? 0
            : (judge.rawScore - mean) / sd;

        judge.scoreValue = judge.zScore;
      } else {
        judge.zScore = null;
        judge.scoreValue = judge.rawScore;
      }
    });
  }

  participants.forEach(function(p) {
    const availableJudges = p.judges.filter(
      function(j) {
        return (
          j.available &&
          j.scoreValue !== null &&
          Number.isFinite(Number(j.scoreValue))
        );
      }
    );

    if (availableJudges.length) {
      markExcludedJudges_(p, rule);
    }

    if (p.finalScoreOverride !== null) {
      p.finalScore = p.finalScoreOverride;
      p.calculationSource = "override";
      return;
    }

    const included = p.judges
      .filter(function(j) {
        return (
          j.available &&
          !j.excluded &&
          j.scoreValue !== null
        );
      })
      .map(function(j) {
        return Number(j.scoreValue);
      });

    if (!included.length) {
      throw new Error(
        p.username +
        ": 최종점수를 계산할 Judge 점수가 없습니다."
      );
    }

    if (rule.aggregation === "AVERAGE") {
      p.finalScore = average_(included);
    } else {
      p.finalScore = included.reduce(
        function(sum, value) {
          return sum + value;
        },
        0
      );
    }

    p.calculationSource = "calculated";
  });
}

function markExcludedJudges_(p, rule) {
  p.judges.forEach(function(j) {
    j.excluded = false;
    j.excludedReason = "";
  });

  const scored = [];

  p.judges.forEach(function(j, index) {
    if (
      j.available &&
      j.scoreValue !== null &&
      Number.isFinite(Number(j.scoreValue))
    ) {
      scored.push({
        index: index,
        score: Number(j.scoreValue)
      });
    }
  });

  if (!scored.length) {
    return;
  }

  const lowSorted = scored.slice().sort(
    function(a, b) {
      return a.score - b.score;
    }
  );

  const used = {};
  let lowCount = 0;

  for (
    let i = 0;
    i < lowSorted.length &&
    lowCount < rule.trimLowest;
    i++
  ) {
    const idx = lowSorted[i].index;

    used[idx] = true;
    p.judges[idx].excluded = true;
    p.judges[idx].excludedReason = "lowest";
    lowCount++;
  }

  const highSorted = scored.slice().sort(
    function(a, b) {
      return b.score - a.score;
    }
  );

  let highCount = 0;

  for (
    let i = 0;
    i < highSorted.length &&
    highCount < rule.trimHighest;
    i++
  ) {
    const idx = highSorted[i].index;

    if (used[idx]) {
      continue;
    }

    used[idx] = true;
    p.judges[idx].excluded = true;
    p.judges[idx].excludedReason = "highest";
    highCount++;
  }
}

function serializeParticipant_(p, rule) {
  const available = p.judges.filter(function(j) {
    return j.available;
  });

  return {
    round: p.round,
    participantId: p.participantId,
    group: p.group,
    no: p.no,
    username: p.username,
    track: p.track,
    finalScore: round_(p.finalScore, 8),
    groupRank: p.groupRank,
    overallRank: p.overallRank,
    calculationSource: p.calculationSource,

    categoryAverages:
      rule.scoreInputMode === "BONUS_PENALTY"
        ? {
            basic: null,
            technical: null,
            creativity: null,
            impression: null
          }
        : {
            basic: averageOrNull_(available, "basic"),
            technical: averageOrNull_(available, "technical"),
            creativity: averageOrNull_(available, "creativity"),
            impression: averageOrNull_(available, "impression")
          },

    subcategories: buildParticipantSubcategories_(p, rule),

    judges: p.judges.map(function(j, judgeIndex) {
      return {
        name: j.name,
        available: Boolean(j.available),
        inputMode: j.inputMode || rule.scoreInputMode,
        baseScore: j.baseScore,
        bonus: j.bonus,
        penalty: j.penalty,
        calculatedRaw:
          j.calculatedRaw === undefined
            ? null
            : j.calculatedRaw,
        subcategoryScores:
          p.subcategoryJudgeScores &&
          p.subcategoryJudgeScores[judgeIndex]
            ? p.subcategoryJudgeScores[judgeIndex]
            : {},
        subcategoryZScores:
          p.subcategoryJudgeZScores &&
          p.subcategoryJudgeZScores[judgeIndex]
            ? p.subcategoryJudgeZScores[judgeIndex]
            : {},
        basic: j.basic,
        technical: j.technical,
        creativity: j.creativity,
        impression: j.impression,
        rawScore: j.rawScore,
        zScore:
          j.zScore === null
            ? null
            : round_(j.zScore, 8),
        comment: j.comment,
        excluded: Boolean(j.excluded),
        excludedReason: j.excludedReason || ""
      };
    })
  };
}

function averageOrNull_(judges, key) {
  if (!judges.length) {
    return null;
  }

  return round_(
    average_(
      judges.map(function(j) {
        return Number(j[key]);
      })
    ),
    4
  );
}

function buildParticipantSubcategories_(p, rule) {
  const result = {};

  if (
    !rule.enableSubcategories ||
    !rule.subcategories ||
    !rule.subcategories.length
  ) {
    return result;
  }

  if (rule.subcategoryAggregation === "RANK_BONUS_10_5_2") {
    return p.computedSubcategories || result;
  }

  rule.subcategories.forEach(function(category) {
    const scores = [];

    p.subcategoryJudgeScores.forEach(function(judgeScores) {
      const value = judgeScores[category.key];

      if (
        value !== null &&
        value !== undefined &&
        Number.isFinite(Number(value))
      ) {
        scores.push(Number(value));
      }
    });

    if (!scores.length) {
      result[category.key] = null;
      return;
    }

    if (rule.subcategoryAggregation === "SUM") {
      result[category.key] = round_(
        scores.reduce(function(sum, value) {
          return sum + value;
        }, 0),
        8
      );
    } else {
      result[category.key] = round_(average_(scores), 8);
    }
  });

  return result;
}

function calculateSubcategoryAwards_(participants, rule) {
  if (
    !rule.enableSubcategories ||
    !rule.subcategories ||
    !rule.subcategories.length
  ) {
    return;
  }

  participants.forEach(function(p) {
    p.computedSubcategories = {};
    p.subcategoryJudgeZScores = [];
    for (let j = 0; j < rule.judgeCount; j++) {
      p.subcategoryJudgeZScores.push({});
    }
    rule.subcategories.forEach(function(category) {
      p.computedSubcategories[category.key] = 0;
    });
  });

  rule.subcategories.forEach(function(category) {
    for (let judgeIndex = 0; judgeIndex < rule.judgeCount; judgeIndex++) {
      const scored = [];

      participants.forEach(function(p, participantIndex) {
        const judgeScores = p.subcategoryJudgeScores[judgeIndex] || {};
        const value = judgeScores[category.key];

        if (
          value !== null &&
          value !== undefined &&
          Number.isFinite(Number(value))
        ) {
          scored.push({
            participantIndex: participantIndex,
            score: Number(value)
          });
        }
      });

      const mean = scored.length
        ? scored.reduce(function(sum, item) {
            return sum + item.score;
          }, 0) / scored.length
        : 0;

      const variance = scored.length
        ? scored.reduce(function(sum, item) {
            return sum + Math.pow(item.score - mean, 2);
          }, 0) / scored.length
        : 0;

      const sd = Math.sqrt(variance);

      scored.forEach(function(item) {
        item.zScore = sd === 0
          ? 0
          : (item.score - mean) / sd;

        participants[item.participantIndex]
          .subcategoryJudgeZScores[judgeIndex][category.key] =
            round_(item.zScore, 8);
      });

      scored.sort(function(a, b) {
        if (b.zScore !== a.zScore) return b.zScore - a.zScore;
        return a.participantIndex - b.participantIndex;
      });

      let previousScore = null;
      let denseRank = 0;

      scored.forEach(function(item) {
        if (
          previousScore === null ||
          Math.abs(item.zScore - previousScore) >= 1e-12
        ) {
          denseRank++;
        }

        const award =
          denseRank === 1 ? 10 :
          denseRank === 2 ? 5 :
          denseRank === 3 ? 2 : 0;

        participants[item.participantIndex]
          .computedSubcategories[category.key] += award;

        previousScore = item.zScore;
      });
    }
  });
}

function readSubcategoryScore_(value, rowNumber, columnName) {
  const n = Number(value);

  if (!Number.isFinite(n)) {
    throw new Error(
      "Scores 시트 " +
      rowNumber +
      "행: " +
      columnName +
      " 값은 숫자여야 합니다."
    );
  }

  return n;
}

function buildAllTime_(entries, roundRules) {
  const map = {};

  entries.forEach(function(e) {
    const rule = roundRules[String(e.round)];

    // All-Time records always use the participant's rank inside their group.
    const rankForHistory = e.groupRank;

    const id = e.participantId || e.username;

    if (!map[id]) {
      map[id] = {
        participantId: id,
        username: e.username,
        wins: 0,
        seconds: 0,
        thirds: 0,
        podiums: 0,
        appearances: 0,
        rankSum: 0,
        latestRound: -Infinity,
        history: []
      };
    }

    const item = map[id];

    if (Number(e.round) >= item.latestRound) {
      item.username = e.username;
      item.latestRound = Number(e.round);
    }

    item.appearances++;
    item.rankSum += Number(rankForHistory);

    if (rankForHistory === 1) item.wins++;
    if (rankForHistory === 2) item.seconds++;
    if (rankForHistory === 3) item.thirds++;
    if (rankForHistory <= 3) item.podiums++;

    item.history.push({
      round: e.round,
      label: rule ? rule.label : String(e.round),
      group: e.group,
      rank: rankForHistory,
      finalScore: e.finalScore
    });
  });

  const list = Object.keys(map).map(function(key) {
    const item = map[key];

    item.averageRank =
      item.appearances
        ? item.rankSum / item.appearances
        : 0;

    delete item.rankSum;
    delete item.latestRound;

    return item;
  });

  list.sort(allTimeComparator_);

  let previousKey = null;
  let previousRank = 0;

  list.forEach(function(item, index) {
    const key = allTimeTieKey_(item);

    item.rank =
      previousKey !== null &&
      key === previousKey
        ? previousRank
        : index + 1;

    previousKey = key;
    previousRank = item.rank;
  });

  return list;
}

function allTimeComparator_(a, b) {
  if (b.wins !== a.wins) return b.wins - a.wins;
  if (b.seconds !== a.seconds) return b.seconds - a.seconds;
  if (b.thirds !== a.thirds) return b.thirds - a.thirds;
  if (b.podiums !== a.podiums) return b.podiums - a.podiums;
  if (a.averageRank !== b.averageRank) return a.averageRank - b.averageRank;
  if (b.appearances !== a.appearances) return b.appearances - a.appearances;

  return String(a.username).localeCompare(String(b.username));
}

function allTimeTieKey_(item) {
  return [
    item.wins,
    item.seconds,
    item.thirds,
    item.podiums,
    round_(item.averageRank, 8),
    item.appearances
  ].join("|");
}

function rank_(participants, property) {
  const sorted = participants.slice().sort(
    function(a, b) {
      if (b.finalScore !== a.finalScore) {
        return b.finalScore - a.finalScore;
      }

      return String(a.no).localeCompare(
        String(b.no),
        undefined,
        { numeric: true }
      );
    }
  );

  let previousScore = null;
  let previousRank = 0;

  sorted.forEach(function(p, i) {
    const same =
      previousScore !== null &&
      Math.abs(p.finalScore - previousScore) < 1e-12;

    p[property] = same ? previousRank : i + 1;

    previousScore = p.finalScore;
    previousRank = p[property];
  });
}

function readRoundRules_(ss, config) {
  const sheet = ss.getSheetByName(ROUNDS_SHEET);
  const rules = {};

  if (!sheet) {
    rules[String(CURRENT_ROUND)] =
      defaultRound14Rule_(config);

    return rules;
  }

  const values = sheet.getDataRange().getValues();

  if (values.length < 2) {
    rules[String(CURRENT_ROUND)] =
      defaultRound14Rule_(config);

    return rules;
  }

  const headers = values[0].map(String);
  const index = {};

  headers.forEach(function(h, i) {
    index[h] = i;
  });

  values.slice(1).forEach(function(row) {
    const round = Number(
      cell_(row, index, "Round", "")
    );

    if (!Number.isFinite(round)) {
      return;
    }

    const judgeCount = clamp_(
      Number(
        cell_(row, index, "JudgeCount", MAX_JUDGES)
      ),
      1,
      MAX_JUDGES
    );

    const judges = [];

    for (let j = 1; j <= judgeCount; j++) {
      judges.push(
        String(
          cell_(
            row,
            index,
            "Judge" + j,
            config.judges[j - 1] || ("Judge " + j)
          )
        ).trim()
      );
    }

    const basicMax = Number(
      cell_(row, index, "BasicMax", 20)
    );

    const technicalMax = Number(
      cell_(row, index, "TechnicalMax", 30)
    );

    const creativityMax = Number(
      cell_(row, index, "CreativityMax", 25)
    );

    const impressionMax = Number(
      cell_(row, index, "ImpressionMax", 25)
    );

    const scoreInputMode = String(
      cell_(
        row,
        index,
        "ScoreInputMode",
        round === 13
          ? "BONUS_PENALTY"
          : "CRITERIA"
      ) || (
        round === 13
          ? "BONUS_PENALTY"
          : "CRITERIA"
      )
    ).toUpperCase();

    const baseScore = Number(
      cell_(
        row,
        index,
        "BaseScore",
        round === 13 ? 75 : 0
      )
    );


    rules[String(round)] = {
      round: round,
      label: String(
        cell_(row, index, "Label", round + "회") || (round + "회")
      ),

      enabled: normalizeBoolean_(
        cell_(row, index, "Enabled", false)
      ),

      judgeCount: judgeCount,

      scoreInputMode: scoreInputMode,

      baseScore: baseScore,

      useStandardization: normalizeBoolean_(
        cell_(row, index, "UseStandardization", true)
      ),

      stdDev: String(
        cell_(row, index, "StdDev", "POPULATION") || "POPULATION"
      ).toUpperCase(),

      standardizationScope: String(
        cell_(
          row,
          index,
          "StandardizationScope",
          round === 12 ? "GROUP" : "ROUND"
        ) || (
          round === 12 ? "GROUP" : "ROUND"
        )
      ).toUpperCase(),

      rankingScope: String(
        cell_(
          row,
          index,
          "RankingScope",
          round === 12 ? "GROUP" : "ROUND"
        ) || (
          round === 12 ? "GROUP" : "ROUND"
        )
      ).toUpperCase(),

      trimHighest: clamp_(
        Number(
          cell_(row, index, "TrimHighest", 0)
        ),
        0,
        judgeCount - 1
      ),

      trimLowest: clamp_(
        Number(
          cell_(row, index, "TrimLowest", 0)
        ),
        0,
        judgeCount - 1
      ),

      aggregation: String(
        cell_(row, index, "Aggregation", "SUM") || "SUM"
      ).toUpperCase(),

      allTimeRankSource: String(
        cell_(row, index, "AllTimeRankSource", "OVERALL") || "OVERALL"
      ).toUpperCase(),

      enableSubcategories: normalizeBoolean_(
        cell_(row, index, "EnableSubcategories", round === 12)
      ),

      subcategoryAggregation: String(
        cell_(row, index, "SubcategoryAggregation", "AVERAGE") || "AVERAGE"
      ).toUpperCase(),

      subcategories:
        round === 12
          ? [
              { key: "hitsound", label: "Hitsound", columnSuffix: "Hitsound" },
              { key: "playability", label: "Playability", columnSuffix: "Playability" },
              { key: "concept", label: "Concept", columnSuffix: "Concept" }
            ]
          : [],

      basicMax: basicMax,
      technicalMax: technicalMax,
      creativityMax: creativityMax,
      impressionMax: impressionMax,

      rawMax:
        scoreInputMode === "BONUS_PENALTY"
          ? baseScore + 75
          : (
              basicMax +
              technicalMax +
              creativityMax +
              impressionMax
            ),

      judges: judges,

      notes: String(
        cell_(row, index, "Notes", "") || ""
      )
    };

    /* Round 12 original-workbook rules are authoritative. */
    if (round === 12) {
      rules[String(round)].useStandardization = true;
      rules[String(round)].stdDev = "POPULATION";
      rules[String(round)].standardizationScope = "GROUP";
      rules[String(round)].rankingScope = "GROUP";
      rules[String(round)].trimHighest = 1;
      rules[String(round)].trimLowest = 1;
      rules[String(round)].aggregation = "SUM";
      rules[String(round)].allTimeRankSource = "GROUP";
      rules[String(round)].enableSubcategories = true;
      rules[String(round)].subcategoryAggregation =
        "RANK_BONUS_10_5_2";
    }
  });

  if (!rules[String(CURRENT_ROUND)]) {
    rules[String(CURRENT_ROUND)] =
      defaultRound14Rule_(config);
  }

  return rules;
}

function defaultRound14Rule_(config) {
  return {
    round: 14,
    label: "14회",
    enabled: true,
    judgeCount: 7,
    scoreInputMode: "CRITERIA",
    baseScore: 0,
    useStandardization: true,
    stdDev: "POPULATION",
    standardizationScope: "ROUND",
    rankingScope: "ROUND",
    trimHighest: 1,
    trimLowest: 1,
    aggregation: "SUM",
    allTimeRankSource: "OVERALL",
    enableSubcategories: false,
    subcategoryAggregation: "AVERAGE",
    subcategories: [],
    basicMax: 20,
    technicalMax: 30,
    creativityMax: 25,
    impressionMax: 25,
    rawMax: 100,
    judges: config.judges.slice(0, 7),
    notes: "14회 현재 공식"
  };
}

function serializeRounds_(rules) {
  return Object.keys(rules)
    .map(function(key) {
      const r = rules[key];

      return {
        round: r.round,
        label: r.label,
        enabled: r.enabled,
        judgeCount: r.judgeCount,
        scoreInputMode: r.scoreInputMode,
        baseScore: r.baseScore,
        useStandardization: r.useStandardization,
        stdDev: r.stdDev,
        standardizationScope: r.standardizationScope,
        rankingScope: r.rankingScope,
        trimHighest: r.trimHighest,
        trimLowest: r.trimLowest,
        aggregation: r.aggregation,
        allTimeRankSource: r.allTimeRankSource,
        enableSubcategories: r.enableSubcategories,
        subcategoryAggregation: r.subcategoryAggregation,
        subcategories: r.subcategories,
        basicMax: r.basicMax,
        technicalMax: r.technicalMax,
        creativityMax: r.creativityMax,
        impressionMax: r.impressionMax,
        rawMax: r.rawMax,
        judges: r.judges,
        notes: r.notes
      };
    })
    .sort(function(a, b) {
      return Number(b.round) - Number(a.round);
    });
}

function readConfig_(ss) {
  const sheet = ss.getSheetByName(CONFIG_SHEET);

  if (!sheet) {
    throw new Error('"Config" 시트가 없습니다.');
  }

  const values = sheet.getDataRange().getValues();
  const map = {};

  values.slice(1).forEach(function(row) {
    const key = String(row[0] || "").trim();

    if (key) {
      map[key] = row[1];
    }
  });

  const judges = [];

  for (let i = 1; i <= MAX_JUDGES; i++) {
    judges.push(
      String(
        map["Judge" + i] || ("Judge " + i)
      ).trim()
    );
  }

  return {
    eventTitle: String(
      map.EventTitle || "Judging Results"
    ),

    eventSubtitle: String(
      map.EventSubtitle || "Official judging results"
    ),

    scorePrecision: clamp_(
      Number(map.ScorePrecision || 3),
      0,
      6
    ),

    judges: judges
  };
}

function buildMeta_(config) {
  return {
    apiVersion: 8.5,
    eventTitle: config.eventTitle,
    eventSubtitle: config.eventSubtitle,
    scorePrecision: config.scorePrecision,
    generatedAt: new Date().toISOString()
  };
}

/**
 * 기존 14회 데이터를 삭제하지 않고 multi-round 구조로 마이그레이션합니다.
 * 한 번만 실행하면 됩니다.
 */
function migrateToMultiRound() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const scoreSheet = ss.getSheetByName(SCORE_SHEET);

  if (!scoreSheet) {
    throw new Error('"Scores" 시트가 없습니다.');
  }

  let headers = getHeaders_(scoreSheet);

  if (headers.indexOf("Round") === -1) {
    scoreSheet.insertColumnBefore(1);
    scoreSheet.getRange(1, 1).setValue("Round");

    const lastRow = scoreSheet.getLastRow();

    if (lastRow >= 2) {
      const values = [];

      for (let i = 0; i < lastRow - 1; i++) {
        values.push([CURRENT_ROUND]);
      }

      scoreSheet
        .getRange(2, 1, values.length, 1)
        .setValues(values);
    }
  }

  headers = getHeaders_(scoreSheet);

  if (headers.indexOf("ParticipantID") === -1) {
    const roundIndex = headers.indexOf("Round");

    scoreSheet.insertColumnAfter(roundIndex + 1);

    scoreSheet
      .getRange(1, roundIndex + 2)
      .setValue("ParticipantID");
  }

  headers = getHeaders_(scoreSheet);

  if (headers.indexOf("FinalScoreOverride") === -1) {
    scoreSheet
      .getRange(1, scoreSheet.getLastColumn() + 1)
      .setValue("FinalScoreOverride");
  }

  fillParticipantIds_(scoreSheet);
  createRoundsSheetIfMissing_(ss);
  upgradeRound13Schema();
  upgradeRound12Subcategories();
  upgradeRound12ScoringScope();
}

function getHeaders_(sheet) {
  return sheet
    .getRange(
      1,
      1,
      1,
      sheet.getLastColumn()
    )
    .getValues()[0]
    .map(String);
}

function fillParticipantIds_(sheet) {
  const headers = getHeaders_(sheet);

  const idCol =
    headers.indexOf("ParticipantID") + 1;

  const usernameCol =
    headers.indexOf("Username") + 1;

  if (idCol <= 0 || usernameCol <= 0) {
    return;
  }

  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return;
  }

  const ids = sheet
    .getRange(2, idCol, lastRow - 1, 1)
    .getValues();

  const usernames = sheet
    .getRange(2, usernameCol, lastRow - 1, 1)
    .getValues();

  for (let i = 0; i < ids.length; i++) {
    if (!String(ids[i][0] || "").trim()) {
      ids[i][0] =
        String(usernames[i][0] || "").trim();
    }
  }

  sheet
    .getRange(2, idCol, ids.length, 1)
    .setValues(ids);
}

function createRoundsSheetIfMissing_(ss) {
  if (ss.getSheetByName(ROUNDS_SHEET)) {
    return;
  }

  const config = readConfig_(ss);
  const sheet = ss.insertSheet(ROUNDS_SHEET);

  const headers = [
    "Round",
    "Label",
    "Enabled",
    "JudgeCount",
    "ScoreInputMode",
    "BaseScore",
    "UseStandardization",
    "StdDev",
    "StandardizationScope",
    "RankingScope",
    "TrimHighest",
    "TrimLowest",
    "Aggregation",
    "AllTimeRankSource",
    "EnableSubcategories",
    "SubcategoryAggregation",
    "BasicMax",
    "TechnicalMax",
    "CreativityMax",
    "ImpressionMax",
    "Judge1",
    "Judge2",
    "Judge3",
    "Judge4",
    "Judge5",
    "Judge6",
    "Judge7",
    "Notes"
  ];

  sheet
    .getRange(1, 1, 1, headers.length)
    .setValues([headers]);

  sheet.setFrozenRows(1);

  const rows = [];

  for (let round = 1; round <= 14; round++) {
    const enabled = round === CURRENT_ROUND;

    rows.push([
      round,
      round + "회",
      enabled,
      7,
      round === 13
        ? "BONUS_PENALTY"
        : "CRITERIA",
      round === 13
        ? 75
        : 0,
      true,
      "POPULATION",
      round === 12 ? "GROUP" : "ROUND",
      round === 12 ? "GROUP" : "ROUND",
      round === CURRENT_ROUND ? 1 : 0,
      round === CURRENT_ROUND ? 1 : 0,
      "SUM",
      "OVERALL",
      round === 12,
      "AVERAGE",
      20,
      30,
      25,
      25,
      config.judges[0],
      config.judges[1],
      config.judges[2],
      config.judges[3],
      config.judges[4],
      config.judges[5],
      config.judges[6],
      round === CURRENT_ROUND
        ? "14회 현재 공식"
        : "실제 공식을 입력한 뒤 Enabled를 TRUE로 변경"
    ]);
  }

  sheet
    .getRange(2, 1, rows.length, headers.length)
    .setValues(rows);

  sheet
    .getRange(2, 3, rows.length, 1)
    .insertCheckboxes();

  sheet
    .getRange(2, 7, rows.length, 1)
    .insertCheckboxes();

  sheet.autoResizeColumns(1, headers.length);
}

function upgradeRound12ScoringScope() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  createRoundsSheetIfMissing_(ss);

  const sheet = ss.getSheetByName(ROUNDS_SHEET);

  ensureSheetColumn_(
    sheet,
    "StandardizationScope"
  );

  ensureSheetColumn_(
    sheet,
    "RankingScope"
  );

  const headers = getHeaders_(sheet);
  const index = {};

  headers.forEach(function(h, i) {
    index[h] = i + 1;
  });

  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    return;
  }

  const rounds = sheet
    .getRange(
      2,
      index.Round,
      lastRow - 1,
      1
    )
    .getValues();

  for (let i = 0; i < rounds.length; i++) {
    const round = Number(rounds[i][0]);

    if (!Number.isFinite(round)) {
      continue;
    }

    const sheetRow = i + 2;
    const scope =
      round === 12
        ? "GROUP"
        : "ROUND";

    sheet
      .getRange(
        sheetRow,
        index.StandardizationScope
      )
      .setValue(scope);

    sheet
      .getRange(
        sheetRow,
        index.RankingScope
      )
      .setValue(scope);

    /*
     * 12회 실제 결과는 각 그룹에서 Rank가 1부터 다시 시작한다.
     * All-Time 기록도 12회는 Group Rank를 사용한다.
     */
    if (
      round === 12 &&
      index.AllTimeRankSource
    ) {
      sheet
        .getRange(
          sheetRow,
          index.AllTimeRankSource
        )
        .setValue("GROUP");
    }
  }
}

function upgradeRound12Subcategories() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const scoreSheet = ss.getSheetByName(SCORE_SHEET);

  if (!scoreSheet) {
    throw new Error('"Scores" 시트가 없습니다.');
  }

  for (let j = 1; j <= MAX_JUDGES; j++) {
    ensureSheetColumn_(scoreSheet, "J" + j + "_Hitsound");
    ensureSheetColumn_(scoreSheet, "J" + j + "_Playability");
    ensureSheetColumn_(scoreSheet, "J" + j + "_Concept");
  }

  createRoundsSheetIfMissing_(ss);

  const roundsSheet = ss.getSheetByName(ROUNDS_SHEET);
  ensureSheetColumn_(roundsSheet, "EnableSubcategories");
  ensureSheetColumn_(roundsSheet, "SubcategoryAggregation");

  const headers = getHeaders_(roundsSheet);
  const index = {};

  headers.forEach(function(h, i) {
    index[h] = i + 1;
  });

  const lastRow = roundsSheet.getLastRow();
  if (lastRow < 2) return;

  const roundValues = roundsSheet
    .getRange(2, index.Round, lastRow - 1, 1)
    .getValues();

  for (let i = 0; i < roundValues.length; i++) {
    const round = Number(roundValues[i][0]);
    const sheetRow = i + 2;

    if (!Number.isFinite(round)) continue;

    roundsSheet
      .getRange(sheetRow, index.EnableSubcategories)
      .setValue(round === 12);

    if (round === 12) {
      roundsSheet
        .getRange(sheetRow, index.SubcategoryAggregation)
        .setValue("RANK_BONUS_10_5_2");
    }
  }

  roundsSheet
    .getRange(2, index.EnableSubcategories, lastRow - 1, 1)
    .insertCheckboxes();
}

function upgradeToV811Complete() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);

  try {
    const scoreSheet = ss.getSheetByName(SCORE_SHEET);
    if (!scoreSheet) {
      throw new Error('"Scores" sheet was not found.');
    }

    for (let j = 1; j <= MAX_JUDGES; j++) {
      ensureSheetColumn_(scoreSheet, "J" + j + "_Hitsound");
      ensureSheetColumn_(scoreSheet, "J" + j + "_Playability");
      ensureSheetColumn_(scoreSheet, "J" + j + "_Concept");
    }

    createRoundsSheetIfMissing_(ss);
    const roundsSheet = ss.getSheetByName(ROUNDS_SHEET);
    [
      "StandardizationScope",
      "RankingScope",
      "AllTimeRankSource",
      "EnableSubcategories",
      "SubcategoryAggregation"
    ].forEach(function(header) {
      ensureSheetColumn_(roundsSheet, header);
    });

    const headers = getHeaders_(roundsSheet);
    const index = {};
    headers.forEach(function(h, i) { index[h] = i + 1; });
    const lastRow = roundsSheet.getLastRow();
    let round12Row = 0;

    if (lastRow >= 2) {
      const values = roundsSheet
        .getRange(2, index.Round, lastRow - 1, 1)
        .getValues();
      values.forEach(function(row, i) {
        if (Number(row[0]) === 12) round12Row = i + 2;
      });
    }

    if (!round12Row) {
      throw new Error("Rounds sheet does not contain a Round 12 row.");
    }

    if (lastRow >= 2 && index.AllTimeRankSource) {
      roundsSheet
        .getRange(2, index.AllTimeRankSource, lastRow - 1, 1)
        .setValue("GROUP");
    }

    const updates = {
      UseStandardization: true,
      StdDev: "POPULATION",
      TrimHighest: 1,
      TrimLowest: 1,
      Aggregation: "SUM",
      AllTimeRankSource: "GROUP",
      StandardizationScope: "GROUP",
      RankingScope: "GROUP",
      EnableSubcategories: true,
      SubcategoryAggregation: "RANK_BONUS_10_5_2"
    };

    Object.keys(updates).forEach(function(header) {
      if (index[header]) {
        roundsSheet.getRange(round12Row, index[header]).setValue(updates[header]);
      }
    });

    PropertiesService.getDocumentProperties()
      .setProperty("JUDGING_RESULTS_VERSION", "8.11");

    return "v8.11 complete upgrade applied. All-Time now uses group ranks.";
  } finally {
    lock.releaseLock();
  }
}

/* Backward-compatible alias for users who already selected the v8.6 name. */
function upgradeToV86Complete() {
  return upgradeToV811Complete();
}

function upgradeToV89Complete() {
  return upgradeToV811Complete();
}

function upgradeToV810Complete() {
  return upgradeToV811Complete();
}

function upgradeRound13Schema() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const scoreSheet = ss.getSheetByName(SCORE_SHEET);

  if (!scoreSheet) {
    throw new Error('"Scores" 시트가 없습니다.');
  }

  // 13회 전용 Judge 입력 컬럼
  for (let j = 1; j <= MAX_JUDGES; j++) {
    ensureSheetColumn_(
      scoreSheet,
      "J" + j + "_Bonus"
    );

    ensureSheetColumn_(
      scoreSheet,
      "J" + j + "_Penalty"
    );

    ensureSheetColumn_(
      scoreSheet,
      "J" + j + "_Raw"
    );
  }

  createRoundsSheetIfMissing_(ss);

  const roundsSheet =
    ss.getSheetByName(ROUNDS_SHEET);

  ensureSheetColumn_(
    roundsSheet,
    "ScoreInputMode"
  );

  ensureSheetColumn_(
    roundsSheet,
    "BaseScore"
  );

  const headers = getHeaders_(roundsSheet);
  const index = {};

  headers.forEach(function(h, i) {
    index[h] = i + 1;
  });

  const lastRow = roundsSheet.getLastRow();

  if (lastRow >= 2) {
    const roundValues = roundsSheet
      .getRange(
        2,
        index.Round,
        lastRow - 1,
        1
      )
      .getValues();

    for (let i = 0; i < roundValues.length; i++) {
      const round = Number(roundValues[i][0]);
      const sheetRow = i + 2;

      if (!Number.isFinite(round)) {
        continue;
      }

      const mode =
        round === 13
          ? "BONUS_PENALTY"
          : "CRITERIA";

      roundsSheet
        .getRange(
          sheetRow,
          index.ScoreInputMode
        )
        .setValue(mode);

      roundsSheet
        .getRange(
          sheetRow,
          index.BaseScore
        )
        .setValue(
          round === 13
            ? 75
            : 0
        );
    }
  }
}

function ensureSheetColumn_(sheet, headerName) {
  const headers = getHeaders_(sheet);

  if (headers.indexOf(headerName) !== -1) {
    return;
  }

  sheet
    .getRange(
      1,
      sheet.getLastColumn() + 1
    )
    .setValue(headerName);
}

function validateBaseHeaders_(headers) {
  const required = [
    "Group",
    "No",
    "Username",
    "Track",
    "Published"
  ];

  const missing =
    required.filter(function(h) {
      return headers.indexOf(h) === -1;
    });

  if (missing.length) {
    throw new Error(
      "Scores 시트 필수 컬럼 누락: " +
      missing.join(", ")
    );
  }
}

function cell_(row, index, name, defaultValue) {
  if (index[name] === undefined) {
    return defaultValue;
  }

  const value = row[index[name]];

  return (
    value === undefined ||
    value === null
  )
    ? defaultValue
    : value;
}

function readScore_(value, max, rowNumber, columnName) {
  if (max === 0) {
    return 0;
  }

  if (value === "" || value === null) {
    throw new Error(
      "Scores 시트 " +
      rowNumber +
      "행: " +
      columnName +
      " 값이 비어 있습니다."
    );
  }

  const n = Number(value);

  /*
   * 기존 v7 데이터 호환:
   * 기준별 Max 값은 화면 표시/설정값으로 사용하되,
   * 기존 데이터가 Max를 초과했다는 이유만으로 전체 API 로딩을 중단하지 않는다.
   * 숫자가 아닌 값만 오류 처리한다.
   */
  if (!Number.isFinite(n)) {
    throw new Error(
      "Scores 시트 " +
      rowNumber +
      "행: " +
      columnName +
      " 값은 숫자여야 합니다."
    );
  }

  return n;
}

function numberOrNull_(value) {
  if (
    value === "" ||
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

function normalizeBoolean_(value) {
  if (value === true) return true;
  if (value === false) return false;

  const s =
    String(value || "")
      .trim()
      .toLowerCase();

  return [
    "true",
    "1",
    "yes",
    "y",
    "공개",
    "publish",
    "published"
  ].indexOf(s) !== -1;
}

function average_(arr) {
  if (!arr.length) {
    return 0;
  }

  return arr.reduce(
    function(a, b) {
      return a + b;
    },
    0
  ) / arr.length;
}

function populationStdDev_(arr, mean) {
  if (!arr.length) {
    return 0;
  }

  const variance =
    arr.reduce(
      function(sum, x) {
        return (
          sum +
          Math.pow(
            x - mean,
            2
          )
        );
      },
      0
    ) / arr.length;

  return Math.sqrt(variance);
}

function sampleStdDev_(arr, mean) {
  if (arr.length <= 1) {
    return 0;
  }

  const variance =
    arr.reduce(
      function(sum, x) {
        return (
          sum +
          Math.pow(
            x - mean,
            2
          )
        );
      },
      0
    ) / (arr.length - 1);

  return Math.sqrt(variance);
}

function round_(value, digits) {
  const p = Math.pow(10, digits);

  return Math.round(
    (value + Number.EPSILON) * p
  ) / p;
}

function clamp_(n, min, max) {
  if (!Number.isFinite(n)) {
    return min;
  }

  return Math.min(
    max,
    Math.max(min, n)
  );
}

function respond_(payload, e) {
  const json = JSON.stringify(payload);

  const callback =
    e && e.parameter
      ? e.parameter.callback
      : "";

  if (callback) {
    if (
      !/^[A-Za-z_$][0-9A-Za-z_$\.]*$/
        .test(callback)
    ) {
      return ContentService
        .createTextOutput(
          JSON.stringify({
            ok: false,
            error: "Invalid callback"
          })
        )
        .setMimeType(
          ContentService.MimeType.JSON
        );
    }

    return ContentService
      .createTextOutput(
        callback +
        "(" +
        json +
        ");"
      )
      .setMimeType(
        ContentService.MimeType.JAVASCRIPT
      );
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(
      ContentService.MimeType.JSON
    );
}
