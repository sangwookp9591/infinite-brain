# B0-b 첫 실행 "스마트 검색" 안내 시안

기준: PRD v2 §0.1(비개발자 원칙), §5.8 F8.3a. 앱 본체 코드는 바꾸지 않았고 디자인 랩에 장면 하나를 추가했다.

## 만든 것
- `app/apps/desktop/dev/design-lab/smartSearchScene.tsx`: 새 장면 `첫 실행 · 스마트 검색`. `scenes.tsx`의 `scenes` 배열 끝에 등록했다.
- `app/apps/desktop/dev/design-lab/lab.css`: `ss-*` 스타일을 끝에 추가했다. 기존 디자인 토큰을 사용하고, 지우기 확인 버튼은 커스텀 accent와 독립된 색을 쓴다.
- 재사용: 키트의 `SpringCheck`(켜기/끄기), 랩의 `scene-eyebrow`·`scene-search`.
- 실행: `app/apps/desktop`에서 `pnpm exec vite`, 디자인 랩 `/dev/design-lab/index.html?theme=dark&accent=...`.

## 보여 주는 상태
1. 첫 실행 질문: 해요체 안내, [켜기] [나중에]. 노트는 기기 밖으로 나가지 않는다고 알린다.
2. 내려받는 중: 진행 막대(42%), 받은 용량, [취소]. 받는 동안에도 노트를 쓸 수 있다.
3. 사양 부족: 저장 공간과 메모리 사유를 버튼으로 전환한다. 저장 공간 안내는 “저장 공간이 부족해 켤 수 없어요. 180MB 이상 비우면 다시 켤 수 있어요.”이며, 메모리 안내는 “이 기기의 메모리가 부족해 켤 수 없어요.”다. 두 경우 모두 [단어 검색 계속 쓰기]를 제공한다.
4. 설정 → 스마트 검색: 켜기/끄기, 사용 중인 공간, [지우기…]. 확인 단계에서는 [지우기]와 [그만두기]가 나오며 “스마트 검색 파일과 검색 정보가 사라져요. 노트는 그대로 남아요.”라고 안내한다. 지우면 끄기 상태로 바뀐다.
5. [나중에] 이후: 검색창 옆의 “스마트 검색 켜기” 칩과 한 줄 안내.

## 화면 확인
- `docs/assets/ui/b0-first-run-light.png`, `b0-first-run-dark.png`: 라이트·다크 기본 장면.
- `docs/assets/ui/b0-first-run-dark-coral-reduced-motion.png`: 다크 + 커스텀 accent(`#dc6e52`) + `prefers-reduced-motion: reduce`.
- `docs/assets/ui/b0-first-run-clear-confirmation.png`: 지우기 확인 단계.
- `docs/assets/ui/b0-first-run-memory-limit.png`: 메모리 부족 변형.
- 지우기 버튼은 랩 CSS에서 `#b91c1c` 배경과 `#fff` 글자를 사용한다. 흰색 대비는 6.47:1이며 라이트·다크에서 같다. tokens.css에 danger 전용 글자 토큰은 없다. **앱 구현 시 `--text-on-danger` 토큰 필요.**
- 진행 막대 폭 전환은 reduced-motion에서 꺼진다. `SpringCheck`는 키트가 처리한다.

## 가정 및 후속
- 용량은 B0-a 측정값([B0-LLAMA-SPIKE.md](B0-LLAMA-SPIKE.md))을 반영했다. 기본 표기는 Q4_K_XL 176MB를 둥글린 180MB, Metal 기기는 Q8_0 310MB이며 앱이 기기에 맞춰 고른다. 설정 패널의 사용 중 공간 예시는 모델과 색인을 합친 190MB다.
- 문구는 화면 전체 해요체로 통일했고 임베딩·모델·GGUF는 화면에 쓰지 않았다.
- 취소·이어받기 정책, 실제 진행 동기화, 상태 저장은 이 시안 범위 밖이다. 상태 패널은 한 화면에 나란히 놓은 정적 예시다.
- 앱 본체에 적용할 때 공용 버튼 및 지운 뒤 포커스 목적지를 정해야 한다.
