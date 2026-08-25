const CONFIG_SHEET = "Config";
const SCORE_SHEET = "Scores";
const JUDGE_COUNT = 7;

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
  const sheet = ss.getSheetByName(SCORE_SHEET);
  if (!sheet) throw new Error('"Scores" 시트가 없습니다. setupSheets()를 먼저 실행하세요.');

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return { meta: buildMeta_(config), participants: [] };

  const headers = values[0].map(String);
  validateHeaders_(headers);
  const index = {};
  headers.forEach((h, i) => index[h] = i);

  let participants = values.slice(1)
    .filter(row => row.some(v => v !== ""))
    .filter(row => normalizeBoolean_(row[index.Published]))
    .map((row, i) => parseParticipant_(row, index, config.judges, i + 2));

  const groups = {};
  participants.forEach(function(p) {
    const key = p.group || "__ALL__";
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(p);
  });

  Object.values(groups).forEach(list => {
    calculateStandardScores_(list, config.judges);
    rank_(list, "groupRank");
  });

  rank_(participants, "overallRank");

  participants = participants.map(p => ({
    group: p.group,
    no: p.no,
    username: p.username,
    track: p.track,
    finalScore: round_(p.finalScore, 8),
    groupRank: p.groupRank,
    overallRank: p.overallRank,
    categoryAverages: {
      basic: round_(average_(p.judges.map(j => j.basic)), 4),
      technical: round_(average_(p.judges.map(j => j.technical)), 4),
      creativity: round_(average_(p.judges.map(j => j.creativity)), 4),
      impression: round_(average_(p.judges.map(j => j.impression)), 4)
    },
    judges: p.judges.map(j => ({
      name: j.name,
      rawScore: j.rawScore,
      zScore: round_(j.zScore, 8),
      comment: j.comment,
      excluded: Boolean(j.excluded),
      excludedReason: j.excludedReason || ""
    }))
  }));

  return { meta: buildMeta_(config), participants };
}

function calculateStandardScores_(participants) {
  for (let judgeIndex = 0; judgeIndex < JUDGE_COUNT; judgeIndex++) {
    const rawScores = participants.map(p => p.judges[judgeIndex].rawScore);
    const mean = average_(rawScores);
    const sd = populationStdDev_(rawScores, mean);

    participants.forEach(p => {
      const raw = p.judges[judgeIndex].rawScore;
      p.judges[judgeIndex].zScore = sd === 0 ? 0 : (raw - mean) / sd;
    });
  }

  participants.forEach(p => {
    // 7명의 표준화 점수 중 최고점 1개와 최저점 1개를 제외하고
    // 나머지 5명의 표준화 점수만 최종점수에 반영합니다.
    const scored = p.judges.map((j, index) => ({
      index: index,
      zScore: j.zScore
    }));

    let minIndex = 0;
    let maxIndex = 0;

    for (let i = 1; i < scored.length; i++) {
      if (scored[i].zScore < scored[minIndex].zScore) minIndex = i;
      if (scored[i].zScore > scored[maxIndex].zScore) maxIndex = i;
    }

    // 모든 값이 동일한 경우에도 서로 다른 두 심사위원을 1명씩 제외합니다.
    if (minIndex === maxIndex && scored.length > 1) {
      maxIndex = minIndex === 0 ? 1 : 0;
    }

    p.judges.forEach((j, index) => {
      j.excluded = index === minIndex || index === maxIndex;
      j.excludedReason =
        index === minIndex ? "lowest" :
        index === maxIndex ? "highest" : "";
    });

    p.finalScore = p.judges
      .filter(j => !j.excluded)
      .reduce((sum, j) => sum + j.zScore, 0);
  });
}

