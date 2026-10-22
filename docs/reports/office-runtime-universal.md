<!-- SPDX-License-Identifier: Apache-2.0 -->
# universal macOS 사내 호스트 런타임 준비

2026-10-22, Apple Silicon Mac에서 `darwin-arm64` 기본 준비와 `darwin-x64` 크로스 준비를 완료했다. 두 번들 모두 정적 검증을 통과했고, arm64 실제 번들 runtime 시험은 **19/19**, 검증기 단위 시험은 **17/17**, Rust 실행 슬라이스 선택 시험은 **1/1** 통과했다. **x64는 Rosetta가 없어 미실행**이며 마이그레이션 적용·프로세스 기동·native 모듈 로딩을 실행으로 검증하지 않았다.

## 변경과 사용법

변경 파일은 `app/scripts/prepare-office-runtime.mjs`, `verify-office-runtime.mjs`, `verify-office-runtime.test.mjs`, `app/apps/desktop/src-tauri/src/office_host.rs`의 런타임 디렉터리 선택 helper/시험, 이 보고서다. 다른 작업자의 서버·Rust 변경과 기존 미추적 파일을 보존했다. `office-runtime-sources.json`, `pnpm-lock.yaml`, `tauri.office.conf.json`은 변경하지 않았다.

저장소 `app/`에서 실행한다.

```sh
pnpm run office:prepare
pnpm run office:verify
OFFICE_RUNTIME_TARGET=darwin-x64 pnpm run office:prepare
OFFICE_RUNTIME_TARGET=darwin-x64 pnpm run office:verify
```

기존 위치 인자도 지원하며 위치 인자 → `OFFICE_RUNTIME_TARGET` → 현재 OS/아키텍처 순서다. 같은 OS의 다른 아키텍처 준비를 지원하고 cross-OS 준비는 명시적으로 거절한다. Node 22.23.3과 PostgreSQL 16.14.0-beta.17은 기존 sources의 대상별 아카이브·SHA-256/SHA-512 그대로 받았다.

pnpm 10.34.5의 `--config.cpu=<arch> --config.os=<os>`는 내부 `overrideSupportedArchitecturesWithCLI`에서 `supportedArchitectures.cpu/os` singleton 배열로 변환된다. `current`를 포함하지 않아 호스트 arm64 optional 패키지를 x64 번들에 넣지 않는다. 기존 shared-lockfile deploy 경로는 대상 전용 frozen lockfile을 만들며, workspace lockfile은 deploy 전후 byte 단위로 대조한다. 크로스 deploy에는 `--ignore-scripts`를 주어 외국 아키텍처 설치 스크립트를 실행하지 않는다. esbuild는 upstream JS launcher와 x64 optional binary가 함께 배포되며 postinstall로 launcher를 host binary로 바꾸지 않는다.

| 패키지 | arm64 변형 | x64 변형 | 잠금 버전 |
| --- | --- | --- | --- |
| Argon2 | `@node-rs/argon2-darwin-arm64` | `@node-rs/argon2-darwin-x64` | 2.0.2 |
| esbuild | `@esbuild/darwin-arm64` | `@esbuild/darwin-x64` | 0.28.1 |
| Rollup | `@rollup/rollup-darwin-arm64` | `@rollup/rollup-darwin-x64` | 4.62.2 |
| fsevents | upstream universal | x86_64 slice | 2.3.3 |

`fsevents.node` upstream 파일은 x86_64+arm64 universal이다. x64 준비에서만 `lipo -thin x86_64`로 대상 슬라이스를 선택하고 모드 비트를 보존한다. arm64 준비는 기존 upstream universal 파일을 유지한다. 불필요 파일이나 패키지를 임의로 제거하지 않았다.

완성·검증은 `.preparing-*` 임시 형제 디렉터리에서 진행한다. 모든 검증이 끝난 뒤 두 번의 rename으로 교체하고 실패 시 이전 root를 복원하므로 arm64 root를 다운로드/빌드 시간 동안 비우지 않는다.

