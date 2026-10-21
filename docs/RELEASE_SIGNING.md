# 설치 파일 빌드: 서명·공증과 로컬 릴리스

Infinite Brain 설치 파일(macOS `.dmg`, Windows `.exe`)을 이 Mac에서 만들고, macOS 버전은 Apple 서명·공증·스테이플까지 마치는 절차입니다. 처음 한 번만 하는 **준비(1~4)**와 릴리스마다 반복하는 **빌드·배포(5~7)**로 나뉩니다.

GitHub Actions로 내보내는 방법은 [`RELEASE.md`](RELEASE.md)에 있습니다. 이 문서는 같은 결과를 로컬에서 만드는 경로입니다. Actions에 Apple 시크릿을 아직 넣지 않았을 때, 또는 직접 확인하고 올리고 싶을 때 씁니다.

> 이 문서에는 비밀값을 적지 않습니다. Key ID, Issuer ID, `.p8`, 인증서 암호, 업데이터 키는 키체인과 `~/.infinite-brain/`에만 둡니다.

## 왜 필요한가

| 단계 | 하지 않으면 | 하면 |
|---|---|---|
| **서명(Developer ID)** | macOS가 "확인되지 않은 개발자"라며 실행을 막는다 | 누가 만든 앱인지 증명된다 |
| **공증(Notarization)** | 서명이 있어도 "악성 소프트웨어를 확인할 수 없음" 경고가 뜬다 | 더블클릭으로 바로 열린다 |
| **스테이플** | 처음 열 때 인터넷으로 공증을 확인한다 | 오프라인에서도 경고 없이 열린다 |
| **업데이터 서명(minisign)** | 앱 안 자동 업데이트가 설치 파일을 거부한다 | 기존 사용자에게 새 버전이 자동으로 간다 |

## 준비물

- 유료 Apple Developer 계정. 개인 팀 **SangWook Park(Team ID `QRW9X3848W`)**을 쓴다.
- Xcode와 Command Line Tools(`xcrun notarytool`, `stapler`)
- Rust, Node 22 이상, pnpm, CMake(`brew install cmake`; macOS의 스마트 검색 엔진을 빌드할 때 필요). Windows 크로스 빌드용으로 다음도 설치한다.
  ```sh
  rustup target add aarch64-apple-darwin x86_64-apple-darwin x86_64-pc-windows-msvc
  brew install cmake llvm nsis
  cargo install cargo-xwin --locked
  ```

macOS 빌드는 고정된 Git 커밋의 `llama-cpp-rs`와 그 llama.cpp 서브모듈을 가져옵니다. 새 Mac에서 처음 빌드하면 약 300 MB를 내려받을 수 있으며, 이후 Cargo 캐시를 재사용하면 다운로드를 줄일 수 있습니다.

---

## 1. Developer ID Application 인증서 (최초 1회)

Xcode → Settings → Apple Accounts → 팀 선택 → **Manage Certificates…** → `+` → **Developer ID Application**.

```sh
security find-identity -v -p codesigning | grep "Developer ID Application"
# "Developer ID Application: SangWook Park (QRW9X3848W)"
```

AxDB(db-tool)와 같은 팀 인증서를 그대로 쓴다. 이미 키체인에 있으면 이 단계는 건너뛴다.

## 2. 공증 자격 증명 (최초 1회)

App Store Connect → 사용자 및 액세스 → 통합 → App Store Connect API → 팀 키에서 **Developer** 권한 키를 만들고 `.p8`을 받는다. 그다음 키체인 프로필로 저장한다.

```sh
xcrun notarytool store-credentials axdb-notary \
  --key ~/Downloads/AuthKey_<KEY_ID>.p8 --key-id <KEY_ID> --issuer <ISSUER_ID>
xcrun notarytool history --keychain-profile axdb-notary   # 확인
```

API 키는 앱이 아니라 팀 단위라서 AxDB에서 만든 `axdb-notary` 프로필을 그대로 쓴다. 다른 이름으로 저장했다면 빌드할 때 `NOTARY_PROFILE=<이름>`을 넘긴다.

## 3. 업데이터 서명 키 (최초 1회, 이미 되어 있음)

`~/.infinite-brain/updater.key`(비밀번호 걸림), `updater.key.password`, `updater.key.pub`. 공개키는 `app/apps/desktop/src-tauri/tauri.conf.json`의 `plugins.updater.pubkey`와 같아야 한다. 빌드 스크립트가 시작할 때 둘을 비교하고, 다르면 멈춘다.

