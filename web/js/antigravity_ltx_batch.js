import { app } from "../../../scripts/app.js";

// 동적으로 CSS 스타일시트를 헤더에 주입하여 로딩 순서 보장
const styleLink = document.createElement("link");
styleLink.rel = "stylesheet";
styleLink.href = new URL("../css/antigravity_ltx_batch.css", import.meta.url).href;
document.head.appendChild(styleLink);

// 🛠️ 도움용 유틸리티: JSON 텍스트에서 안전하게 // 와 /* */ 주석 제거
function cleanJsonComments(jsonStr) {
  let cleaned = jsonStr.replace(/\/\*[\s\S]*?\*\//g, ""); // 블록 주석 제거
  let lines = cleaned.split("\n");
  let finalLines = lines.map(line => {
    // http:// 이나 https:// 같은 URL 내부 주석 표시는 살려두고 // 주석만 지움
    return line.replace(/(?<!:)\/\/.*$/, "");
  });
  return finalLines.join("\n");
}

// ==============================================================================
// 🎭 실전 립싱크 MV 프로덕션용 지능형 프리셋 정의
// ==============================================================================
const CAMERA_PRESETS = [
  { label: "🔍 초클로즈업", value: "extreme close-up shot", keywords: ["extreme close-up", "extreme closeup", "extreme close up"] },
  { label: "📸 클로즈업", value: "closeup shot", keywords: ["closeup", "close-up", "close up"] },
  { label: "🧍 바스트/미디엄", value: "medium shot", keywords: ["medium shot", "medium closeup", "bust shot"] },
  { label: "🚶 전신/풀샷", value: "full shot", keywords: ["full shot", "wide shot"] },
  { label: "🎬 느린 줌인", value: "slow zoom in", keywords: ["zoom in", "slowly zooming in"] },
  { label: "🎬 느린 줌아웃", value: "slow zoom out", keywords: ["zoom out", "slowly zooming out"] },
  { label: "↔️ 왼쪽 패닝", value: "slow pan left", keywords: ["pan left", "panning left"] },
  { label: "↔️ 오른쪽 패닝", value: "slow pan right", keywords: ["pan right", "panning right"] },
  { label: "🔒 고정카메라", value: "static camera", keywords: ["static camera", "camera static", "locked shot"] }
];

const EMOTION_PRESETS = [
  { label: "🎵 눈감고 허밍", value: "eyes closed humming", keywords: ["eyes closed", "humming", "closed eyes"] },
  { label: "😊 부드러운 미소", value: "gently smiling", keywords: ["smile", "smiling", "gently smile", "natural smile"] },
  { label: "😢 깊은 슬픔", value: "profound sadness", keywords: ["sad", "sadness", "sorrow", "grief", "sad expression"] },
  { label: "💖 자애로운 시선", value: "compassionate gaze", keywords: ["compassionate", "kind look", "warm gaze", "compassionate gaze"] },
  { label: "😭 눈물 글썽", value: "crying with tears", keywords: ["cry", "crying", "tears"] },
  { label: "🎤 열창/노래", value: "singing with passion", keywords: ["singing", "sing", "passionately singing"] }
];

// 💡 프롬프트 치환 엔진: 기존 프리셋 단어가 있으면 그 단어만 교체하고, 없으면 새로 쉼표 구분선 뒤에 삽입합니다!
function updatePromptWithPreset(currentPrompt, presetGroup, targetValue) {
  let prompt = currentPrompt.trim();
  let found = false;

  for (const preset of presetGroup) {
    for (const kw of preset.keywords) {
      // 단어 경계를 완벽히 지키는 정규식으로 안전 교체
      const escapedKw = kw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`\\b${escapedKw}\\b`, 'gi');
      
      if (regex.test(prompt)) {
        prompt = prompt.replace(regex, targetValue);
        found = true;
        break;
      }
    }
    if (found) break;
  }

  if (!found) {
    if (prompt) {
      prompt += `, ${targetValue}`;
    } else {
      prompt = targetValue;
    }
  }

  // 중복 쉼표 제거 정제 로직
  prompt = prompt.replace(/\s*,\s*,\s*/g, ', ');
  prompt = prompt.replace(/^[,\s]+|[,\s]+$/g, '');

  return prompt;
}

