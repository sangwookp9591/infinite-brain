# Infinite Brain 고유 디자인 언어: 방향 시안 3개 + 아바타 시안 (2026-10-17)

- 상태: 방향 결정용 시안 (제품 코드 `src/` 변경 없음)
- 배경: M6(`2026-10-15-ui-redesign-color-design.md`)에서 zinc/ink 토큰과 kit 컴포넌트 10개를 바꿨지만, 레이아웃·밀도·타이포·아이콘·셸 구조·아바타(`Avatar.tsx`, DiceBear notionists)는 Baalda 그대로다. 사용자 요청: "Baalda 디자인을 완전히 새로운, 우리만의 디자인으로. 아바타도 독창적으로."
- 시안 코드: `app/apps/desktop/dev/design-lab/` (`directions.html`, `avatars.html`). 스크린샷: `/private/tmp/ib-design/<방향>/`, `/private/tmp/ib-design/avatars/`.
- 실행: `cd app/apps/desktop && npx vite --port 4401` 후 `/dev/design-lab/directions.html?dir=orbit|synapse|folio&screen=welcome|main|settings|share&theme=light|dark`, `/dev/design-lab/avatars.html?theme=light|dark`.

## 1. 조사 (확인일 2026-10-17)

"그대로 베끼지 않는다"가 원칙이다. 아래는 **언어(원칙)만** 참고하고 코드·에셋은 가져오지 않는다. 라이선스는 이번에 GitHub의 LICENSE 파일/API로 직접 확인한 값이다(확인 못 한 것은 그렇게 적었다).

| 출처 | 링크 | 라이선스(확인) | 참고할 점 | 피할 점 |
|---|---|---|---|---|
| React Bits | https://reactbits.dev · https://github.com/DavidHDev/react-bits | **MIT + Commons Clause Condition v1.0** (LICENSE.md 확인). 앱/제품의 일부로 쓰는 것은 허용, 컴포넌트 자체를 판매·재라이선스·재배포(번들·포팅 포함)하는 것은 금지. 사이트 본문에는 라이선스 문구 없음 | 텍스트/배경/마이크로 인터랙션을 "소스로 복사해 고쳐 쓰는" 모델. 모션을 절제된 한두 곳에만 쓰는 법 | 이미 kit 10개가 변형본이다. 변형본을 다시 외부에 재배포하는 형태(예: 오픈소스 kit 패키지)는 Commons Clause 위반 소지. 화려한 배경 효과를 에디터 영역에 쓰지 않는다 |
| Magic UI | https://magicui.design · https://github.com/magicuidesign/magicui | **MIT** (LICENSE.md 확인) | 은은한 빔/그리드/궤도 애니메이션이 "궤도(Orbit)" 모티프와 어울림 | 랜딩페이지용 과장 효과를 앱 UI에 옮기지 않는다 |
| Aceternity UI | https://ui.aceternity.com | **미확인** (FAQ·저장소 라이선스 URL 접근 실패, 이번 조사에서 확인 못 함) | 글로우/스포트라이트 카드 아이디어 | 라이선스 확인 전에는 코드를 가져오지 않는다. Pro 컴포넌트는 별도 유료 약관이라 금지로 간주 |
| shadcn/ui | https://ui.shadcn.com · https://github.com/shadcn-ui/ui | **MIT** (LICENSE.md 확인) | 토큰 이름 체계(background/foreground/muted/accent), 접근성 있는 primitive 구조 | 기본 zinc 외형을 그대로 쓰면 "또 하나의 shadcn 앱"이 된다 |
| Origin UI → coss.com/ui | https://github.com/origin-space/originui | **AGPL-3.0** (저장소 LICENSE 확인. README는 "coss.com/ui (formerly Origin UI)"로 이름 변경 안내) | 다이얼로그·입력·세그먼트 같은 밀도 높은 폼 패턴을 참고 | AGPL이므로 **코드는 절대 복사하지 않는다**(참고만) |
| motion-primitives | https://github.com/ibelick/motion-primitives | MIT (GitHub license API 확인) | 스프링 전환 파라미터 감각 | — |
| Linear | https://linear.app/now/how-we-redesigned-the-linear-ui | 해당 없음(디자인 글). 글 내용 확인: LCH 기반 테마(base/accent/contrast 3입력), 사이드바·탭 시각 잡음 축소, 제목에 Inter Display, 고대비 테마 | **세 입력으로 테마를 만드는 방식**(Infinite Brain의 accent 파생과 같은 철학), 제목만 디스플레이 서체 | Linear의 회색 단색 느낌 그대로는 비개발자에게 차갑다 |
| Raycast / Arc / Reflect / Tana | https://www.raycast.com · https://arc.net · https://reflect.app · https://tana.inc | 해당 없음(제품). **이번 세션에서 직접 열어 확인하지 않았고, 일반 지식에 의존한 인상 메모**다 | Raycast: 키보드 우선·명령 팔레트 중심, 모노 서체 포인트 → Synapse. Arc: 사이드바를 "공간"으로 다루고 색으로 구획 → Orbit/Folio의 vault 색 구분. Reflect: 밤하늘/보랏빛 + 부드러운 글로우 → Orbit. Tana: 노드·태그 중심의 밀도 → Synapse 인스펙터 | 각 제품의 로고/아이콘/고유 일러스트를 연상시키는 것 |

