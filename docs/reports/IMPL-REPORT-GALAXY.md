# 작은 vault의 galaxy 밀도 조정

2026-10-17 · `ib-galaxy-sparse`

## 변경

노트 수에 따라 galaxy 배치 반경을 축소한다. 3,000개에서는 기존 1,400 반경과 좌표 분포를 유지하고, 1~3,000개 구간은 반경 220 이상의 제곱근 비율로 줄인다. 같은 ID/입력은 이전과 같이 결정적으로 배치한다. WebGPU와 WebGL2 렌더러는 배경 별 수(노트당 8개, 최대 1,600개), 성운/먼지/암흑 띠 크기, 자동 맞춤 카메라를 배치 반경에 맞춘다. GPU 불가 시 2D canvas는 최대 40개까지 화면에 자동 맞추고 결정적인 배경 별을 노트 수에 따라 추가한다.

레이아웃 테스트에 5, 20, 40, 500, 3,000개 노트의 점유 반경/경계 반경 비율과 반경 상한 및 대형 vault의 기존 반경 유지 조건을 추가했다. Preview harness는 5/20/40/500개 데이터와 세 렌더 경로의 캡처를 지원한다.

## 검증

- `pnpm install --frozen-lockfile` (`app/`) — 완료, lockfile 변경 없음.
- `NODE_OPTIONS=--no-experimental-webstorage pnpm exec vitest run src/lib/graph` (`app/apps/desktop/`) — **통과, 5개 파일 / 45개 테스트**.
- `pnpm exec tsc --noEmit` (`app/apps/desktop/`) — 통과, 진단 없음.
- `git diff --check` — 통과.
- `PLAYWRIGHT_MODULE=/private/tmp/galaxy-playwright/node_modules/playwright/index.mjs CHROMIUM_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node dev/graph-galaxy/capture-sparse.mjs` — 5/20/40/500개 × WebGPU/WebGL2/2D 캡처 완료. 결과는 `/private/tmp/galaxy-sparse/galaxy-{5,20,40,500}-{webgpu,webgl,2d}.png`.

화면 캡처는 합성 preview 데이터와 Chrome을 사용했다. 실제 vault 성능, 네이티브 WebView2/WKWebView 동작은 검증하지 않았다. 전체 desktop 테스트는 실행하지 않았다.

## 커밋

- `9c3b1fd fix(desktop): densify sparse galaxy views`
- `5781513 test(desktop): capture sparse galaxy previews`
