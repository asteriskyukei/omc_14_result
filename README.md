# Judging Results v8 — Multi-Round

## 구현 기능

- ROUND 필터: All-Time / 14회 / 13회 / ... / 1회
- 회차별 Group 필터
- 회차별 Judge 랭킹
- 회차마다 다른 점수 계산 공식
- 회차별 Judge 수 / Judge 이름 설정
- 회차별 심사기준 배점 설정
- 표준화 ON/OFF
- POPULATION / SAMPLE 표준편차
- 최고점 / 최저점 제외 개수
- SUM / AVERAGE 집계
- 과거 회차용 FinalScoreOverride
- 전회차 All-Time 랭킹
- All-Time 참가자별 Round History Modal

# 기존 14회 데이터 보존하면서 전환

Apps Script에서 v8 `Code.gs`로 교체한 뒤:

```text
migrateToMultiRound()
```

를 **1회만 실행**합니다.

`setupSheets()`는 실행하지 마세요.

## migrateToMultiRound()가 하는 작업

기존 Scores 행은 삭제하지 않습니다.

Scores에 다음 컬럼을 추가합니다.

```text
Round
ParticipantID
FinalScoreOverride
```

기존 행은 모두:

```text
Round = 14
```

로 설정합니다.

기존 참가자의 `ParticipantID`는 우선 Username으로 채웁니다.

또한 `Rounds` 시트를 생성합니다.

```text
14회    Enabled = TRUE
1~13회  Enabled = FALSE
```

# ParticipantID

같은 사람의 전회차 기록을 묶는 고정 ID입니다.

예:

```text
3회   ParticipantID=user001   Username=Alice
8회   ParticipantID=user001   Username=Alice☆
14회  ParticipantID=user001   Username=Alice
```

모두 같은 참가자로 집계됩니다.

# Rounds 시트

주요 컬럼:

```text
Round
Label
Enabled
JudgeCount
UseStandardization
StdDev
TrimHighest
TrimLowest
Aggregation
AllTimeRankSource
BasicMax
TechnicalMax
CreativityMax
ImpressionMax
Judge1 ~ Judge7
Notes
```

## 14회 현재 공식

```text
JudgeCount = 7
UseStandardization = TRUE
StdDev = POPULATION
TrimHighest = 1
TrimLowest = 1
Aggregation = SUM
BasicMax = 20
TechnicalMax = 30
CreativityMax = 25
ImpressionMax = 25
```

## 예: 표준화 없이 원점수 평균

```text
UseStandardization = FALSE
TrimHighest = 0
TrimLowest = 0
Aggregation = AVERAGE
```

## 예: Z-Score 적용, 최고/최저 제외 없음

```text
UseStandardization = TRUE
StdDev = POPULATION
TrimHighest = 0
TrimLowest = 0
Aggregation = SUM
```

# AllTimeRankSource

회차별 All-Time 기록에서 어떤 Rank를 승수로 셀지 지정합니다.

```text
OVERALL
```

해당 회차 전체 순위를 사용합니다.

```text
GROUP
```

Master / Novice 등 각 그룹 내부 순위를 사용합니다.

# All-Time 순위

우선순위:

```text
1. Wins
2. 2nd
3. 3rd
4. Podiums
5. Average Rank
6. Appearances
```

즉 1위를 가장 많이 한 사람이 가장 높습니다.

# 과거 회차 상세점수가 없는 경우

`FinalScoreOverride`를 입력할 수 있습니다.

예:

```text
Round = 4
ParticipantID = user001
Username = Alice
FinalScoreOverride = 91.25
```

해당 값이 있으면 공식 계산 결과 대신 FinalScoreOverride를 사용합니다.

Judge 세부점수가 비어 있어도 FinalScoreOverride가 있으면
회차 최종 순위와 All-Time 집계는 동작합니다.

# 과거 회차 공개 순서

1. Scores에 참가자 행 추가
2. Round 입력
3. 동일 참가자의 ParticipantID 통일
4. Rounds 시트에서 해당 회차 실제 공식 설정
5. 해당 회차 Enabled 체크
6. Apps Script 새 버전으로 재배포

# 배포

## Apps Script

1. v8 `apps-script/Code.gs`로 교체
2. `migrateToMultiRound()` 1회 실행
3. `배포 → 배포 관리 → 수정 → 새 버전 → 배포`

## GitHub Pages

저장소 루트의 다음 3개 파일을 교체합니다.

```text
index.html
styles.css
app.js
```

`app.js`에는 현재 `/exec` URL이 이미 입력되어 있습니다.


# 13회 전용 점수 형식

13회만 기존 `Basic / Technical / Creativity / Impression` 방식이 아니라 다음 형식을 사용합니다.

```text
Base Score = 75 고정
Plus       = 0~75
Minus      = 감점
Raw        = 확정 Judge Raw Score
```

Scores에는 Judge별로 다음 컬럼을 사용합니다.

```text
J1_Bonus
J1_Penalty
J1_Raw

J2_Bonus
J2_Penalty
J2_Raw

...

J7_Bonus
J7_Penalty
J7_Raw
```

예:

