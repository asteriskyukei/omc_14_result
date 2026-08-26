# v8.9 전체 통합본 적용 방법

이 폴더는 v8.5 전체 파일에 12회 수정사항을 병합한 완전한 통합본입니다.

## 반영된 규칙

- 12회 Generic / Tech별 Judge 평균과 `STDEV.P` 계산
- 참가자별 최고·최저 Z-score를 정확히 하나씩 제외
- 남은 5개 Z-score 합산
- Generic / Tech별 순위
- Hitsound / Playability / Concept은 Judge별 원점수를 전체 12회 참가자 기준 `STDEV.P` Z-score로 변환
- Judge별 서브카테고리 Z-score 순위를 `1위=10`, `2위=5`, `3위=2`, 나머지 `0`으로 변환하여 합산
- 참가자 상세 화면에서 Judge별 서브카테고리 원점수와 Z-score를 함께 표시
- Special Awards는 Generic / Tech 화면 필터와 무관하게 12회 전체 참가자로 고정
- Special Awards 합계 동점은 원본 시트의 `MATCH(...,0)` 동작처럼 시트에서 먼저 등장하는 참가자를 우선 표시
- 서브카테고리는 본선 Final Score와 별도

## 안전한 적용 순서

1. 현재 스프레드시트를 복사하여 백업합니다.
2. Apps Script의 기존 `Code.gs`를 이 통합본의 `apps-script/Code.gs` 전체 내용으로 교체합니다.
3. Apps Script에서 `upgradeToV89Complete()`를 한 번 실행합니다.
4. 이 함수는 기존 Scores 행을 삭제하거나 초기화하지 않습니다. 누락된 서브카테고리 헤더와 12회 Rounds 설정만 갱신합니다.
5. 배포 → 배포 관리 → 기존 배포 수정 → **새 버전** → 배포합니다.
6. GitHub Pages의 `index.html`, `styles.css`, `app.js`도 이 통합본 파일로 교체합니다.
7. 웹페이지에서 사용하는 Apps Script `/exec` 주소가 방금 새 버전으로 배포한 주소인지 확인합니다.

`setupSheets()`, `migrateToMultiRound()`, `upgradeRound12ScoringScope()`, `upgradeRound12Subcategories()`는 다시 실행하지 마세요.

## 정상 검산값

```text
Generic: Livermorium 4.564 / Down 4.534 / Enon 4.151
Tech: iLyne 4.459 / bIG data 3.655 / Acylica 0.696

Hitsound: DH02 37 / Enon 32 / iLyne 29
Playability: Luscent 35 / Enon 32 / Livermorium 30
Concept: bIG data 39 / Abelia 35 / Kaguya_Sama 30
```

계속 `iLyne 4.878`이 표시되면 이전 Apps Script 배포 버전이 실행 중인 것입니다.