## 정적 검증과 universal 리소스 선택

모든 파일의 magic을 조사하고 Mach-O이면 실행 권한·확장자와 관계없이 `lipo -archs`로 검사한다. 모든 실행 파일은 `lipo` 또는 `file`로 검사하고 `.node`, `.dylib`, `.so`는 Mach-O 형식을 요구한다. x64는 **모든 134개 Mach-O가 x86_64 단일 슬라이스**이며 arm64나 universal 혼입을 거절한다. arm64는 136개 Mach-O가 arm64를 포함해야 하며 기존 universal fsevents를 허용한다. 실행 비트가 붙은 npm의 JSON·README·JS를 native 실행 파일로 오인하지 않는다.

기존 direct server dependency 버전 대조에 모든 설치된 transitive package의 lockfile package entry 대조와 대상 native optional 변형의 존재 검사를 추가했다. 두 번들 각각 **25,453 files, 2,096 directories, symbolic links 0**이다. manifest schema에 `manifestVersion: 2`를 더하되 supervisor의 `protocol: 1` 계약은 유지했다. manifest 자신의 항목을 제외한 모든 파일의 상대 경로·크기·SHA-256을 inventory에 넣고 재검증한다. verifier CLI는 manifest 자신의 해시와 전체 inventory 해시도 출력한다. 이는 서명 대신 쓰는 인증 수단이 아니라 준비 결과의 무결성 대조다.

`std::env::consts::ARCH`는 컴파일된 실행 슬라이스의 아키텍처다. universal 앱이 native arm64로 실행되면 `darwin-arm64`, Intel 또는 x86_64 슬라이스로 실행되면 `darwin-x64`를 선택하는 현재 동작이 맞다. 물리 CPU를 탐지하는 방식으로 바꾸지 않았고 mapping helper와 회귀 시험만 분리했다. `tauri.office.conf.json`의 `office-runtime/` 전체 리소스 매핑은 두 하위 디렉터리를 같은 리소스 트리에 복사하므로 변경이 필요하지 않다.

## 실제 명령과 결과

| 위치 | 명령 | 결과 |
| --- | --- | --- |
| `app/` | `pnpm run office:prepare` | arm64 기본 준비 성공, 136 Mach-O 정적 검증·inventory 통과 |
| `app/` | `pnpm run office:verify` | arm64 통과, symbolic links 0 |
| `app/` | `OFFICE_RUNTIME_TARGET=darwin-x64 pnpm run office:prepare` | 최종 성공, 134 Mach-O 정적 검증·inventory 통과, 실행 미수행 명시 |
| `app/` | `OFFICE_RUNTIME_TARGET=darwin-x64 pnpm run office:verify` | 최종 verifier로 통과, symbolic links 0, `not executed (cross-target)` |
| 저장소 | `node --test app/scripts/verify-office-runtime.test.mjs` | 최종 17/17 통과, skipped 0 |
| `app/` | `OFFICE_RUNTIME_ROOT="$PWD/apps/desktop/src-tauri/office-runtime/darwin-arm64" node --test apps/server/office-host/runtime.test.mjs` | 19/19 통과, skipped 0, 약 27.3초 |
| `app/apps/desktop/src-tauri/` | `CMAKE=/tmp/ib-build-tools/cmake/data/bin/cmake cargo check` | 1회 통과, 기존 `semantic_hits` dead_code warning |
| 같은 디렉터리 | `CMAKE=/tmp/ib-build-tools/cmake/data/bin/cmake cargo test --lib office_host::tests::runtime_directory_follows_the_running_slice` | 1/1 통과, 377 filtered |
| 저장소 | `git diff --check` | 통과 |
| 저장소 | `git diff --numstat -- app/pnpm-lock.yaml` | 출력 없음, lockfile 변경 없음 |

