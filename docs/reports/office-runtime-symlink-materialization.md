<!-- SPDX-License-Identifier: Apache-2.0 -->
# Office runtime 심볼릭 링크 제거와 배포 검증

2026-10-21, macOS Apple Silicon에서 검증했다. 최종 `darwin-arm64` runtime의 심볼릭 링크는 **0개**이며, 원본 runtime 테스트 **18/18**, 링크 비보존 복사본 테스트 **18/18**, pairing 데모 **9/9**를 통과했다. 서버의 직접 production 의존성 21개는 모두 `app/pnpm-lock.yaml`과 같은 버전이다.

## 배포 방식

`prepare-office-runtime.mjs`는 다음 명령으로 서버를 배포한다.

```sh
pnpm --filter server --prod --config.node-linker=hoisted --config.inject-workspace-packages=true deploy <stage>/server
```

pnpm 10.34.5의 modern deploy는 공유 lockfile에서 서버 전용 lockfile을 만들고 frozen install을 수행한다. hoisted 배포로 의존성 디렉터리 링크를 없애고, 남은 실행 파일 별칭은 링크 대상을 실제 파일로 복사한다. Postgres의 `pg-symlinks.json`에 있는 dylib 별칭 17개도 실제 파일로 복사한다. 외부 파일 링크나 예상하지 않은 디렉터리 링크는 준비 실패로 처리한다.

완성된 staging 디렉터리는 기존 root를 교체하기 전에 `verifyRoot`를 통과해야 한다. verifier는 모든 심볼릭 링크, 누락되거나 버전이 다른 production 의존성, 읽을 수 없거나 지원하지 않는 lockfile을 실패로 처리한다. pnpm v9 lockfile의 서버 production importer만 읽고 peer snapshot 접미사를 제거해 설치된 `package.json` 버전과 비교한다.

`--legacy`와 hoisted 설정을 함께 쓰면 pnpm이 lockfile을 무시한다. 첫 실험에서 `better-auth`가 잠긴 1.6.23 대신 1.7.12로 설치되었고, `better-auth/plugins`의 `mcp` export 부재로 runtime 테스트가 15/18에 그쳤다. 최종 구현은 `--legacy`를 사용하지 않는다.

## 최종 검사

아래 경로는 저장소 루트 기준이다. 각 최종 명령의 종료 코드는 0이었다.

| 작업 디렉터리 | 명령 | 결과 |
| --- | --- | --- |
| `app` | `pnpm run office:prepare` | 성공, 총 2회 실행. 두 번째가 최종 modern deploy 결과 |
| `app` | `node --test scripts/verify-office-runtime.test.mjs` | 8/8, 실패 0, skip 0 |
| `app` | `pnpm run office:verify` | 통과, 링크 0개, 의존성 21/21 일치 |
| 저장소 루트 | `find app/apps/desktop/src-tauri/office-runtime/darwin-arm64 -type l \| wc -l` | 0 |
| `app/apps/server` | `OFFICE_RUNTIME_ROOT=../desktop/src-tauri/office-runtime/darwin-arm64 OFFICE_HOST_SYNC_REGRESSIONS=1 node --test office-host/runtime.test.mjs` | 18/18, 실패 0, skip 0 |
| 저장소 루트 | `rsync -a --delete --no-links app/apps/desktop/src-tauri/office-runtime/darwin-arm64/ /tmp/ib-office-no-links-ctx-ac7327301f3a.8UMoML/` | 성공 |
| 저장소 루트 | `find /tmp/ib-office-no-links-ctx-ac7327301f3a.8UMoML -type l \| wc -l` | 0 |
| `app/apps/server` | `OFFICE_RUNTIME_ROOT=/tmp/ib-office-no-links-ctx-ac7327301f3a.8UMoML OFFICE_HOST_SYNC_REGRESSIONS=0 node --test office-host/runtime.test.mjs` | 18/18, 실패 0, skip 0 |
| `app` | `node scripts/demo-office-pairing.mjs` | 9/9 PASS |
| 저장소 루트 | `git diff --check` | 통과 |