function parseParticipant_(row, index, judges, rowNumber) {
  const p = {
    group: String(row[index.Group] || "").trim(),
    no: String(row[index.No] || "").trim(),
    username: String(row[index.Username] || "").trim(),
    track: String(row[index.Track] || "").trim(),
    judges: []
  };

  if (!p.username) throw new Error("Scores 시트 " + rowNumber + "행: Username이 비어 있습니다.");

  for (let j = 1; j <= JUDGE_COUNT; j++) {
    const judge = {
      name: judges[j - 1],
      basic: readScore_(row[index["J" + j + "_Basic"]], 20, rowNumber, "J" + j + "_Basic"),
      technical: readScore_(row[index["J" + j + "_Technical"]], 30, rowNumber, "J" + j + "_Technical"),
      creativity: readScore_(row[index["J" + j + "_Creativity"]], 25, rowNumber, "J" + j + "_Creativity"),
      impression: readScore_(row[index["J" + j + "_Impression"]], 25, rowNumber, "J" + j + "_Impression"),
      comment: String(row[index["J" + j + "_Comment"]] || "").trim(),
      zScore: 0
    };
    judge.rawScore = judge.basic + judge.technical + judge.creativity + judge.impression;
    p.judges.push(judge);
  }
  return p;
}

function readConfig_(ss) {
  const sheet = ss.getSheetByName(CONFIG_SHEET);
  if (!sheet) throw new Error('"Config" 시트가 없습니다. setupSheets()를 먼저 실행하세요.');

  const values = sheet.getDataRange().getValues();
  const map = {};
  values.slice(1).forEach(row => {
    const key = String(row[0] || "").trim();
    if (key) map[key] = row[1];
  });

  const judges = [];
  for (let i = 1; i <= JUDGE_COUNT; i++) {
    judges.push(String(map["Judge" + i] || ("Judge " + i)).trim());
  }

  return {
    eventTitle: String(map.EventTitle || "Judging Results"),
    eventSubtitle: String(map.EventSubtitle || "Official judging results"),
    scorePrecision: clamp_(Number(map.ScorePrecision || 3), 0, 6),
    judges
  };
}

function buildMeta_(config) {
  return {
    eventTitle: config.eventTitle,
    eventSubtitle: config.eventSubtitle,
    scorePrecision: config.scorePrecision,
    judges: config.judges,
    criteria: [
      { name: "Basic Skill", max: 20 },
      { name: "Technical Skill", max: 30 },
      { name: "Creativity", max: 25 },
      { name: "Judge's impression", max: 25 }
    ],
    finalScoreMethod: "sum_of_middle_5_of_7_judge_z_scores",
    standardDeviation: "population",
    generatedAt: new Date().toISOString()
  };
}

function validateHeaders_(headers) {
  const required = ["Group", "No", "Username", "Track", "Published"];
  for (let j = 1; j <= JUDGE_COUNT; j++) {
    required.push(
      "J" + j + "_Basic",
      "J" + j + "_Technical",
      "J" + j + "_Creativity",
      "J" + j + "_Impression",
      "J" + j + "_Comment"
    );
  }
  const missing = required.filter(h => !headers.includes(h));
  if (missing.length) throw new Error("Scores 시트 필수 컬럼 누락: " + missing.join(", "));
}

function rank_(participants, property) {
  const sorted = [...participants].sort((a, b) => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
    return String(a.no).localeCompare(String(b.no), undefined, { numeric: true });
  });

  let previousScore = null;
  let previousRank = 0;

  sorted.forEach((p, i) => {
    const same = previousScore !== null && Math.abs(p.finalScore - previousScore) < 1e-12;
    p[property] = same ? previousRank : i + 1;
    previousScore = p.finalScore;
    previousRank = p[property];
  });
}

