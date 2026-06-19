# dali-ui-preview-cli

Tizen DALi UI C++ 코드를 PNG **그리고** 구조화된 JSON 씬 트리(scene tree, 화면 요소들의 계층 구조)로 렌더링합니다 — AI 에이전트와 사람 모두를 위해 설계되었습니다.

[English](README.md) | **한국어**

## 무엇을 하나

DALi(Tizen의 동적 애니메이션 라이브러리)로 작성한 UI C++ 코드 조각을 Docker 컨테이너 안에서 헤드리스(headless, 화면 없이)로 렌더링한 뒤, 두 가지를 돌려줍니다: 실제 **PNG 스크린샷**과, 결정론적(deterministic, 같은 입력이면 항상 같은 출력)이고 기계가 읽을 수 있는 **UI 씬 트리**(각 노드의 id, 타입, 역할, 화면상 위치, 소스 줄 번호, 속성). 그런 다음 그 렌더 결과를 목표 이미지나 트리와 **대조(verify)**하고, 종료 코드(exit code)로 분기할 수 있습니다. `stdout`은 순수 JSON이라 에이전트의 파서에 그대로 넣을 수 있습니다.

## 왜

LLM 코딩 에이전트는 UI 코드를 작성할 수는 있지만, 그 결과가 제대로 보이는지 *볼* 수는 없습니다. `dali-ui-preview-cli`는 그 고리를 닫아줍니다. 에이전트는 **작성 → 렌더 → 비교 → 재작성** 루프를 돌리는데, 구조화된 트리(저렴하고 정확하며 diff 가능)를 먼저 읽고, 이미지(시각 확인용)를 그다음에 봅니다. 내 컴퓨터에 DALi SDK를 빌드할 필요가 없습니다 — Docker만 있으면 됩니다. 같은 루프는 터미널에서 레이아웃을 직접 눈으로 확인하는 사람에게도 똑같이 유용합니다.

## 사전 준비

- 현재 사용자가 쓸 수 있는 **Docker** (렌더 전 사전 점검에서 `docker info`를 실행합니다).
- **Node.js >= 18** (CLI 자체를 실행하기 위한 것뿐입니다).
- 런타임 이미지는 **첫 렌더 시 자동으로 받아집니다** (`ghcr.io/lwc0917/dali-preview-runtime`, 약 290 MB; DALi Toolkit + 화면 없는 렌더링용 Xvfb 포함).

> **VS Code 확장과 공유됩니다.** 이 CLI는 DALi Preview VS Code 확장과 *동일한* 런타임 이미지와 *동일한* 명명 볼륨(named volume, `dali-preview-ccache`, `dali-preview-shader-cache`)을 사용합니다. 이미 확장을 쓰고 있다면 이미지와 따뜻하게 데워진 빌드 캐시를 재사용하므로 — 추가 다운로드가 없고, 렌더가 더 빠르며, 이미지를 한 번만 갱신하면 두 도구 모두에 적용됩니다.

컨테이너는 렌더 경로에서만 필요합니다. `--version`, `--help`, `--list-versions`, 그리고 순수 트리/오버레이/diff 로직은 데몬이 살아 있지 않아도 됩니다.

## 설치

설치 없이 npx로 즉석 실행:

```bash
npx dali-ui-preview-cli <input.cpp> --image out.png
```

또는 소스에서:

```bash
git clone https://github.com/lwc0917/dali-ui-preview
cd dali-ui-preview
npm install
npm run build
node out/cli.js <input.cpp>
# 선택: `dali-ui-preview-cli`를 PATH에 노출
npm link
```

아래 예시는 모두 `dali-ui-preview-cli`를 사용합니다. 소스 체크아웃에서 실행할 때는 `node out/cli.js`로, 또는 `npx dali-ui-preview-cli`로 바꾸세요.

## 빠른 시작

프리뷰 파일을 렌더링하고 씬 트리를 출력합니다:

```bash
dali-ui-preview-cli samples/hello-dali.preview.dali.cpp
```

