# Research — `dali-ui-preview` CLI (code → PNG + UI tree, for humans & AI agents)

> 본 프로젝트 시작 전 4개 리서치 에이전트(모바일 네이티브 / 웹+a11y / 크로스플랫폼·씬그래프 / AI-에이전트 인지)로 확보한 발견을 정리. 재조사 불필요. 결정은 내리지 않음 — architect 입력용.

## Similar solutions

| Name | URL | Trade-off / 핵심 |
|---|---|---|
| **axe** (k-kohey, iOS) | https://github.com/k-kohey/axe | **가장 근접한 선행 제품**: `code → PNG(stdout)` + `axe view`(뷰계층 텍스트) 형제 커맨드, `report`(MD/HTML 일괄), Claude Code 플러그인 동봉. 약점: 테마를 소스(`#Preview`)에 가둠, 고정 10초 대기, LLDB/idb 등 비공개·디버그 훅 의존(취약). |
| **Playwright MCP** (Microsoft) | https://github.com/microsoft/playwright-mcp | LLM에 **픽셀 대신 접근성 트리**를 먹임. 노드마다 안정 `ref=e5`. 스냅샷 ~200–400 토큰 vs 스크린샷 ~3–5k. "act on the snapshot, not the screenshot." canvas/직접렌더는 예외(→이미지 필요). |
| **swift-snapshot-testing** (Point-Free) | https://github.com/pointfreeco/swift-snapshot-testing | 같은 객체에서 `.image` + `.recursiveDescription`(텍스트 트리)를 **전략**으로 동시 산출 → 둘이 어긋날 수 없음. `.dump`은 주소 제거·정렬로 결정론. |
| **Paparazzi** (Cash App) | https://github.com/cashapp/paparazzi | 소스에서 에뮬레이터 없이 PNG(layoutlib). 교훈(피할 것): a11y 트리를 **PNG 픽셀에 구워넣음** → 파싱 불가. 우리는 텍스트로 분리. |
| **Flutter** golden + `debugDumpRenderTree` | https://api.flutter.dev/flutter/flutter_test/matchesGoldenFile.html | DALi의 가장 가까운 사촌(리테인드모드). `flutter test`로 앱 실행 없이 코드→PNG; 트리 덤프에 `creator: A ← B ← C` **소스 출처 체인**. 고정 800×600@DPR3. |
| **Compose `ImageComposeScene`** | https://developer.android.com/develop/ui/compose | `Scene(w,h,density){ Content }.render()` — 창 없는 오프스크린 렌더의 이상적 API 형태. |
| **uiautomator dump** (Android) | https://developer.android.com/training/testing/other-components/ui-automator | 라이브 화면 → XML 트리: `bounds="[x1,y1][x2,y2]"`, class, text, content-desc, clickable. 자동화 업계 표준 필드셋(단 XML은 토큰 낭비 → JSON). |
| **Set-of-Mark prompting** (MS Research) | https://arxiv.org/abs/2310.11441 | 이미지에 번호표 → AI가 좌표 대신 ID로 가리킴. GPT-4V grounding **25.7% → 86.4%**. 이미지↔트리를 공유 ID로 묶는 근거. |
| **jest-image-snapshot / pixelmatch** | https://github.com/americanexpress/jest-image-snapshot | 픽셀 diff + `failureThreshold`. 검증 루프(목표 PNG 대비)에 그대로 사용 가능(paperclip에 pixelmatch 이미 의존). |

> 결론: 어느 플랫폼도 "코드 → 이미지+트리"를 **1차(first-party) 턴키 CLI**로 팔지 않음. axe가 가장 근접하나 iOS 전용 + 비공개 훅 의존. **빈 자리이며, DALi-CLI는 DALi에 1차라 안정성에서 우위.**

## Dominant patterns
- **트리 우선 + 이미지 보조, 공유 안정 ID로 연결**(Set-of-Mark). 트리=구조/타게팅/저렴, 이미지=시각/테마/겹침.
- **한 번의 렌더에서 두 출력**(swift-snapshot "strategies") → 이미지/트리가 드리프트 불가.
- **결정론**: 폰트 고정 · 애니메이션 비활성 · 주소 제거 · 컬렉션 정렬(swift `.dump`, Flutter golden 규율).
- **stdout JSON 1차 계약, 이미지는 플래그로 on-demand**; 토큰 상한(`--max-depth`/`--max-nodes`).
- **설정을 CLI 플래그로**(resolution/theme/dpr) + 결과 메타에 echo(axe 약점 뒤집기).
- **baseline/compare 모드**(golden) — 에이전트 자가 점검 루프.
- **일반 속성 열거로 전부 덤프**(`GetPropertyIndices`) + **접근성 트리로 의미** 보강.

