# B0-b 첫 실행 "스마트 검색" 안내 시안

기준: PRD v2 §0.1(비개발자 원칙), §5.8 F8.3a. 앱 본체 코드는 바꾸지 않았고 디자인 랩에 장면 하나를 추가했다.

## 만든 것
- `app/apps/desktop/dev/design-lab/smartSearchScene.tsx`: 새 장면 `첫 실행 · 스마트 검색`. `scenes.tsx`의 `scenes` 배열 끝에 등록했다.
- `app/apps/desktop/dev/design-lab/lab.css`: `ss-*` 스타일을 끝에 추가했다. 색·반경·그림자는 `tokens.css` 토큰만 쓴다.
- 재사용: 키트의 `SpringCheck`(켜기/끄기), 랩의 `scene-eyebrow`·`scene-search`.
- 실행: `app/apps/desktop`에서 `pnpm exec vite`, 이어서 `/dev/design-lab/index.html?theme=dark&accent=...`.

## 보여 주는 상태
1. 첫 실행 질문: "스마트 검색을 켤까요? …" [켜기] [나중에].
2. 내려받는 중: 진행 막대(42%), 받은 용량, [취소]. 받는 동안에도 노트를 쓸 수 있다고 알린다.
3. 사양 부족: 이유 한 문장(저장 공간 부족)과 "단어 검색 계속 쓰기".
4. 설정 → 스마트 검색: 켜기/끄기, 사용 중인 공간, [지우기…]. 누르면 "스마트 검색에 쓰는 파일과 검색 정보가 함께 사라져 공간을 돌려받고, 노트는 그대로"라는 설명과 확인 단계가 나온다. 지우면 끄기 상태로 바뀐다(클릭해 볼 수 있음).
5. [나중에] 이후: 검색창 옆의 작은 "스마트 검색 켜기" 칩과 한 줄 안내.

## 화면 확인
- `docs/assets/ui/b0-first-run-light.png`, `b0-first-run-dark.png`: 라이트·다크 각 5상태.
- `docs/assets/ui/b0-first-run-dark-coral-reduced-motion.png`: 다크 + 커스텀 accent(`#dc6e52`) + `prefers-reduced-motion: reduce`. 레이아웃·대비가 유지된다.
- 진행 막대의 폭 전환은 reduced-motion에서 꺼진다. `SpringCheck`는 키트가 이미 처리한다.
- `pnpm lint`(오류 0, 경고 45건은 기존 것, 새 파일 경고 없음), `tsc --noEmit` 통과. 기본 `tsconfig.json`은 `src`만 포함하므로, `dev/design-lab`을 포함한 임시 설정으로도 따로 확인해 오류가 없었다.

## 가정
- 용량 "약 ○○MB"는 **200MB로 임시 표기**했다. 실제 값은 B0-a 측정 뒤 바꾼다(PRD F8.1: 191MB는 참고 수치일 뿐).
- 문구는 "스마트 검색"만 쓰고 임베딩·모델·GGUF는 화면에 쓰지 않았다. 지우기 설명의 "스마트 검색에 쓰는 파일"이 PRD의 "모델 파일"에 해당한다.
- 사양 부족의 예시 이유는 저장 공간이다. 메모리 부족일 때는 이유 문장만 바꾼다("메모리가 부족해요").
- 취소·이어받기 정책, 실제 진행 동기화, 상태 저장은 이 시안 범위 밖이다. 상태 패널은 한 화면에 나란히 놓은 정적 예시다.
- 랩은 영어 장면이 기본이지만 이 장면은 제품 문구 검증을 위해 한국어로 썼다.
