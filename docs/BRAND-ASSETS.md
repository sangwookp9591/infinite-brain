# Infinite Brain 브랜드 자산

원본 SVG는 `app/apps/desktop/src/assets/brand/infinite-brain-icon.svg`이다. 남색 바탕의 무한 궤도와 별은 이 포크에서 직접 그린 Apache-2.0 자산이다. 기존 Baalda 아이콘·워드마크 이미지와 내장 data URI는 제거했다.

아이콘을 재생성하려면 `app/`에서 다음 명령을 실행한다.

```sh
pnpm --filter desktop tauri icon src/assets/brand/infinite-brain-icon.svg --png 1024 --output /tmp/ib-icon-source
pnpm --filter desktop tauri icon /tmp/ib-icon-source/1024x1024.png
```

데스크톱 대상이므로 생성된 `icons/android`와 `icons/ios`는 배포하지 않는다. `public/infinite-brain-icon.png`는 128px 아이콘이고, 서버 site icon 및 Rust loopback 페이지는 같은 PNG를 base64로 내장한다. 서버 동의 페이지의 워드마크는 새 silver SVG를 내장한다. 자산을 수정하면 이 내장 값도 갱신하고 `node --test scripts/rebrand.test.mjs`, `node scripts/rebrand.mjs --dry-run`을 실행한다. 리브랜드 검사는 원본 이미지 해시가 추적된 이미지 파일에 다시 나타나면 실패한다.

식별자는 `com.infinitebrain.desktop`이며 staging은 `.staging`을 덧붙인다. 개발 설정은 기본 identifier를 상속하고 딥링크 스킴만 `infinitebrain-dev`로 바꾼다. 배포 전 변경이므로 이전 포크의 로컬 개발 keychain/app-data는 자동으로 옮기지 않는다.