서체는 앱에 번들 가능한 **SIL OFL**만 쓴다(파일과 라이선스는 `dev/design-lab/fonts/`에 OFL-*.txt와 함께 보관): Fraunces(OFL), Geist·Geist Mono(OFL), Instrument Serif(OFL). 이번 시안은 **라틴 서브셋**만 번들했고, 한글은 시스템 서체(Apple SD Gothic Neo 등)로 대체된다. 한글 UI에서의 디스플레이 서체는 별도 결정이 필요하다(§6 열린 질문). 외부 CDN은 쓰지 않는다(기존 lab의 `fonts.googleapis.com` 링크와 달리 새 시안은 전부 로컬 번들).

## 2. 세 방향

공통 규칙: 텍스트 대비 4.5:1 이상(`directions/tokens.test.ts`가 방향×테마별로 ink/muted/accent/onAccent/danger를 검사한다, 24개 중 전부 통과). 사용자 문구는 PRD §0.1에 따라 비개발자용, 제품 용어는 "vault".

### 2.1 Orbit — "밤하늘에 떠 있는 섬들"

- 콘셉트: 무한과 궤도. 영역(레일·사이드바·시트)이 배경 위에 떠 있는 둥근 섬이고, 시트가 가장 높은 층이다.
- 색: light `#f1f2f9` 배경 / `#fff` 시트 / ink `#14162b` / accent 인디고 `#4a3fd4`. dark `#080a16` / `#141830` / `#e9ebf9` / `#a29bff`. 배경에 희미한 별점 격자와 상단 글로우.
- 타이포: 제목 Fraunces(세리프, 500~600), 본문 Geist 14px, 보조 Geist Mono 11px 대문자(eyebrow).
- 밀도·형태: 보통 밀도. radius 16/22/26(시트), pill 버튼·입력. 그림자는 부드럽고 넓은 글로우. 모션은 느린 페이드·글로우 확산(150–250ms), hover 시 accent 링.
- 아이콘: 1.5px 라운드 라인, 원·궤도 모티프(로고는 두 겹 궤도). 
- 셸: **60px 아이콘 레일 + 250px 떠 있는 패널 + 떠 있는 시트**. 탭바를 없애고 상단에 breadcrumb + 참여자 아바타 + 공유 버튼. 720px에서는 패널을 접고 레일만 남긴다.
- 그래프: "항상 어두운 우주"를 **모든 테마의 기본 배경으로 유지**하되 별점 격자와 같은 문법으로 일관(재해석: 가장 자연스러운 연결).

### 2.2 Synapse — "빠르고 촘촘한 신호"