## Pitfalls (cite URLs)
- 트리를 **픽셀에 구워넣기**(Paparazzi accessibility) — 텍스트로 분리할 것. https://cashapp.github.io/paparazzi/accessibility/
- **print-only 트리 덤프**(Godot proposal #6288) — 문자열 반환/파일 출력. https://github.com/godotengine/godot/pull/50346
- **이름만, 타입 누락**(Godot가 버그로 학습) — 항상 `Name <Type#id>`.
- **테마를 소스에 가둠**(axe) — 플래그로 노출.
- **golden flakiness**: 폰트/AA/호스트 drift(Flutter goldens 통념) — 고정 Docker 이미지 안에서 렌더 + 폰트 번들.
- **a11y 트리는 브리지/D-Bus 의존** — 헤드리스에서 안 뜰 수 있음(⚠️ 본 프로젝트 M0 최대 리스크). 우회: `DevelControl::ACCESSIBILITY_*` + 컨트롤별 기본 role + 콘텐츠 속성으로 의미 재구성.
- **좌표 손계산 취약**(현 하네스 parentOrigin/anchor 수식) — `DevelActor::CalculateCurrentScreenExtents`로 교체.

## DALi 정보 천장 (헤더 확인됨 — architect/test-planner 입력)
- 일반 덤프: `Handle::GetPropertyIndices()` + `GetCurrentProperty()`(Actor+Control+TextLabel 전 속성 자동: text, fontFamily, background, padding…). 값 stringify: `integration-api/stream-operators.h`(raw Vector는 Property::Value로 감싸야).
- ⭐ 정확 좌표: `DevelActor::CalculateCurrentScreenExtents(actor)` → 렌더 프레임 일치 {x,y,w,h}. + WORLD_*, CULLED, `IsEffectivelyVisible`, `SIBLING_ORDER`(z).
- 구체 타입: `BaseHandle::GetTypeName()`("" → "Actor" 폴백).
- ⭐ 의미 트리(거의 공짜, **단 브리지 동작 시**): `Accessibility::Accessible::Get(actor)->DumpTree(DUMP_FULL)` → 노드당 {role, name, states, value, type, automationId, x/y/w/h, children}. Label/Button/Entry/Slider는 role+name+value 자동. Role enum ~130, State enum ~47.
- 좌표↔노드: `HitTestAlgorithm::HitTest`, `Accessible::GetInternalActor()` (양방향 — click-to-code / Set-of-Mark).
- 한계: 글자 줄바꿈/글리프 기하 비공개(→이미지로); 비주얼은 Property::Map 안.

## Candidate stack (decision NOT made — for architect's choice)
- **CLI 언어/런타임**: Node/TypeScript(기존 `cppParser.ts`·확장코드 재사용, npx 배포, AI 설치 친화) | Go(단일 정적 바이너리) | Rust(단일 바이너리) | Python(빠르나 배포 무거움).
- **렌더 백엔드(재사용)**: 기존 `preview_harness.cpp.template` + `Capture`(컨테이너 내) | 장수 `preview_server.cpp`(RENDER_JSON, 빠름) | native DALi 직접.
- **트리 추출**: `CollectActorMetadata` 확장(일반 열거 + CalculateCurrentScreenExtents) | `Accessible::DumpTree`(헤드리스 동작 시).
- **이미지 diff**: pixelmatch + pngjs(이미 의존) | odiff. **트리 diff**: 커스텀 JSON diff | deep-diff.
- **출력 포맷**: 기계용 JSON + 사람용 박스드로잉(`┖╴`) 트리 + HTML/MD 리포트.
- **배포**: npm 패키지(npx) | GitHub Releases 프리빌트 바이너리 | Docker 래핑.
- **테스트**: 단위(파서/포매터/스키마) | golden PNG(pixelmatch) | CLI 스모크(exit code/--help).

---

## Self-Review
- Placeholder scan: none — 모든 섹션 채움. (a11y 헤드리스 동작은 의도된 미지수로, M0 스파이크로 표기됨; TBD 아님.)
- Internal consistency: 일관 — "트리 우선+이미지 보조+공유 ID" 패턴이 goal의 차별기능(이미지/트리 diff, Set-of-Mark)과 정합. DALi 천장이 candidate stack의 "트리 추출" 선택지를 뒷받침.
- Scope check: within range — research는 발견만, 결정 없음(언어/백엔드/diff 모두 후보 나열). architect가 P-3에서 선택.
- Ambiguity: none unresolved. 단 architect/test-planner가 알아야 할 OPEN: 헤드리스 `DumpTree` 동작 여부(트리 스키마 분기) — M0 스파이크가 1순위로 해소하도록 plan에 반영 권고.
