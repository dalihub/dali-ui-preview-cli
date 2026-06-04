# Project profile (architect-finalized at P-3 end)

```yaml
# Finalized by architect (see docs/autoplan/architecture.md + adr/).
# Node/TS orchestrator CLI (ADR-001) that drives a vendored, extended C++
# harness (ADR-002/ADR-003/ADR-007) compiled+run INSIDE the fixed Docker
# runtime image. Both halves live in-repo: TS in out/, the harness template
# vendored under server/. Hence node-cli + cpp-native(harness).
project_types: [node-cli, cpp-native]

host_toolchain:
  node: v24.14.1
  npm: 11.11.0
  docker: 29.5.3            # runtime image present: ghcr.io/lwc0917/dali-preview-runtime (~1.19GB)
  gpp: 11.4.0              # Ubuntu g++
  python3: 3.10.12
  git: 2.34.1
  disk_free: 695G

runtime_model: >
  DALi 는 Docker 런타임 이미지 안(또는 native)에 존재. 렌더는 컨테이너 내부에서 헤드리스
  (Xvfb / offscreen). CLI 는 오케스트레이터: 입력 파싱 -> 컨테이너에서 프리뷰 빌드/렌더
  -> Capture PNG + actor/semantic 트리 덤프 -> 포맷(JSON 트리 / 박스 트리 / 이미지).
  결정론: 폰트 고정 + 애니메이션 비활성, 고정 이미지 안에서 렌더해 호스트 간 font/AA drift 회피.

reused_paperclip_infra:
  - ../server/preview_harness.cpp.template   # actor-tree walk(CollectActorMetadata) + Capture PNG + __tag(소스라인)
  - ../server/preview_server.cpp             # 장수 렌더 서버 (RENDER_JSON 경로)
  - ../src/cppParser.ts                      # DSL 소스 -> SceneNode 트리(type/properties/children/sourceLine)
  - ../src/flexMetadata.ts                   # 소스 + 런타임 트리 병합
  - DSL: dali-ui-foundation (Dali::Ui::View, Label, FlexLayout, UiColor) @ ../../dali-web/external/dali-ui

exec_test_tiers_available:   # architect-refined for the Node/TS + one-shot-harness stack; test-planner 가 마일스톤별로 구체화
  tier1: yes-after-M0   # PNG golden-image diff via pixelmatch+pngjs (ADR-005, already deps).
                        #   Unlocks once the M0 docker-run render path is green (F0.3); golden
                        #   determinism guaranteed by rendering inside the fixed image (Inv-4).
                        #   Pre-M0 it is "maybe" (depends on container render working at all).
  tier2: yes     # Run the CLI and assert on stdout JSON. PRIMARY tier: stdout JSON is the contract
                 #   (Inv-6). Includes the byte-identical-across-two-runs check (Inv-3 / F1.4:
                 #   `render twice | diff` == empty) and tree-diff/verdict exit-code assertions (M4).
  tier3: yes     # Unit (mocha + c8, lifted from sibling): vendored cppParser, formatters
                 #   (json/tree/report), tree-schema, idMap, imageDiff/treeDiff, errorParser, and
                 #   CLI smoke (--help lists flags+exit codes, --version, documented exit codes M5/F5.4).

infra_gaps:
  - "AT-SPI 접근성 브리지(Accessible::DumpTree)가 헤드리스 컨테이너에서 동작하는지 UNVERIFIED — M0 스파이크가 결판; 결과가 트리 스키마(의미 트리 공짜 vs 속성 재구성) 결정."
  - "GPU 없음 가정 — 컨테이너는 software/offscreen GL 사용; 결정론 위해 폰트 고정 + 애니메이션 비활성."
  - "golden-image 결정론: 호스트가 아니라 고정 Docker 이미지 안에서 렌더해 font/AA drift 회피."
  - "Docker 접근 권한: 사용자가 docker 실행 가능해야(확장은 setfacl 처리; CLI 는 docker 사용 가능 전제)."
```