app.registerExtension({
  name: "Antigravity.LTXBatchManager",
  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    if (nodeData.name === "AntigravityLTXBatchManager") {
      
      // 노드 생성 훅 가로채기
      const onNodeCreated = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function () {
        if (onNodeCreated) {
          onNodeCreated.apply(this, arguments);
        }

        const node = this;
        
        // 1. 노드 크기 오리지널 초콤팩트 사양으로 원복 (단자 100% 노출)
        node.setSize([300, 120]);

        // 2. 백엔드 연동 위젯 캐싱
        const jsonConfigWidget = node.widgets.find(w => w.name === "json_config");
        const imageDirWidget = node.widgets.find(w => w.name === "image_directory");

        if (!jsonConfigWidget) {
          console.error("[Antigravity] ❌ json_config 위젯을 찾지 못해 비주얼 에디터를 연동할 수 없습니다.");
          return;
        }

        // 3. 원래 지저분한 멀티라인 위젯은 백그라운드 연동을 위해 화면에서 깔끔히 숨김 (LiteGraph 인덱스 꼬임 원천 방지)
        jsonConfigWidget.computeSize = () => [0, -4];
        jsonConfigWidget.draw = function(ctx, node, widget_width, y, widget_height) {};
        if (jsonConfigWidget.inputEl) {
          jsonConfigWidget.inputEl.style.display = "none";
        }

        // 4. 에디터 팝업창을 여는 아름답고 단정조밀한 버튼 1개만 딱 노드 내부에 얹어 둠!
        node.addWidget("button", "🎬 비주얼 에디터 열기", "", () => {
          if (node.editorHtmlElement) {
            // 초기화 후 팝업 띄우기
            loadConfigFromWidget();
            node.editorHtmlElement.style.display = "flex";
            
            // 화면 정중앙 배치 초기화
            node.editorHtmlElement.style.transform = "translate(-50%, -50%)";
            node.editorHtmlElement.style.left = "50%";
            node.editorHtmlElement.style.top = "50%";
            
            renderEditor();
          }
        });

        // 5. 에디터 전용 내부 메모리 상태 정의
        node.editorState = {
          currentTab: "visual", // "visual" or "json"
          activeSegmentIndex: 0,
          configData: null // 파싱된 JSON 오브젝트 저장소
        };

        // 6. 독립형 대형 팝업 Glassmorphism 에디터 DOM 구축 (Fixed Viewport)
        const editorEl = document.createElement("div");
        editorEl.className = "antigravity-editor-wrapper";
        editorEl.style.position = "fixed"; /* 화면 기준 고정 */
        editorEl.style.zIndex = "9999";    /* 다른 모든 노드들 위로 최우선 정렬 */
        editorEl.style.left = "50%";
        editorEl.style.top = "50%";
        editorEl.style.transform = "translate(-50%, -50%)";
        editorEl.style.display = "none";   /* 평소에는 숨겨 둠 */
        editorEl.style.pointerEvents = "auto";
        document.body.appendChild(editorEl);
        node.editorHtmlElement = editorEl;

        // 마우스 캔버스 간섭 방지
        editorEl.addEventListener("mousedown", e => e.stopPropagation());
        editorEl.addEventListener("wheel", e => e.stopPropagation());
        editorEl.addEventListener("dblclick", e => e.stopPropagation());

        // 7. 데이터 로드 및 초기 파싱
        function loadConfigFromWidget() {
          try {
            const rawVal = jsonConfigWidget.value || "{}";
            const cleanedVal = cleanJsonComments(rawVal).trim();
            node.editorState.configData = JSON.parse(cleanedVal || "{}");
            
            // 기본 구조 보장
            if (!node.editorState.configData.segments) {
              node.editorState.configData.segments = [];
            }
          } catch (e) {
            console.warn("[Antigravity] ⚠️ 기존 JSON 파싱 실패, 기본 템플릿 사용:", e);
            node.editorState.configData = {
              project: { title: "New Project", audio_file: "music.wav" },
              image_dir: "images",
              default_negative: "low quality, blurry",
              segments: []
            };
          }
        }

        // 데이터 백엔드 위젯으로 직렬화 및 ComfyUI 저장 트리거
        function saveConfigToWidget() {
          if (!node.editorState.configData) return;
          const jsonStr = JSON.stringify(node.editorState.configData, null, 2);
          jsonConfigWidget.value = jsonStr;
          
          if (jsonConfigWidget.callback) {
            jsonConfigWidget.callback(jsonStr);
          }
          node.trigger("change");
        }

        // 초기 상태 로딩
        loadConfigFromWidget();

        // 8. 인터랙티브 UI 렌더러 함수 (대형 모달 사양)
        function renderEditor() {
          const state = node.editorState;
          const data = state.configData;

          // 헤더 조립 + 감각적인 닫기 버튼 [X] 통합
          editorEl.innerHTML = `
            <div class="ag-tab-header">
              <button class="ag-tab-btn ${state.currentTab === "visual" ? "active" : ""}" data-tab="visual">
                🎬 시각 갤러리 에디터
              </button>
              <button class="ag-tab-btn ${state.currentTab === "json" ? "active" : ""}" data-tab="json">
                💻 Raw JSON 설정
              </button>
              <button class="ag-popup-close-btn" title="에디터 닫기">X</button>
            </div>
            
            <!-- 시각 에디터 탭 -->
            <div class="ag-tab-content ${state.currentTab === "visual" ? "active" : ""}" id="ag-tab-visual">
              <div class="ag-gallery-scroll-container"></div>
              <div class="ag-detail-editor-panel"></div>
            </div>

            <!-- RAW JSON 탭 -->
            <div class="ag-tab-content ${state.currentTab === "json" ? "active" : ""}" id="ag-tab-json">
              <textarea class="ag-raw-json-textarea" placeholder="이곳에 기획된 JSON을 붙여넣으세요..."></textarea>
            </div>

            <!-- 하단 통계 푸터 -->
            <div class="ag-footer-info">
              <div>프로젝트: <span class="ag-stats-highlight" id="ag-footer-title">-</span></div>
              <div>총 재생시간: <span class="ag-stats-highlight" id="ag-footer-duration">0.0s</span></div>
            </div>
          `;

          // [X] 닫기 버튼 이벤트 연동
          const closeBtn = editorEl.querySelector(".ag-popup-close-btn");
          if (closeBtn) {
            closeBtn.addEventListener("click", () => {
              if (state.currentTab === "json") {
                // 닫을 때 JSON 에러 검사
                const textarea = editorEl.querySelector(".ag-raw-json-textarea");
                try {
                  const cleanedJson = cleanJsonComments(textarea.value).trim();
                  state.configData = JSON.parse(cleanedJson || "{}");
                  if (!state.configData.segments) state.configData.segments = [];
                  saveConfigToWidget();
                } catch (e) {
                  alert("❌ 입력한 JSON 포맷에 에러가 있습니다. 확인 후 다시 시도해 주세요:\n" + e.message);
                  return;
                }
              }
              editorEl.style.display = "none"; // 팝업 닫기
            });
          }

          // 탭 헤더 클릭 이벤트 연동
          const tabBtns = editorEl.querySelectorAll(".ag-tab-btn");
          tabBtns.forEach(btn => {
            btn.addEventListener("click", () => {
              const targetTab = btn.getAttribute("data-tab");
              if (state.currentTab === targetTab) return;

              if (state.currentTab === "json") {
                const textarea = editorEl.querySelector(".ag-raw-json-textarea");
                try {
                  const cleanedJson = cleanJsonComments(textarea.value).trim();
                  state.configData = JSON.parse(cleanedJson || "{}");
                  if (!state.configData.segments) state.configData.segments = [];
                  saveConfigToWidget();
                } catch (e) {
                  alert("❌ 입력한 JSON 포맷에 에러가 있습니다. 확인 후 다시 시도해 주세요:\n" + e.message);
                  return;
                }
              }

              state.currentTab = targetTab;
              renderEditor();
            });
          });

          // 푸터 정보 실시간 연동
          const projectTitle = (data.project && data.project.title) ? data.project.title : "Unknown Project";
          const footerTitleEl = editorEl.querySelector("#ag-footer-title");
          if (footerTitleEl) footerTitleEl.innerText = projectTitle;

          // 총 듀레이션 계산
          let totalSec = 0;
          if (data.segments && data.segments.length > 0) {
            data.segments.forEach(seg => {
              totalSec += parseFloat(seg.duration || 0);
            });
          }
          const footerDurEl = editorEl.querySelector("#ag-footer-duration");
          if (footerDurEl) footerDurEl.innerText = totalSec.toFixed(1) + "초 (" + data.segments.length + "개 씬)";

          // 세부 탭 렌더링
          if (state.currentTab === "visual") {
            renderVisualTab();
          } else {
            renderJsonTab();
          }

          // 💡 [드래그 앤 드롭 이동 스크립트 장착]
          // 에디터 헤더를 잡고 드래그하면 화면 전체 영역 어디로든 이동 가능하게 조율합니다!
          setupDraggable();
        }

        // [시각 갤러리 탭 렌더링 엔진]
        function renderVisualTab() {
          const state = node.editorState;
          const data = state.configData;
          const segments = data.segments || [];

          const galleryContainer = editorEl.querySelector(".ag-gallery-scroll-container");
          const detailContainer = editorEl.querySelector(".ag-detail-editor-panel");

          if (segments.length === 0) {
            galleryContainer.innerHTML = `
              <div style="display:flex; align-items:center; justify-content:center; width:100%; color:var(--ag-text-muted); font-size:11px;">
                ⚠️ 세그먼트 데이터가 비어 있습니다. [Raw JSON] 탭에 기획안을 붙여넣으세요.
              </div>
            `;
            detailContainer.innerHTML = `<div style="color:var(--ag-text-muted); font-size:11px; margin:auto;">씬을 로드해 주세요.</div>`;
            return;
          }

          galleryContainer.innerHTML = "";
          
          if (state.activeSegmentIndex >= segments.length) {
            state.activeSegmentIndex = 0;
          }

          // 💡 [실시간 위젯 동적 쿼리 적용]: 
          // 노드 생성 시점의 정적 캐싱 대신, 이미지 렌더링 시점에 node.widgets에서 image_directory 위젯을 실시간 낚아채와 비동기 셋업 버그를 완벽히 해결합니다!
          const currentImgDirWidget = node.widgets.find(w => w.name === "image_directory");
          const imageDir = currentImgDirWidget ? currentImgDirWidget.value : ".";

          segments.forEach((seg, idx) => {
            const isActive = idx === state.activeSegmentIndex;
            const card = document.createElement("div");
            card.className = `ag-segment-card ${isActive ? "active" : ""}`;
            
            // 썸네일 URL 조립 (스마트 이미지 로케이터 연동)
            let imgHtml = `<span class="ag-card-placeholder">🎬</span>`;
            if (seg.image) {
              const safeImageDir = imageDir ? imageDir.replace(/\\/g, "/") : "";
              
              // 신규 스마트 로케이터 API 타겟팅
              let url = `/antigravity/view?filename=${encodeURIComponent(seg.image)}`;
              if (safeImageDir && safeImageDir !== ".") {
                url += `&image_dir=${encodeURIComponent(safeImageDir)}`;
              } else if (data && data.image_dir) {
                // 위젯 값이 "." 일 때 JSON의 image_dir 필드 값을 보완하여 경로 일치화
                url += `&image_dir=${encodeURIComponent(data.image_dir)}`;
              }
              
              console.log(`[Antigravity View] 🖼️ 세그먼트 이미지 로딩 주소(스마트): ${url}`);

              imgHtml = `<img src="${url}" class="ag-card-thumbnail" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" />
                         <span class="ag-card-placeholder" style="display:none;">🎬</span>`;
            }

            const startVal = parseFloat(seg.start || 0).toFixed(1);
            const durationVal = parseFloat(seg.duration || 0).toFixed(1);

            card.innerHTML = `
              <div class="ag-card-badge">${seg.id || "SEG_" + (idx+1)}</div>
              <div class="ag-card-thumbnail-wrapper">
                ${imgHtml}
              </div>
              <div class="ag-card-time-badge">${startVal}s (+${durationVal}s)</div>
            `;

            card.addEventListener("click", () => {
              if (state.activeSegmentIndex === idx) return;
              state.activeSegmentIndex = idx;
              
              editorEl.querySelectorAll(".ag-segment-card").forEach((c, cIdx) => {
                if (cIdx === idx) c.classList.add("active");
                else c.classList.remove("active");
              });
              
              renderDetailPanel();
            });

            galleryContainer.appendChild(card);
          });

          renderDetailPanel();
        }

        // [디테일 패널 상세 구현]
        function renderDetailPanel() {
          const state = node.editorState;
          const data = state.configData;
          const segments = data.segments || [];
          const detailContainer = editorEl.querySelector(".ag-detail-editor-panel");

          const seg = segments[state.activeSegmentIndex];
          if (!seg) {
            detailContainer.innerHTML = `<div style="color:var(--ag-text-muted); font-size:11px; margin:auto;">씬 정보 로딩 불가</div>`;
            return;
          }

          const promptVal = seg.prompt || "";
          const startVal = parseFloat(seg.start || 0);
          const durationVal = parseFloat(seg.duration || 0);

          detailContainer.innerHTML = `
            <div class="ag-prompt-container-full">
              <!-- 프롬프트 입력 영역 (넓이 100%) -->
              <div class="ag-prompt-section">
                <div class="ag-prompt-label">
                  <span>프롬프트 (카메라 워크 & 표정 묘사)</span>
                  <span style="font-family:monospace; color:var(--ag-text-muted); font-size:9.5px;">
                    글자 수: ${promptVal.length}자
                  </span>
                </div>
                <textarea class="ag-prompt-textarea" placeholder="클로즈업 샷, 웃는 표정에서 슬픈 표정으로 변화 등 카메라와 캐릭터의 움직임을 묘사하세요...">${promptVal}</textarea>
              </div>

              <!-- 🎭 지능형 실시간 프리셋 선택기 -->
              <div class="ag-presets-panel">
                <div class="ag-preset-row">
                  <span class="ag-preset-title">🎥 카메라 샷/무빙</span>
                  <div class="ag-preset-buttons" id="ag-camera-presets-container"></div>
                </div>
                <div class="ag-preset-row" style="margin-top: 2px;">
                  <span class="ag-preset-title">🎭 감정 표현/액션</span>
                  <div class="ag-preset-buttons" id="ag-emotion-presets-container"></div>
                </div>
              </div>

              <!-- 🔢 하단 가로형 타임 조절 바 -->
              <div class="ag-numeric-horizontal-bar">
                <!-- 시작 오프셋 조절 -->
                <div class="ag-num-group-horizontal">
                  <span class="ag-num-label">시작 지점 (Start)</span>
                  <div class="ag-num-input-wrapper">
                    <button class="ag-num-btn" id="ag-start-down">-</button>
                    <input type="number" class="ag-num-input" id="ag-start-input" step="0.1" min="0" value="${startVal.toFixed(1)}" />
                    <button class="ag-num-btn" id="ag-start-up">+</button>
                  </div>
                </div>

                <!-- 듀레이션 조절 -->
                <div class="ag-num-group-horizontal">
                  <span class="ag-num-label">재생 시간 (Duration)</span>
                  <div class="ag-num-input-wrapper">
                    <button class="ag-num-btn" id="ag-dur-down">-</button>
                    <input type="number" class="ag-num-input" id="ag-dur-input" step="0.1" min="0.5" value="${durationVal.toFixed(1)}" />
                    <button class="ag-num-btn" id="ag-dur-up">+</button>
                  </div>
                </div>
              </div>
            </div>
          `;

          const promptTextarea = detailContainer.querySelector(".ag-prompt-textarea");
          const startInput = detailContainer.querySelector("#ag-start-input");
          const durInput = detailContainer.querySelector("#ag-dur-input");

          // 🎭 실시간 프리셋 하이라이트 & 렌더링 함수
          function renderPresets(currentPrompt) {
            const cameraContainer = detailContainer.querySelector("#ag-camera-presets-container");
            const emotionContainer = detailContainer.querySelector("#ag-emotion-presets-container");

            if (!cameraContainer || !emotionContainer) return;

            cameraContainer.innerHTML = "";
            emotionContainer.innerHTML = "";

            const promptLower = currentPrompt.toLowerCase();

            // 1. 카메라 샷 프리셋 생성
            CAMERA_PRESETS.forEach(preset => {
              const btn = document.createElement("button");
              btn.className = "ag-preset-btn";
              btn.innerText = preset.label.split(" (")[0]; // 레이블 앞글자만
              btn.title = preset.value;

              let isActive = false;
              for (const kw of preset.keywords) {
                if (promptLower.includes(kw)) {
                  isActive = true;
                  break;
                }
              }
              if (isActive) btn.classList.add("active");

              btn.addEventListener("click", () => {
                seg.prompt = updatePromptWithPreset(seg.prompt || "", CAMERA_PRESETS, preset.value);
                saveConfigToWidget();
                
                promptTextarea.value = seg.prompt;
                renderPresets(seg.prompt);
                
                const wordCountEl = detailContainer.querySelector(".ag-prompt-label span:last-child");
                if (wordCountEl) wordCountEl.innerText = `글자 수: ${seg.prompt.length}자`;
              });

              cameraContainer.appendChild(btn);
            });

            // 2. 감정 표현 프리셋 생성
            EMOTION_PRESETS.forEach(preset => {
              const btn = document.createElement("button");
              btn.className = "ag-preset-btn";
              btn.innerText = preset.label.split(" (")[0];
              btn.title = preset.value;

              let isActive = false;
              for (const kw of preset.keywords) {
                if (promptLower.includes(kw)) {
                  isActive = true;
                  break;
                }
              }
              if (isActive) btn.classList.add("active");

              btn.addEventListener("click", () => {
                seg.prompt = updatePromptWithPreset(seg.prompt || "", EMOTION_PRESETS, preset.value);
                saveConfigToWidget();
                
                promptTextarea.value = seg.prompt;
                renderPresets(seg.prompt);
                
                const wordCountEl = detailContainer.querySelector(".ag-prompt-label span:last-child");
                if (wordCountEl) wordCountEl.innerText = `글자 수: ${seg.prompt.length}자`;
              });

              emotionContainer.appendChild(btn);
            });
          }

          // 초기 프리셋 렌더링
          renderPresets(promptVal);

          // 프롬프트 입력 이벤트
          promptTextarea.addEventListener("input", () => {
            seg.prompt = promptTextarea.value;
            saveConfigToWidget();
            
            // 타이핑 할 때 실시간 프리셋 하이라이트 매칭 업데이트
            renderPresets(promptTextarea.value);

            const wordCountEl = detailContainer.querySelector(".ag-prompt-label span:last-child");
            if (wordCountEl) wordCountEl.innerText = `글자 수: ${promptTextarea.value.length}자`;
          });

          function adjustNumeric(inputEl, delta, fieldName, minVal) {
            let val = parseFloat(inputEl.value) || 0;
            val = Math.max(minVal, val + delta);
            inputEl.value = val.toFixed(1);
            
            seg[fieldName] = val;
            saveConfigToWidget();
            
            const activeCard = editorEl.querySelector(".ag-segment-card.active .ag-card-time-badge");
            if (activeCard) {
              const currentStart = parseFloat(seg.start || 0).toFixed(1);
              const currentDur = parseFloat(seg.duration || 0).toFixed(1);
              activeCard.innerText = `${currentStart}s (+${currentDur}s)`;
            }

            let liveTotal = 0;
            segments.forEach(s => liveTotal += parseFloat(s.duration || 0));
            const footerDurEl = editorEl.querySelector("#ag-footer-duration");
            if (footerDurEl) footerDurEl.innerText = liveTotal.toFixed(1) + "초 (" + segments.length + "개 씬)";
          }

          detailContainer.querySelector("#ag-start-down").addEventListener("click", () => adjustNumeric(startInput, -0.5, "start", 0));
          detailContainer.querySelector("#ag-start-up").addEventListener("click", () => adjustNumeric(startInput, 0.5, "start", 0));
          startInput.addEventListener("change", () => {
            let parsedVal = parseFloat(startInput.value) || 0;
            parsedVal = Math.max(0, parsedVal);
            startInput.value = parsedVal.toFixed(1);
            seg.start = parsedVal;
            saveConfigToWidget();
          });

          detailContainer.querySelector("#ag-dur-down").addEventListener("click", () => adjustNumeric(durInput, -0.5, "duration", 0.5));
          detailContainer.querySelector("#ag-dur-up").addEventListener("click", () => adjustNumeric(durInput, 0.5, "duration", 0.5));
          durInput.addEventListener("change", () => {
            let parsedVal = parseFloat(durInput.value) || 0.5;
            parsedVal = Math.max(0.5, parsedVal);
            durInput.value = parsedVal.toFixed(1);
            seg.duration = parsedVal;
            saveConfigToWidget();
          });
        }

        // [Raw JSON 탭 렌더링 엔진]
        function renderJsonTab() {
          const textarea = editorEl.querySelector(".ag-raw-json-textarea");
          const currentConfigStr = JSON.stringify(node.editorState.configData, null, 2);
          textarea.value = currentConfigStr;

          textarea.addEventListener("blur", () => {
            try {
              const cleanedVal = cleanJsonComments(textarea.value).trim();
              node.editorState.configData = JSON.parse(cleanedVal || "{}");
              if (!node.editorState.configData.segments) {
                node.editorState.configData.segments = [];
              }
              saveConfigToWidget();
            } catch (e) {
              console.warn("JSON 파싱 에러 발생:", e);
            }
          });
        }

        // [드래그 앤 드롭 이동 헬퍼 구현]
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        function setupDraggable() {
          const header = editorEl.querySelector(".ag-tab-header");
          if (!header) return;

          header.addEventListener("mousedown", (e) => {
            // 버튼 클릭 시에는 드래그 방지
            if (e.target.closest(".ag-tab-btn") || e.target.closest(".ag-popup-close-btn")) return;
            
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            
            const rect = editorEl.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            
            // translate 중앙정렬 보정을 풀고 absolute 픽셀 정렬로 치환
            editorEl.style.transform = "none";
            editorEl.style.left = `${initialLeft}px`;
            editorEl.style.top = `${initialTop}px`;
            
            e.preventDefault();
          });
        }

        document.addEventListener("mousemove", (e) => {
          if (!isDragging) return;
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;
          editorEl.style.left = `${initialLeft + dx}px`;
          editorEl.style.top = `${initialTop + dy}px`;
        });

        document.addEventListener("mouseup", () => {
          isDragging = false;
        });

        // 초기 마크업 조립
        renderEditor();

        // 9. 노드 복제 또는 삭제(onRemoved) 시 DOM 리소스 정리
        const originalOnRemoved = node.onRemoved;
        node.onRemoved = function () {
          if (originalOnRemoved) {
            originalOnRemoved.apply(this, arguments);
          }
          if (node.editorHtmlElement) {
            node.editorHtmlElement.remove();
            node.editorHtmlElement = null;
          }
        };
      };
    }
  }
});