Cargo 두 명령은 시작 전 다른 cargo/rustc 프로세스가 없음을 확인하고 직렬로 실행했다. runtime 19개는 각자 새 임시 cluster만 사용하며 공유 개발 DB와 기존 `.env`를 사용하지 않았다. 마이그레이션 목록 대조·durable restart·LAN TLS·프로세스 실패/정리 경로를 실제 arm64 Node/Postgres로 확인했다. 번들에는 서버 병행 작업의 migration 070도 들어 있다. 이 보고서가 해당 병행 기능의 E2E까지 증명하지는 않는다.

첫 x64 prepare는 정적 검사 초안이 executable mode인 npm JSON/문서까지 Mach-O로 요구하여 실패했다. 실행 파일은 `file`로 실제 형식을 구별하고 native 파일은 architecture를 강제하도록 수정한 뒤 준비와 검증을 재실행해 통과했다. 첫 신규 unit 실행은 11/14 통과였으며 inline lockfile fixture parsing과 x86_64 Mach-O fixture의 CPU subtype을 고쳤다. 이후 14/14, optional 변형·universal 혼입·manifest target 회귀 시험 추가 후 최종 17/17 통과했다.

## 크기와 후속 제안

`du -sk`는 파일시스템 할당량이고 bytes는 모든 regular file 크기 합이다. manifest inventory 추가분은 대상당 약 5.27 MB다.

| 대상 | `du` 할당량 | 파일 bytes | 파일 크기 MiB | Node bytes | PostgreSQL bytes | server bytes |
| --- | --- | --- | --- | --- | --- | --- |
| darwin-arm64 | 631,368 KiB (616.57 MiB) | 570,992,482 | 544.54 | 112,925,600 | 295,868,132 | 156,765,212 |
| darwin-x64 | 464,276 KiB (453.39 MiB) | 404,572,372 | 385.83 | 115,419,824 | 146,932,592 | 136,786,532 |
| 합계 | 1,095,644 KiB (1,069.96 MiB) | 975,564,854 | 930.37 | | | |

합계는 예상했던 약 1.2 GB보다 작지만 배포 리소스로는 크다. PG upstream x64가 arm64보다 작고, cross deploy는 esbuild의 host postinstall 복사본을 만들지 않아 x64가 더 작다. installer 압축률과 실제 설치 후 크기를 구분해야 한다. 두 root를 `tar -czf /tmp/ib-office-runtimes-size-estimate.tgz darwin-arm64 darwin-x64`로 묶은 실제 gzip 측정은 **313,699,675 bytes (299.17 MiB)**였다. 이는 용량 추정용 아카이브이며 제품 리소스/런타임은 바꾸지 않았다.

승인 전에는 크기 최적화를 적용하지 않았다. 후속 후보는 (1) 대상별 압축 아카이브를 리소스로 넣고 검증된 사용자 전용 cache로 원자적 추출하되 서명/공증·동시 시작·복구 계약을 추가하는 안, (2) PG 개발/관리 도구·문서와 npm map/typings/테스트 중 제품이 사용하지 않는 항목을 usage audit와 19개 smoke test 이후 allowlist로 제외하는 안, (3) 두 대상의 공통 JS/SQL 파일 공유 구조로 바꾸고 native 모듈만 대상별로 분리하는 안이다. 현재의 심볼릭 링크 0 계약을 지키고 임의로 alias 라이브러리를 제거하지 않아야 한다.

## 검증하지 않은 범위

x64 Node/PostgreSQL/native addon 실행, x64 마이그레이션 적용과 실제 기동, Intel Mac, native Windows, universal Tauri 앱 빌드, 서명·공증·설치본의 nested code loading은 미검증이다. 기존 arm64 universal fsevents 보존과 x64 thinning 후의 배포 서명은 실제 installer 작업에서 확인해야 한다. UI 변경은 없었다. 커밋·푸시는 하지 않았다.