- 콘셉트: 뉴런 신호. 키보드 우선, 정보 밀도 높음, 군더더기 없는 선과 모노 서체 포인트.
- 색: light `#f4f4f5` / `#fff` / `#09090b` / accent 올리브 `#3f6212`. dark `#08080a` / `#121215` / `#f2f2f4` / accent 라임 `#c6f135`(dark의 형광 신호). 
- 타이포: 전부 Geist(본문 13px), 수치·메타는 Geist Mono 12px.
- 밀도·형태: 높은 밀도(행 높이 약 24px). radius 4–6, 그림자 없음(1px 라인과 색 면으로만 계층), 모션은 80–120ms 직선적, 장식 없음. 포커스는 accent 2px 인셋.
- 아이콘: 1.25px 사각 캡·마이터 조인의 가는 선. 아바타도 둥근 사각.
- 셸: **상단 탭 스트립(선택 탭 하단 accent 선) + 224px 평평한 사이드바 + 오른쪽 252px 인스펙터(링크된 노트·참여자) + 하단 24px 상태바**. 다이얼로그는 상단 정렬 팔레트 형태. 720px에서 인스펙터 숨김.
- 그래프: 다크 우주 대신 **모든 테마에서 "신경망 도식"**(검은 배경 + accent 라임 노드). 라이트 모드 그래프는 라인 드로잉으로 재해석할 수 있다(제안만).

### 2.3 Folio — "따뜻한 종이 노트북"

- 콘셉트: 비개발자도 편한 공책. 종이 질감, 큰 글씨, 책갈피 탭, 인덱스 카드.
- 색: light 종이 `#f2e9d8` / `#fffaf0` / 잉크 `#2b2118` / accent 테라코타 `#a8421f`. dark `#17130e` / `#27211a` / `#f2e9d8` / `#f0916f`. 배경에 괘선.
- 타이포: 제목 Instrument Serif(400, 큰 사이즈 54–72px), 본문 Geist 15px, eyebrow는 이탤릭 세리프.
- 밀도·형태: 낮은 밀도(여백 넉넉). radius 12–18, 아래로 쌓이는 "종이 두께" 그림자(`0 6px 0 -3px`), 카드가 ±0.6° 기울어져 놓인 느낌. 모션은 살짝 튕기는 스프링(180–260ms).
- 아이콘: 2px 굵은 라인 + 14% 채움(듀오톤).
- 셸: **290px 사이드바 = 파일 하나하나가 인덱스 카드 + 폴더 탭 형태의 상단 탭 + 중앙 종이 시트**. 720px에서 사이드바 220px.
- 그래프: 다크 우주 대신 **"별자리 도감"**(종이 위에 별자리 스케치, dark에서는 밤하늘). 제안만.

## 3. 화면 구현 현황 (design-lab)

3방향 × 4화면(웰컴/vault 선택, 사이드바+파일트리+에디터, 설정 다이얼로그, 공유/멤버 다이얼로그) × light/dark × (1440×900, 720×900) = 48장. 목록은 `docs/reports/IMPL-REPORT-design-directions.md`. 한계: 정적 목업(상호작용 최소), 실제 컴포넌트 재사용 아님, 에디터 본문은 CodeMirror가 아닌 정적 마크업.

## 4. 아바타 시스템 시안 (3개)

모두 `dev/design-lab/avatars/generators.ts`의 순수 함수 `avatarSvg(seed, {style, theme})`. 외부 서비스·네트워크·DOM 없음, seed(id/email/이름; trim·소문자 정규화)로 결정적 생성. FNV-1a + mulberry32. 출력은 32×32 viewBox의 독립 SVG(`id`/`url()`/`href` 없음 → 같은 페이지에 여러 개 넣어도 충돌 없고 `scopeSvgIds` 불필요). DiceBear(`@dicebear/*`, 약 300 KB lazy chunk)를 제거할 수 있고 생성기는 약 3 KB다.

- **A · Constellation**: 5×5 격자에서 별 5–7개를 골라 선으로 잇고 하나는 더 큰 별. Folio 기본.
- **B · Orbit**: 핵 + 기울어진 고리 1–2개(실선/점선) + 행성 1–2개. Orbit 기본.
- **C · Neuron**: 세포체 + 가지 3–5개(분기) + 말단 구슬 하나. Synapse 기본.