**이 키를 잃어버리면 이미 설치한 사용자에게 업데이트를 보낼 수 없다.** 암호 관리자에도 사본을 둔다.

## 4. Windows 코드 서명 (선택)

지금은 서명하지 않는다. 처음 실행하면 SmartScreen이 "인식할 수 없는 앱"이라고 경고하고, 사용자는 **추가 정보 → 실행**을 누른다. 경고를 없애려면 OV/EV 코드 서명 인증서를 사서 `bundle > windows > signCommand`에 연결한다.

---

## 5. 버전 올리기 (릴리스마다)

네 곳이 같아야 한다.

| 파일 | 키 |
|---|---|
| `app/apps/desktop/src-tauri/tauri.conf.json` | `"version"` |
| `app/apps/desktop/package.json` | `"version"` |
| `app/apps/desktop/src-tauri/Cargo.toml` | `version` |
| `app/apps/desktop/src-tauri/Cargo.lock` | `desktop` 패키지의 `version` |

사용자에게 보일 변경 사항은 `docs/RELEASE_NOTES.md`의 `## <버전>` 섹션에 쓴다. 섹션이 없으면 조용한 업데이트가 된다.

## Office runtime 포함 빌드의 서명·공증

Office runtime이 포함된 `.app`을 직접 서명할 때는 다음 스크립트를 사용한다. 앱 내부의 실행 파일·동적 라이브러리 서명을 확인하고, 누락되거나 조건에 맞지 않는 Mach-O를 hardened runtime과 타임스탬프를 넣어 서명한다. 기본 Developer ID는 `Developer ID Application: SangWook Park (QRW9X3848W)`이며 `APPLE_SIGNING_IDENTITY`로 바꿀 수 있다.

```sh
app/scripts/sign-office-app.sh \
  "app/apps/desktop/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Infinite Brain.app" \
  "dist/office/Infinite-Brain-office.dmg"
```

먼저 서명 대상과 기존 entitlement 상태만 확인하려면, 원본을 복사해 dry-run 한다. `DRY_RUN=1`은 검사만 하며 서명하거나 DMG를 만들지 않는다.

```sh
cp -R "Infinite Brain.app" "/tmp/Infinite Brain dry-run.app"
DRY_RUN=1 app/scripts/sign-office-app.sh \
  "/tmp/Infinite Brain dry-run.app" "/tmp/office-dry-run.dmg"
```

`Contents/Resources/office-runtime/*/node`는 `get-task-allow` 없이 `allow-jit`와 `allow-unsigned-executable-memory`만 담은 entitlement로 다시 서명하고, 서명 뒤 `node -e` 실행을 확인한다. 개발 디버깅 entitlement인 `get-task-allow`는 공증에서 거부되므로, 스크립트는 마지막에 앱 안 모든 Mach-O를 검사해 남아 있으면 실패한다. 최상위 앱 entitlement는 기존 값을 추출해 보존하고, 앱은 `codesign --verify --deep --strict`로 확인한다. DMG에는 앱과 `/Applications` 링크가 들어가며 DMG 자체도 서명된다.

공증 제출은 별도 단계다. 스크립트는 제출하지 않는다. 서명된 DMG를 제출하고 결과가 나올 때까지 기다린다. `--wait`를 임의의 짧은 시간 제한으로 바꾸지 않는다.

```sh
xcrun notarytool submit "dist/office/Infinite-Brain-office.dmg" \
  --keychain-profile axdb-notary --wait
xcrun stapler staple "dist/office/Infinite-Brain-office.dmg"
xcrun stapler validate "dist/office/Infinite-Brain-office.dmg"
```

## 6. 빌드

```sh
scripts/build-installers.sh          # macOS + Windows
scripts/build-installers.sh mac      # .dmg만
scripts/build-installers.sh win      # .exe만
```

스크립트가 하는 일:

1. 업데이터 키와 `tauri.conf.json` 공개키가 같은지 확인한다
2. **macOS:** universal(Apple Silicon + Intel) `.app`과 `.dmg`를 만들고 Developer ID로 hardened runtime 서명을 한다 → 서명을 `codesign`으로 확인한다 → `notarytool submit --wait`로 공증한다 → `stapler staple`·`validate`·`spctl`로 확인한다
3. **Windows:** `cargo-xwin`으로 크로스 컴파일하고 NSIS `*-setup.exe`를 만든다(WebView2가 없는 PC에서는 설치 중에 내려받는다)
4. 결과와 업데이터 번들(`.app.tar.gz`, `.sig`), `SHA256SUMS.txt`를 `dist/<버전>/`에 모은다