`stdout`은 한 줄짜리 JSON입니다(여기서는 보기 좋게 들여쓰고 일부를 줄였습니다):

```json
{
  "id": "0",
  "type": "Layer",
  "role": "panel",
  "name": "RootLayer",
  "mark": 1,
  "bounds": { "x": 0, "y": 0, "w": 1920, "h": 1080 },
  "children": [
    {
      "id": "0/1",
      "type": "FlexLayoutImpl",
      "role": "container",
      "mark": 3,
      "bounds": { "x": 0, "y": 0, "w": 1920, "h": 1080 },
      "sourceLine": 13,
      "flexProps": { "direction": "COLUMN", "alignItems": "CENTER", "justifyContent": "CENTER", "wrap": "NO_WRAP" },
      "children": [
        {
          "id": "0/1/0",
          "type": "LabelImpl",
          "role": "label",
          "text": "Hello, Dali!",
          "mark": 4,
          "bounds": { "x": 829, "y": 502, "w": 262, "h": 56 },
          "sourceLine": 21,
          "children": []
        },
        {
          "id": "0/1/1",
          "type": "LabelImpl",
          "role": "label",
          "text": "Edit this file to see the preview update",
          "mark": 5,
          "bounds": { "x": 787, "y": 558, "w": 346, "h": 20 },
          "sourceLine": 25,
          "children": []
        }
      ]
    }
  ],
  "meta": { "resolution": { "w": 1920, "h": 1080 }, "theme": "dark", "dpr": 1 }
}
```

(전체 트리에는 DALi가 끼워 넣는 넓이 0짜리 `CameraActor` 형제 노드 두 개도 포함됩니다. 라벨의 `name`은 비어 있고 — 화면에 보이는 글자는 `text`에 있습니다.)

스크린샷도 함께 저장:

```bash
dali-ui-preview-cli samples/hello-dali.preview.dali.cpp --image out.png
```

`--image`는 선택이며 stdout과 독립적입니다. PNG를 쓰지만 JSON은 바뀌지 않습니다.

## 입력 방식

프리뷰 코드는 세 가지 출처에서 올 수 있습니다(정확히 하나만 전달):

```bash
# 1. 파일 — *.preview.dali.cpp 파일, 또는
#    @dali-preview-begin / @dali-preview-end 마커로 영역을 표시한 일반 .cpp/.h 파일.
dali-ui-preview-cli samples/hello-dali.preview.dali.cpp

# 2. STDIN — `-` 위치 인자, 또는 그냥 파이프로 흘려보내기(위치 인자 없음).
cat samples/hello-dali.preview.dali.cpp | dali-ui-preview-cli
dali-ui-preview-cli - < samples/hello-dali.preview.dali.cpp

# 3. 인라인 — 명령줄에 직접 넘기는 코드 블록.
dali-ui-preview-cli --code 'return Label::New("Hello, Dali!");'
```

## 기능

아래 각 그룹은 라벨이 붙은 예시 하나씩입니다: 정확한 명령과 그 결과물. 대부분의 플래그는 조합 가능하며, 예외는 `--help`에 명시되어 있습니다.

### 주석이 달린 스크린샷 (Set-of-Mark) — `--overlay`

"Set-of-Mark"(요소마다 번호를 매겨 표시한) PNG를 씁니다. 각 노드에 트리의 `mark`와 일치하는 번호가 달린 자홍색 상자가 그려져서, 에이전트(또는 사람)가 컨트롤을 번호로 가리킬 수 있습니다.

```bash
dali-ui-preview-cli samples/hello-dali.preview.dali.cpp --overlay overlay.png
```

`#1 Layer`, `#3 FlexLayoutImpl`, `#4 "Hello, Dali!"`, `#5` 부제목 등으로 라벨이 붙은 상자가 그려진 `overlay.png`를 얻습니다. JSON 트리는 여전히 stdout으로 출력됩니다.

### 노드 찾기 — `--at` / `--node`

특정 픽셀에서 가장 위에 있는 노드 찾기:

```bash
dali-ui-preview-cli samples/hello-dali.preview.dali.cpp --at 500,290
```