접근성/가독성 설계:
- 색약: Okabe–Ito 계열 8색을 테마별로 조정. **색만으로 구별하지 않는다** — 형태(위상/각도/고리 수/점선 여부)가 주된 식별 요소이고 색은 보조다.
- 대비: 마크 대 타일이 두 테마 모두 4.5:1 이상(테스트로 검증), 타일은 페이지 배경과 구분되는 별도 중립색.
- 작은 크기: 최소 선 두께 2/32, 최소 노드 반지름 2.2/32 → 16px에서 선 1px, 점 약 2.2px. 스크린샷(`avatars/grid-*.png`)에서 24/16px 칸으로 육안 확인. **평가: Neuron과 Constellation은 16px에서도 모양이 구별된다. Orbit은 16px에서 고리가 뭉개져 "눈 모양"으로 비슷해 보이는 경우가 있어 가장 약하다.** 8색 × 형태 조합으로 24 seed가 전부 다른 SVG이긴 하지만(테스트), 16px에서의 "눈으로 구별 가능"은 Neuron > Constellation > Orbit 순이다.
- 한계(미검증): 실제 색약 시뮬레이션(Protanopia/Deuteranopia 필터) 비교는 하지 않았다. 사용자 수천 명 규모의 충돌률은 이론 계산만 있고 측정하지 않았다(테스트는 500 seed에서 >= 99% 서로 다름).

## 5. 비교표

구현 비용 기준: `App.css` 11,013줄, 전체 CSS 16,256줄(`App.css` + `components/*.css` + `styles/*.css`, 2026-10-17 측정). 영역별 줄 범위는 M6 스펙 §2.1 표를 소유권 경계로 그대로 쓴다.

| 항목 | Orbit | Synapse | Folio |
|---|---|---|---|
| 첫인상 | 차분하고 몽환적, 제품명과 가장 잘 맞음 | 날카롭고 전문적, 파워 유저용 | 따뜻하고 친근, 종이 노트 |
| 비개발자 친화성 | 중상 (장식적이지만 구조는 익숙) | 낮음 (밀도·모노 서체가 "개발 도구" 인상) | **높음** (큰 글씨, 책갈피 탭, 카드) |
| 구현 비용 | **중–상**: 셸 구조 변경(레일+플로팅 패널, 탭바 제거→breadcrumb). 셸 영역 2,758줄 대부분 + 에디터 시트 둥근 처리. 다이얼로그는 radius/토큰 위주(5.7k줄 중 약 30% 수정 추정) | **중**: 구조는 현재와 가장 가깝지만 밀도(행 높이·여백) 변경이 전 영역에 퍼져 15.5k줄 전반을 건드림. 인스펙터·상태바 신설 | **상–최상**: 사이드바 행을 카드화, 종이 질감/괘선, 큰 서체 → 셸·에디터·다이얼로그 거의 전부. 한글 세리프 서체 문제 |
| 위험 | 블러/글로우 성능(저사양 WKWebView, `backdrop-filter`), 레일 도입으로 좁은 폭 내비게이션 재설계, 에디터 가독성(시트 대비) | 비개발자 온보딩 인상 악화, 작은 글씨(13px/12px)로 접근성 부담, 키보드 우선 가정 | 한글 디스플레이 서체 부재(Instrument Serif는 라틴 전용), 종이 기울기/괘선이 장식 과다로 보일 위험, dark 모드의 종이 은유 약화 |
| 아바타 궁합 | Orbit 아바타(가장 약한 16px) → Neuron/Constellation 권장 | Neuron | Constellation |
| 그래프 연결 | 다크 우주 유지(자연스러움) | 신경망 도식 | 별자리 도감 |

## 6. 추천: **Orbit 셸 + Folio의 따뜻한 서체/카드 일부 + Neuron 아바타**가 아니라, 단일 방향으로는 **Orbit**