function respond_(payload, e) {
  const json = JSON.stringify(payload);
  const callback = e && e.parameter ? e.parameter.callback : "";

  if (callback) {
    if (!/^[A-Za-z_$][0-9A-Za-z_$\\.]*$/.test(callback)) {
      return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "Invalid callback" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    return ContentService.createTextOutput(callback + "(" + json + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let config = ss.getSheetByName(CONFIG_SHEET);
  if (!config) config = ss.insertSheet(CONFIG_SHEET);
  config.clear();

  const configRows = [
    ["Key", "Value"],
    ["EventTitle", "Judging Results"],
    ["EventSubtitle", "Official judging results"],
    ["ScorePrecision", 3],
    ["Judge1", "Judge 1"],
    ["Judge2", "Judge 2"],
    ["Judge3", "Judge 3"],
    ["Judge4", "Judge 4"],
    ["Judge5", "Judge 5"],
    ["Judge6", "Judge 6"],
    ["Judge7", "Judge 7"]
  ];
  config.getRange(1, 1, configRows.length, 2).setValues(configRows);
  config.setFrozenRows(1);
  config.autoResizeColumns(1, 2);

  let scores = ss.getSheetByName(SCORE_SHEET);
  if (!scores) scores = ss.insertSheet(SCORE_SHEET);
  scores.clear();

  const headers = ["Group", "No", "Username", "Track", "Published"];
  for (let j = 1; j <= JUDGE_COUNT; j++) {
    headers.push(
      "J" + j + "_Basic",
      "J" + j + "_Technical",
      "J" + j + "_Creativity",
      "J" + j + "_Impression",
      "J" + j + "_Comment"
    );
  }

  scores.getRange(1, 1, 1, headers.length).setValues([headers]);
  scores.setFrozenRows(1);

  const samples = [
    sampleRow_("Master", "01", "Participant A", "Vocal", true, [
      [18,27,22,24,"기본기가 안정적이고 전체 완성도가 높습니다."],
      [17,28,21,23,"기술적인 표현력이 좋았습니다."],
      [19,26,23,22,"창의적인 해석이 인상적입니다."],
      [16,29,22,24,"무대 집중력이 좋습니다."],
      [18,25,24,23,"개성이 분명하게 전달되었습니다."],
      [17,27,23,24,"전반적으로 균형 잡힌 퍼포먼스입니다."],
      [18,28,22,23,"완성도가 높고 강점이 명확합니다."]
    ]),
    sampleRow_("Master", "02", "Participant B", "Instrumental", true, [
      [16,25,20,22,"안정적이지만 조금 더 과감한 표현이 있으면 좋겠습니다."],
      [17,24,22,21,""],
      [15,27,21,20,"기술은 좋으나 전체 흐름을 조금 더 다듬으면 좋겠습니다."],
      [18,23,20,23,""],
      [16,26,21,22,"장점이 명확하게 드러났습니다."],
      [17,25,20,21,""],
      [16,24,21,22,"좋은 퍼포먼스였습니다."]
    ])
  ];
  scores.getRange(2, 1, samples.length, headers.length).setValues(samples);

  const publishedCol = headers.indexOf("Published") + 1;
  scores.getRange(2, publishedCol, Math.max(scores.getMaxRows() - 1, 1), 1).insertCheckboxes();

  for (let j = 1; j <= JUDGE_COUNT; j++) {
    setScoreValidation_(scores, headers, "J" + j + "_Basic", 20);
    setScoreValidation_(scores, headers, "J" + j + "_Technical", 30);
    setScoreValidation_(scores, headers, "J" + j + "_Creativity", 25);
    setScoreValidation_(scores, headers, "J" + j + "_Impression", 25);
  }
}

function sampleRow_(group, no, username, track, published, judgeData) {
  const row = [group, no, username, track, published];
  judgeData.forEach(items => row.push(...items));
  return row;
}

function setScoreValidation_(sheet, headers, header, max) {
  const col = headers.indexOf(header) + 1;
  const rule = SpreadsheetApp.newDataValidation()
    .requireNumberBetween(0, max)
    .setAllowInvalid(false)
    .setHelpText("0~" + max + " 범위의 점수를 입력하세요.")
    .build();
  sheet.getRange(2, col, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);
}

function readScore_(value, max, rowNumber, columnName) {
  if (value === "" || value === null) {
    throw new Error("Scores 시트 " + rowNumber + "행: " + columnName + " 값이 비어 있습니다.");
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > max) {
    throw new Error("Scores 시트 " + rowNumber + "행: " + columnName + " 값은 0~" + max + " 범위의 숫자여야 합니다.");
  }
  return n;
}

function normalizeBoolean_(value) {
  if (value === true) return true;
  if (value === false) return false;
  const s = String(value || "").trim().toLowerCase();
  return ["true","1","yes","y","공개","publish","published"].includes(s);
}

function average_(arr) {
  return arr.length ? arr.reduce((a,b) => a + b, 0) / arr.length : 0;
}

function populationStdDev_(arr, mean) {
  if (!arr.length) return 0;
  const variance = arr.reduce((sum,x) => sum + Math.pow(x - mean, 2), 0) / arr.length;
  return Math.sqrt(variance);
}

function round_(value, digits) {
  const p = Math.pow(10, digits);
  return Math.round((value + Number.EPSILON) * p) / p;
}

function clamp_(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}