```text
Base = 75
Bonus = 32
Penalty = 8
Raw = 99
```

Raw는 저장된 값을 기준으로 사용합니다.

즉 코드가 `75 + 32 - 8 = 99`로 검산할 수는 있지만,
순위 계산에서 사용되는 Judge 원점수는 `Jx_Raw`입니다.

Penalty는 아래 두 입력을 모두 허용합니다.

```text
8
-8
```

둘 다 감점 8점으로 취급합니다.

## 13회 전용 설정

Rounds 시트의 13회 행:

```text
ScoreInputMode = BONUS_PENALTY
BaseScore = 75
```

다른 회차:

```text
ScoreInputMode = CRITERIA
BaseScore = 0
```

13회에서 여러 심사위원 Raw를 최종적으로 합산하는 방식은 기존 Rounds 설정을 그대로 사용합니다.

```text
UseStandardization
StdDev
TrimHighest
TrimLowest
Aggregation
```

따라서 13회의 실제 최종 집계 규칙에 맞춰 이 값들만 설정하면 됩니다.

## 이미 v8 migrateToMultiRound()를 실행했다면

Apps Script의 v8.1 `Code.gs`로 교체한 뒤 아래 함수만 1회 실행합니다.

```text
upgradeRound13Schema()
```

이 함수는 기존 점수를 삭제하지 않고 다음 컬럼만 추가합니다.

```text
J1_Bonus / J1_Penalty / J1_Raw
...
J7_Bonus / J7_Penalty / J7_Raw

Rounds.ScoreInputMode
Rounds.BaseScore
```

그리고 13회는 자동으로:

```text
ScoreInputMode = BONUS_PENALTY
BaseScore = 75
```

로 설정됩니다.

아직 v8 마이그레이션 자체를 하지 않았다면 `migrateToMultiRound()`를 실행하면
13회 Schema 업그레이드까지 같이 수행됩니다.


# v8.2 기존 데이터 호환 수정

기존 v7 데이터와의 호환성을 위해 다음 기준별 점수는
`BasicMax / TechnicalMax / CreativityMax / ImpressionMax`를 초과하더라도
API 전체를 중단하지 않습니다.

```text
Jx_Basic
Jx_Technical
Jx_Creativity
Jx_Impression
```

숫자가 아닌 값과 빈 값은 계속 오류로 처리합니다.

13회 전용 `Jx_Bonus`는 심사 기준에 따라 계속 `0~75`를 강제합니다.
`Jx_Penalty`와 `Jx_Raw`는 숫자 여부를 검사합니다.


# v8.3 — Z-Score 모집단 수정

이전 v8.x에서는 `Master / Novice`를 먼저 나눈 뒤 각 그룹 안에서
Judge별 평균과 표준편차를 계산했습니다.

실제 결과 시트 방식에 맞춰 v8.3부터는:

```text
Round 전체 참가자
→ Judge별 Mean / Standard Deviation
→ Judge별 Z-Score
→ 참가자별 Highest / Lowest 제거
→ Final Score
```

순서로 계산합니다.

그룹은 Z-Score 계산에 사용하지 않습니다.

```text
Overall Rank = 전체 참가자의 Final Score 순위
Group Rank   = 동일 Final Score를 해당 Group 안에서 다시 순위화
```

따라서 `Master #`, `Novice #`는 점수 계산 방식이 아니라
전체 결과에서 파생된 그룹별 보조 순위입니다.


# v8.5 — 12회 실제 점수 계산 방식 수정

12회 실제 결과 시트를 기준으로 확인된 계산 방식:

```text
StandardizationScope = GROUP
RankingScope = GROUP
StdDev = POPULATION
```

즉:

```text
Generic 참가자끼리
→ Judge별 Mean / STDEV.P
→ Z-Score
→ Highest / Lowest 제거
→ Final Score
→ Generic Rank

Tech 참가자끼리
→ Judge별 Mean / STDEV.P
→ Z-Score
→ Highest / Lowest 제거
→ Final Score
→ Tech Rank
```

12회에서는 Group이 다른 참가자를 하나의 Z-Score 모집단으로 섞지 않습니다.

실제 시트 검산 예:

```text
첫 번째 그룹 Judge 1
Raw 93 → Z ≈ 1.399
Raw 90 → Z ≈ 1.176
```

그룹 13명의 Mean ≈ 74.154,
Population StdDev ≈ 13.473를 사용하면 실제 시트와 일치합니다.

두 번째 그룹도 동일하게 각 그룹 내부의 STDEV.P를 사용합니다.

## Rounds 신규 설정

```text
StandardizationScope
RankingScope
```

가능 값:

```text
ROUND
GROUP
```

v8.5 업그레이드 후 12회는 자동으로:

```text
StandardizationScope = GROUP
RankingScope = GROUP
AllTimeRankSource = GROUP
```

13/14회 및 다른 회차 기본값은:

```text
StandardizationScope = ROUND
RankingScope = ROUND
```

## 기존 v8.4 사용 중

새 Code.gs로 교체 후:

```text
upgradeRound12ScoringScope()
```

를 1회 실행하고 웹 앱을 새 버전으로 재배포합니다.
