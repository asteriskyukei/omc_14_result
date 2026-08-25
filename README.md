# Judging Results Site v2

변경사항:

- 심사위원 6명 → **7명**
- 참가자별로 각 심사위원의 **Comment** 입력 가능
- 상세 결과 화면에서 심사위원 Raw Score / Z-Score / Comment 표시

## Scores 컬럼 구조

기본 컬럼:

```text
Group
No
Username
Track
Published
```

심사위원 1명당:

```text
J1_Basic
J1_Technical
J1_Creativity
J1_Impression
J1_Comment
```

같은 방식으로 `J7_Comment`까지 생성됩니다.

점수 범위:

- Basic Skill: 0~20
- Technical Skill: 0~30
- Creativity: 0~25
- Judge's impression: 0~25
- Comment: 자유 텍스트

## 계산

```text
Raw Score = Basic + Technical + Creativity + Impression
Judge Z = (Raw Score - Judge 평균) / Judge 모집단 표준편차
Final Score = 7명의 Judge Z 중 최고 1개와 최저 1개를 제외한 나머지 5개 Z의 합

즉:

Final Score = Σ(Z1 ... Z7) - MAX(Z1 ... Z7) - MIN(Z1 ... Z7)
```

`Group`이 존재하면 심사위원 평균과 표준편차는 그룹별로 계산합니다.

## 기존에 setupSheets()를 실행한 경우

중요: 새 버전의 `setupSheets()`를 다시 실행하면 현재 `Config`, `Scores` 시트 내용을 지우고 새 구조로 초기화합니다.

이미 실데이터를 입력했다면 `setupSheets()`를 다시 실행하지 말고 기존 `Scores` 시트에 다음 컬럼을 수동 추가하는 편이 안전합니다.

기존 6명 구조에 대해 각 심사위원 점수 뒤에:

```text
J1_Comment
J2_Comment
...
J6_Comment
```

그리고 7번째 심사위원:

```text
J7_Basic
J7_Technical
J7_Creativity
J7_Impression
J7_Comment
```

`Config` 시트에는:

```text
Judge7 | Judge 7
```

을 추가합니다.

## 새로 구축하는 경우

1. Google Spreadsheet → 확장 프로그램 → Apps Script
2. `apps-script/Code.gs` 내용으로 교체
3. `setupSheets()` 1회 실행
4. Config와 Scores 입력
5. 웹 앱으로 다시 배포
6. 새 `/exec` URL을 `app.js`의 `API_URL`에 입력
7. `index.html`, `styles.css`, `app.js`를 GitHub Pages에 업로드

Apps Script를 이미 배포했다면 코드를 수정한 뒤 **배포 관리 → 수정 → 새 버전**으로 재배포해야 변경사항이 실제 `/exec` URL에 반영됩니다.


## 최고점 / 최저점 제외 규칙

각 참가자마다 7명의 심사위원 표준화점수(Z-Score)를 계산한 뒤:

1. 가장 높은 Z-Score 1개를 제외
2. 가장 낮은 Z-Score 1개를 제외
3. 남은 5개 Z-Score를 합산
4. 이 값을 Final Score로 사용

수식:

```text
Final Score
= Σ(Z1, Z2, Z3, Z4, Z5, Z6, Z7)
  - MAX(Z1, Z2, Z3, Z4, Z5, Z6, Z7)
  - MIN(Z1, Z2, Z3, Z4, Z5, Z6, Z7)
```

최고점 또는 최저점이 동점인 경우에도 각각 **1개씩만 제외**합니다.
상세 결과 화면에서는 최종점수에서 제외된 심사위원 점수가 표시됩니다.


## v3.1 수정

Apps Script에서 `||=` 논리 대입 연산자를 파싱하지 못하는 환경을 고려하여
해당 코드를 일반 `if` 문으로 변경했습니다.

또한 API 응답 부분의 object spread 문법도 제거해 Apps Script 호환성을 높였습니다.