```json
{ "id": "0/1/0", "mark": 4, "type": "LabelImpl", "role": "label", "bounds": { "x": 829, "y": 502, "w": 262, "h": 56 } }
```

또는 id로 노드의 영역 조회:

```bash
dali-ui-preview-cli samples/hello-dali.preview.dali.cpp --node 0/1/0
```

두 경우 모두 조회 JSON **만** 출력합니다(픽셀을 포함하는 가장 작은 상자가 우선). 둘은 함께 쓸 수 없습니다. 못 찾으면 `--at`은 `{ "at": [x,y], "node": null }`을, `--node`는 `null`을 출력합니다.

### 사람이 읽는 트리 — `--format tree`

```bash
dali-ui-preview-cli samples/hello-dali.preview.dali.cpp --format tree
```

```text
Layer "RootLayer" #1  [0]  (1920x1080 @ 0,0)
┠╴CameraActor "DefaultCamera" #2  [0/0]  (0x0 @ 960,540)
┠╴FlexLayoutImpl "" #3  [0/1]  (1920x1080 @ 0,0)
┃ ┠╴LabelImpl "" #4  [0/1/0]  (262x56 @ 829,502)
┃ ┖╴LabelImpl "" #5  [0/1/1]  (346x20 @ 787,558)
┖╴CameraActor "CaptureDefaultCamera" #6  [0/2]  (0x0 @ 960,540)
```

박스 트리 줄에는 액터의 `name`이 표시됩니다(라벨은 비어 있음). 화면에 보이는 글자는 JSON의 `text` 필드에 있습니다. `--format json`이 기본값입니다.

### 자체 완결 리포트 — `--report`

HTML 또는 Markdown 리포트(PNG 내장 + 박스 트리 + 노드 표)를 씁니다. JSON 트리는 여전히 stdout으로 출력되며, 파일 확장자가 형식을 결정합니다.

```bash
dali-ui-preview-cli samples/hello-dali.preview.dali.cpp --report report.html
dali-ui-preview-cli samples/hello-dali.preview.dali.cpp --report report.md
```

### 토큰 한도에 맞춰 출력 줄이기 — `--max-depth` / `--max-nodes`

stdout JSON을 에이전트의 컨텍스트 창에 맞게 잘라냅니다(`truncated` 표시로 잘린 지점을 알려줍니다):

```bash
dali-ui-preview-cli samples/hello-dali.preview.dali.cpp --max-depth 1
dali-ui-preview-cli samples/hello-dali.preview.dali.cpp --max-nodes 3
```

### 대조 루프 — `--baseline` / `--baseline-tree` / `--update-baseline`

에이전트 루프는 **작성 → 렌더 → 대조 → `$?`로 분기**입니다.

먼저, 정상이라고 확인된 렌더에서 기준선(baseline)을 잡습니다:

```bash
dali-ui-preview-cli good.cpp --update-baseline --baseline golden.png --baseline-tree golden.json
```

그런 다음 새 렌더를 기준선과 대조합니다. stdout은 한 줄짜리 판정(verdict)이 되고, 종료 코드는 **일치하면 0, 어긋나면 20**입니다(다른 코드는 여전히 도구 실패를 의미):

```bash
dali-ui-preview-cli candidate.cpp --baseline golden.png --baseline-tree golden.json
echo "exit: $?"
```

통과한 판정:

```json
{
  "match": true,
  "image": { "dimsMatch": true, "diffPixels": 0, "totalPixels": 614400, "ratio": 0, "pass": true },
  "tree": { "added": [], "removed": [], "changed": [] }
}
```

어긋난 판정(종료 코드 20) — 예: 어떤 노드의 위치가 움직인 경우:

```json
{
  "match": false,
  "image": { "dimsMatch": true, "diffPixels": 4673, "totalPixels": 614400, "ratio": 0.0076, "pass": false },
  "tree": { "added": [], "removed": [], "changed": [{ "id": "0/1/0", "fields": ["bounds"] }] }
}
```