단위 테스트는 정상 runtime, 누락 실행 파일, 금지 파일, 없는 root, 파일·디렉터리·dangling·순환 링크 거절, scoped/catalog 의존성과 peer suffix 해석, 버전 drift/누락 거절, lockfile 읽기 실패를 검증한다. runtime 통합 테스트는 매번 별도 임시 Postgres cluster를 만들며 개발 데이터베이스를 사용하지 않는다. `runtime.test.mjs`의 root 가정은 변경할 필요가 없었다.

중간 실행에서 저장소 개발용 `ioredis`가 실디렉터리로 존재해 전이 의존성 `standard-as-callback`을 찾지 못했다. 그 상태의 원본 sync 회귀는 17/18, 데모는 HTTP 준비 시간 초과로 실패했다. 해당 디렉터리를 `/tmp/ib-office-workspace-ioredis-backup-ctx-ac7327301f3a`에 보존한 뒤 `pnpm install --frozen-lockfile`로 정상 `.pnpm` 링크를 복구했고, `require('ioredis')` 성공과 위 최종 재실행 통과를 확인했다. 저장소 lockfile은 바꾸지 않았다.

최종 inventory SHA-256은 `0bf879c76c2d103eab3cbb1454075aed20f73958c323220a780a70d69c2c00fe`이며, 파일 25,451개와 디렉터리 2,096개를 검사했다. 링크 비보존 검사용 임시 복사본과 배포 실험 디렉터리는 검증 후 정리했다.

## 잠금 버전과 설치 버전

| 직접 production 의존성 | lockfile | 설치 |
| --- | --- | --- |
| `@aws-sdk/client-s3` | 3.1134.0 | 3.1134.0 |
| `@aws-sdk/s3-request-presigner` | 3.1134.0 | 3.1134.0 |
| `@hocuspocus/extension-redis` | 4.4.0 | 4.4.0 |
| `@hocuspocus/server` | 4.4.0 | 4.4.0 |
| `@hono/node-server` | 2.0.10 | 2.0.10 |
| `@node-rs/argon2` | 2.0.2 | 2.0.2 |
| `@openrouter/sdk` | 1.3.10 | 1.3.10 |
| `@polar-sh/sdk` | 0.48.1 | 0.48.1 |
| `better-auth` | 1.6.23 | 1.6.23 |
| `dotenv` | 17.4.2 | 17.4.2 |
| `file-type` | 22.1.1 | 22.1.1 |
| `hono` | 4.13.8 | 4.13.8 |
| `ioredis` | 5.11.1 | 5.11.1 |
| `jose` | 6.2.3 | 6.2.3 |
| `kysely` | 0.29.3 | 0.29.3 |
| `nodemailer` | 10.0.13 | 10.0.13 |
| `pg` | 8.22.0 | 8.22.0 |
| `selfsigned` | 5.5.0 | 5.5.0 |
| `standardwebhooks` | 1.0.0 | 1.0.0 |
| `ws` | 8.21.0 | 8.21.0 |
| `yjs` | 13.6.31 | 13.6.31 |

## 크기와 남은 확인

같은 `du -sk` 측정 방법으로 변경 전은 **451,656 KiB = 441.1 MiB**, 최종 root는 **625,600 KiB = 610.9 MiB**였다. 증가분은 **173,944 KiB = 169.9 MiB, 38.5%**다. 최종 server는 219,516 KiB, Postgres는 295,624 KiB였다. Postgres dylib 별칭 17개의 파일 길이 합계는 161,581,952 bytes(154.1 MiB)로, 증가분 대부분을 차지한다. 합의한 약 800 MB 상한 안에 들어간다.

추가로 용량을 줄이려면 대상 OS별로 Postgres 실행 파일과 dylib의 로더 참조를 조사해 사용하지 않는 개발용 별칭이나 도구를 제외할 수 있다. 배포 대상별 로드 검증과 이번 회귀 검사를 다시 수행해야 하므로 이번 변경에는 포함하지 않았다.

검증 대상은 darwin-arm64의 준비된 root와 Tauri의 링크 탈락을 흉내 낸 복사본이다. 실제 서명·공증된 앱, 네이티브 Windows, darwin-x64, Linux 배포물은 이 작업에서 검증하지 않았다. 커밋·푸시·릴리스는 수행하지 않았다.