공증만 건너뛰려면 `SKIP_NOTARIZE=1`을 붙인다. 서명은 하지만 처음 실행할 때 경고가 뜬다.

## 7. 배포와 앱 안 업데이트

```sh
scripts/publish-release.sh          # 미리 보기: latest.json과 올릴 파일 목록만 출력
scripts/publish-release.sh --yes    # GitHub Release v<버전> 생성 (즉시 공개)
```

스크립트가 하는 일:

1. `dist/<버전>/`의 `.dmg`, 업데이터 번들(`.app.tar.gz`), `setup.exe`와 각각의 `.sig`를 모은다. 공증·스테이플이 안 된 `.dmg`는 거부한다(`ALLOW_UNNOTARIZED=1`로 우회)
2. 파일 이름의 공백을 `-`로 바꾼다. GitHub가 공백을 `.`으로 바꿔 `latest.json`의 URL과 어긋나는 것을 막기 위해서다
3. `docs/RELEASE_NOTES.md`의 `## <버전>` 섹션을 릴리스 본문과 `latest.json`의 `notes`에 넣는다. 섹션이 없으면 조용한 업데이트 표시를 넣는다
4. `latest.json`을 만든다. macOS는 universal 번들 하나로 `darwin-aarch64`·`darwin-x86_64`를 모두 채우고, Windows는 `setup.exe`로 `windows-x86_64`를 채운다
5. 같은 태그가 이미 있으면 멈춘다(출시된 버전은 덮어쓰지 않는다)

**올라간 뒤 사용자 쪽에서 일어나는 일:** 설치된 앱은 켤 때와 15분마다 `releases/latest/download/latest.json`을 확인한다. 새 버전이 있으면 백그라운드에서 내려받아 서명을 검증하고 설치한다. 사용자가 잠시 쉬는 순간에 재시작하고, 다음 실행 때 What's New 창에 그 버전의 노트를 보여 준다. 계정 메뉴와 설정 → About의 **Check for updates**로 바로 받을 수도 있다.

받는 사람은 GitHub Releases에서 OS에 맞는 파일을 내려받는다. macOS는 `.dmg`를 열어 **Infinite Brain**을 응용 프로그램 폴더로 끌어 놓고, Windows는 `setup.exe`를 실행한다.

---

## 문제 해결

| 증상 | 원인 | 해결 |
|---|---|---|
| `no Developer ID Application identity` | 인증서가 없거나 개인 키가 다른 Mac에 있음 | 1단계. 원래 Mac에서 `.p12`로 내보내 가져온다 |
| `updater key does not match` | 키를 바꾸고 `tauri.conf.json` 공개키를 안 바꿈(또는 반대) | `updater.key.pub` 내용을 `pubkey`에 넣는다 |
| 공증 `Invalid` | hardened runtime 없이 서명했거나 서명 뒤에 파일이 바뀜 | `xcrun notarytool log <ID> --keychain-profile axdb-notary`로 원인을 확인한다 |
| `notarytool` 401 | 프로필의 API 키가 취소됨 | 2단계를 새 키로 다시 한다 |
| 내려받은 `.dmg`가 "손상됨" | 스테이플이 빠졌거나 서명 뒤에 수정됨 | 6단계를 처음부터 다시 실행한다 |
| `vite:prepare-out-dir ENOTEMPTY` 로 빌드가 멈춘다 | mac과 win 빌드를 동시에 돌려 같은 `app/apps/desktop/dist`를 서로 지움 | 하나가 끝난 뒤에 다른 하나를 돌린다(`all`은 순서대로 돈다) |
| Windows 빌드가 링크 단계에서 실패 | llvm 경로가 없음 | `brew install llvm`. 스크립트가 `$(brew --prefix llvm)/bin`을 `PATH`에 넣는다 |
| 앱이 키체인 접근 허용을 계속 묻는다 | ad-hoc 서명 빌드라 실행할 때마다 코드 식별자가 바뀜 | Developer ID로 서명한 빌드를 쓴다 |

## 보안 수칙

- `.p8`, 인증서 암호, 업데이터 키·비밀번호를 명령 인자, 채팅, 커밋에 남기지 않는다. 노출됐다면 즉시 폐기하고 다시 발급한다.
- 공증 자격 증명은 키체인 프로필로만 참조한다.
- `dist/`는 `.gitignore`에 들어 있다. 설치 파일을 저장소에 커밋하지 않는다.