한쪽 차원만 대조할 수도 있습니다(이미지만 보려면 `--baseline`, 트리만 보려면 `--baseline-tree`). `--threshold <ratio>`(기본값 `0.01`)는 이미지가 실패로 판정되기까지 허용되는 픽셀 차이 비율을 정하며, `--baseline`이 있어야 합니다.

### 렌더 설정 — `--resolution` / `--theme` / `--dpr`

```bash
dali-ui-preview-cli samples/hello-dali.preview.dali.cpp --resolution 800x480 --theme light --dpr 2
```

- `--resolution WxH` — 논리적 렌더 크기(기본값 `1920x1080`, TV FHD 프로파일).
- `--theme dark|light` — 배경 테마(기본값 `dark`).
- `--dpr N` — 장치 픽셀 비율(device-pixel ratio, 기본값 `1`); 실제 렌더는 `resolution × dpr` 장치 픽셀.

*실제 적용된* 논리 설정은 루트에 `root.meta = { resolution, theme, dpr }`로 반영됩니다.

### 실시간 재렌더 — `--watch`

입력 파일이 바뀔 때마다 다시 렌더링하고 다시 출력합니다(파일 입력에서만 — stdin이나 `--code`는 불가). 렌더당 한 번 출력하며, 중지는 Ctrl-C.

```bash
dali-ui-preview-cli samples/hello-dali.preview.dali.cpp --watch
```

## 런타임 버전 (DALi 릴리스)

렌더는 `ghcr.io/lwc0917/dali-preview-runtime`를 기준으로 실행됩니다. 이 이미지의 태그는 **DALi 릴리스**를 따라갑니다: 릴리스마다 `dali_<버전>` 태그 하나(예: `dali_2.5.18`)와, 굴러가는 `latest` 하나. 첫 렌더는 태그를 자동으로 받으며, 아래 명령들은 어떤 태그를 보유하고 사용할지를 관리합니다. 이미지와 캐시가 **VS Code 확장과 공유**되므로, 런타임을 한 번만 갱신하면 두 도구 모두에 적용됩니다.

사용 가능한 버전(원격 레지스트리 ∪ 로컬 저장소)을 JSON으로 나열 — 렌더하지 **않으며**, 종료 코드 0:

```bash
dali-ui-preview-cli --list-versions
```

```json
{
  "image": "ghcr.io/lwc0917/dali-preview-runtime",
  "current": "latest",
  "versions": [
    { "tag": "latest", "local": true, "current": true },
    { "tag": "dali_2.5.18", "local": false, "current": false }
  ]
}
```

특정 태그를 미리 받아두기(기본값 `latest`); docker의 진행 상황은 stderr로 흐르고, 그다음 `{"pulled":"<ref>","ok":true}` 한 줄이 stdout으로:

```bash
dali-ui-preview-cli --pull                 # :latest 받기
dali-ui-preview-cli --pull dali_2.5.18      # 특정 DALi 릴리스 받기
```

*이번* 렌더에서만 특정 DALi 버전으로 렌더하려면 `--image-tag`:

```bash
dali-ui-preview-cli samples/hello-dali.preview.dali.cpp --image-tag dali_2.5.18
```

고급: `--runtime-image <name>`은 이미지 이름 자체를 덮어씁니다(예: 사설 미러). `--list-versions` / `--pull`은 입력을 받지 않으며 렌더·대조 플래그와 함께 쓸 수 없습니다.

## JSON 노드 스키마

트리의 모든 노드는 이 형태를 가집니다(일부 필드는 최선 노력(best-effort)이라 없을 수도 있습니다):