선택 이유: (1) 제품명 "Infinite Brain"과 은하 모티프(이미 있는 Galaxy 그래프)와 일관된다, (2) 구조 변경이 레일/패널/시트로 분명해 P3 하나로 정체성이 크게 바뀌는 데 비해 에디터·다이얼로그는 토큰+radius 중심이라 비용이 Folio보다 낮다, (3) 비개발자 친화성이 Synapse보다 높다. 단 **한 가지 수정**: 아바타는 Orbit 방향의 Orbit 생성기 대신 **Neuron(또는 Constellation)을 기본으로 권장**한다(16px 구별력). 한글 UI의 디스플레이 서체는 Fraunces에 한글이 없어 시스템 서체 폴백이 되므로, 제목은 Geist 600 + 라틴에만 Fraunces를 쓰는 안을 기본으로 한다.

열린 질문(결정 필요): Q1 방향 1개 선택(추천 Orbit). Q2 아바타 기본 스타일(추천 Neuron). Q3 한글 디스플레이 서체(OFL 한글 폰트 번들 크기 vs 시스템 서체 폴백). Q4 `backdrop-filter` 허용 여부(성능). Q5 DiceBear 제거 시 기존 사용자 아바타가 바뀌는 점을 공지할지.

## 7. 구현 단계 분해 (Orbit 기준; 영역별 `App.css` 줄 소유권은 M6 스펙 §2.1 표를 따른다)

| 단계 | 내용 | 소유 범위 | 선행 | 완료 기준 |
|---|---|---|---|---|
| P2.5 토큰/서체 | `tokens.css`를 Orbit 팔레트로 교체(이 문서 `tokens.ts` 값), 서체 번들(Fraunces/Geist/Geist Mono, OFL), 아이콘 세트 교체(1.5px 라인 SVG) | `styles/tokens.css`, `assets/fonts`, 아이콘 컴포넌트, `App.css` 1–216(기반) | M6 P1 | 색 대비 테스트 통과, 패키지 CSP에서 폰트 로드 확인 |
| P3 셸 | 레일 + 플로팅 사이드바 + breadcrumb(탭바 대체), Welcome/vault picker 재디자인 | `App.css` 217–2420, 2793–2949, 3641–4313, `HomeNavigation.css`, `talk.css` | P2.5 | 720px 동작, 탭 기능(다중 노트) 대체 UX 결정 |
| P4 에디터 | 플로팅 시트(radius 26), 속성/백링크 패널, CM6 테마 토큰 갱신 | `App.css` 2421–2792, 2950–3640, 5662–5702, 7797–8154, `editor.css`, `compare.css`, `lib/editor/theme.ts` | P2.5 | 에디터 가독성(본문 대비 4.5:1) |
| P5 다이얼로그 | 설정/공유/멤버/빌링 다이얼로그 radius·행 레이아웃, 필요 시 P5a/b/c | `App.css` 4314–5661, 5703–6140, 6171–7030, 7157–7608, 8155–11013 | P2.5 | 공유 다이얼로그 권한 동작 불변(UI 캐시는 권한 판단 금지) |
| P6 대시보드/Health | 토큰 소비 위주 | `health.css` 등 | P2.5 | 하드코딩 색 정리 |
| P7 그래프 | 별점 격자 문법과 맞추기, 다크 유지 | `graph.css`, `lib/graph/*` | P1 | — |
| A1 아바타 | 생성기를 `src/lib/avatar/`로 이동, `Avatar.tsx`/`Face`에서 DiceBear 호출 교체, `@dicebear/*` 의존 제거, `scopeSvgIds` 불필요 | `components/Avatar.tsx`, `lib/avatarIdentity.ts`, 번들 | 방향 결정 | 번들 크기 감소, 결정성 테스트, 기존 사진 아바타 경로 불변 |

P3–P6은 병렬 가능하나 같은 `App.css`를 건드리므로 위 줄 범위를 소유권 경계로 삼고, 줄 번호는 착수 시점에 `grep`으로 재측정한다(이 문서의 범위는 M6 스펙 측정 기준이며 이후 `App.css`가 10,820줄 → 11,013줄로 늘었다).
