# Project goal

## 한 줄 요약
`dali-ui-preview` CLI — DALi UI 코드(파일 / 코드 스니펫 / stdin)를 입력받아 **렌더된 PNG 이미지 + 구조화된 UI 트리**를 출력하는, 사람과 AI 에이전트 모두에게 최적의 정보를 주는 CLI 툴. 특히 **에이전트가 UI 코드를 작성 → 프리뷰로 검증 → 목표 디자인/사용자 요청에 맞을 때까지 재작성하는 루프**에 최적화. 추후 GitHub 릴리즈 목표.

## 추정 영역
- 도메인: 개발자 + AI 에이전트용 **CLI 툴** (UI 렌더링 · introspection)
- 핵심 제약:
  - 헤드리스 렌더 (Xvfb / offscreen) — DALi 런타임은 **Docker 컨테이너**(또는 native)에 존재
  - **결정론적 출력** (폰트 고정, 애니메이션 비활성, 메모리 주소 제거, 컬렉션 정렬) — 에이전트가 출력을 diff 할 수 있어야 함
  - **토큰 절약** (LLM 입력으로 트리가 수 KB 내; `--max-depth`/`--max-nodes`)
  - 기존 paperclip 인프라 **재사용** (하네스 템플릿, cppParser, Docker 런타임 이미지)
- 벤치마크 기준 (타 프레임워크 대비 부족하지 않을 것): `axe`(iOS, code→PNG stdout + view-tree 서브커맨드, Claude 플러그인), Playwright MCP(a11y 트리 + 안정 ref), Flutter golden / `debugDumpRenderTree`, Compose `ImageComposeScene`.

## 사용자가 명시한 out-of-scope
- VS Code 확장 **대체 아님** — 확장은 사람의 인터랙티브 개발용, CLI는 에이전트·자동화용. 인프라(하네스/파서/런타임)만 공유.
- **GUI 아님** — 순수 CLI.
- (그 외 명시적 out-of-scope 없음)

## 차별 기능 (사용자가 강조)
1. **검증 루프 지원**: 목표 디자인(레퍼런스 PNG)과 렌더 결과의 **이미지 diff**(pixelmatch) + **트리 diff** → 에이전트가 "내 수정이 목표에 가까워졌나"를 정량 판단.
2. **이미지 ↔ 트리 연결**: 두 출력을 **안정 ID**로 묶음(Set-of-Mark) — 트리에서 추론·타게팅, 같은 ID를 이미지에서 시각 검증.
3. **사람·AI 양쪽 최적 출력**: 사람용 박스드로잉 트리/리포트 + AI용 토큰 절약 JSON, 한 렌더에서.

## 기 완료 사전조사 (재조사 불필요)
- 크로스플랫폼 벤치마크 + DALi 정보 천장은 본 프로젝트 시작 전 4개 리서치 에이전트로 확보 → `research.md`로 정리.
- ⚠️ M0 스파이크로 결판낼 핵심 미지수: 헤드리스 컨테이너에서 `Accessibility::Accessible::DumpTree`(AT-SPI 브리지)가 D-Bus 없이 동작하는가 → 트리 스키마(의미 트리 공짜 vs 속성 재구성)를 좌우.