| 필드 | 타입 | 의미 |
|---|---|---|
| `id` | string | 안정적인 구조 경로(자식 인덱스), 예: `"0/1/0"`. |
| `mark` | number | 1부터 시작하는 순번; `--overlay`에 그려지는 번호. |
| `type` | string | 구체적인 DALi 타입, 예: `"LabelImpl"`, `"FlexLayoutImpl"`, `"Layer"`. |
| `role` | string | 의미적 역할, 예: `"label"`, `"container"`, `"panel"`. |
| `name` | string | 액터 이름(보통 비어 있음; 루트는 `"RootLayer"`). 라벨의 화면 글자는 여기가 아니라 `text`에 있음. |
| `text` | string | 텍스트 컨트롤(Label / InputField)에 보이는 글자. 글자가 비어 있지 않을 때만 존재. |
| `bounds` | `{x,y,w,h}` | 이미지 픽셀 기준 화면상 상자(`CalculateCurrentScreenExtents`로 계산). |
| `sourceLine` | number | 노드가 매핑되는 소스의 1부터 시작하는 줄 번호(해석 가능할 때). |
| `semanticsSource` | string | `"bridge"` 또는 `"reconstructed"` — 의미 정보의 출처. |
| `visible` | boolean | 액터의 `VISIBLE` 속성. |
| `opacity` | number | 액터의 `OPACITY` (0..1). |
| `properties` | object | 노드의 내보낸 DALi 속성, 예: `{ "textColor": [r,g,b,a] }`. |
| `flexProps` | object | flex 컨테이너에 존재: 해석된 flex 레이아웃, 예: `{ "direction": "COLUMN", "alignItems": "CENTER", "justifyContent": "CENTER", "wrap": "NO_WRAP" }`. |
| `children` | node[] | 자식 노드, 자식 인덱스 순서. |

**루트** 노드는 추가로 `meta`를 가집니다:

```json
"meta": { "resolution": { "w": 1920, "h": 1080 }, "theme": "dark", "dpr": 1 }
```

참고: DALi는 내부 `CameraActor` 형제 노드(넓이 0짜리 상자)를 끼워 넣습니다. `--at`/`--node`는 퇴화한 상자를 무시하므로, 카메라는 픽셀 조회에 절대 걸리지 않습니다.

## 종료 코드

| 코드 | 의미 |
|---|---|
| `0` | 성공(대조에서 일치한 판정 포함). |
| `1` | 사용법 오류 또는 빈 입력. |
| `10` | 코드의 컴파일 오류. |
| `11` | 렌더 / 캡처 오류. |
| `12` | Docker 사용 불가(`docker info` 사전 점검 실패). |
| `20` | 대조 불일치(렌더는 됐지만 기준선과 어긋남). |

컴파일/렌더 실패 시, 구조화된 `{ "phase", "message", "sourceLine" }` JSON이 **stderr**로 출력됩니다(stdout은 비어 있음), 예:

```json
{ "phase": "compile", "message": "'Banana' has not been declared", "sourceLine": 13 }
```

## AI 에이전트를 위해

- **stdout이 기계 계약입니다.** 기본 렌더는 전체 트리 JSON을, `--format tree`는 박스 트리를, `--at`/`--node`는 조회 객체 하나를, 대조 모드는 판정 객체 하나를, `--list-versions`/`--pull`은 관리 객체 하나를 출력합니다. 호출당 정확히 한 번 출력.
- **stderr는 진단용**이며, 구조화된 컴파일/렌더 오류 `{phase, message, sourceLine}`도 여기로 갑니다. stdout을 파싱하고, 종료 코드를 지켜보며, 실패할 때만 stderr를 읽으세요.
- **결정론적입니다.** 같은 입력은 바이트 단위로 동일한 JSON을 렌더하므로, 트리 diff가 의미를 가지고 `--baseline-tree` 비교가 정확합니다.
- **토큰 한도.** `--max-depth` / `--max-nodes`로 트리를 컨텍스트 창 안에 유지하세요.
- **분기 가능한 종료 코드.** "도구가 실패"(1/10/11/12)와 "렌더는 됐지만 다름"(20)을 텍스트 파싱 없이 구분 — 작성→렌더→대조 루프에 이상적입니다.
- **향후 선택지:** CLI를 MCP 서버(Claude/Cursor 같은 에이전트에 도구를 노출하는 프로세스)로 감싸면, 에이전트가 셸을 거치지 않고 `render_preview(code)`를 직접 호출할 수 있습니다.

## 라이선스

Apache-2.0.
