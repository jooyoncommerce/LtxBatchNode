# LtxBatchNode (Antigravity LTX Batch Manager)

ComfyUI에서 LTX-2.3 비디오 생성을 완전 자동화하고 배치/루프 렌더링 및 Vast.ai GPU 서버 자동 종료를 지원하는 커스텀 노드 패키지입니다.

---

## 🚀 주요 기능

### 1. 🎬 Antigravity LTX Batch Manager
* **JSON 배치 설정**: 복잡한 세그먼트별 프롬프트, 오디오 오프셋, 생성 길이, 모션 강도(motion_strength), 스텝 수(steps) 등을 하나의 JSON 파일로 관리하고 순차 실행합니다.
* **VRAM 최적화 모드**: GPU 메모리 크기(RTX 3060 12GB, RTX 3090 24GB, RTX 5090 32GB 등)에 맞춰 이미지 해상도를 LTX 규격(32배수)에 맞게 자동 리사이징 및 최적화합니다. (`none` 설정 시 원본 해상도 유지)
* **다양한 실행 모드**:
  * `all`: 모든 세그먼트 순차적 일괄 실행
  * `single_segment`: 지정한 특정 인덱스 또는 ID 세그먼트 단독 실행
  * `auto_increment`: 큐 실행(Queue Trigger) 시마다 세그먼트 인덱스를 1씩 자동으로 증가시키며 실행
* **무한 루프 방지 스위치 (`loop_on_complete`)**:
  * `auto_increment` 모드에서 모든 세그먼트 실행이 완료되었을 때 처음으로 되돌아가 루프를 돌지(`루프 반복 ON`), 혹은 안전하게 대기열을 멈출지(`루프 반복 OFF - 완료 후 정지`) 선택할 수 있습니다.
* **⚡ LTX Sequencer 호환성 및 GuideData 지원 (신규)**:
  * `GUIDE_DATA` 소켓 포트를 통해 LTX Sequencer 노드로 정밀 프레임 가이드를 즉시 전송합니다.
  * 입력된 `duration`에 맞추어 정확한 레이턴트 및 픽셀 프레임 크기(`clean_latent_frames`, `clean_pixel_frames`)를 내장 공식으로 정밀 자동 연산합니다.
* **🎭 다차원 스타일 및 캐릭터 참조 이미지 가이드 (신규)**:
  * **외부 입력 (`external_reference_images`)**: 외부 노드(예: Character Ref Sheet 등)에서 생성되거나 로드된 배치 이미지를 직접 수신할 수 있습니다. 수신된 참조 이미지는 타겟 비디오의 스타트 프레임 해상도에 맞추어 PyTorch 보간으로 정밀 리사이징됩니다.
  * **내부 JSON 설정 (`reference_images` 배열)**: 개별 세그먼트 JSON 설정 내에 참조할 이미지 파일명 목록을 리스트로 정의해 두면 디스크에서 자동 탐색/로드하여 VRAM 최적화와 함께 패킹합니다.
  * **숨김 프레임 인젝션 (Hidden Zone Injection)**: 참조 이미지들을 본편 영상 레이턴트 경계면의 바깥 영역인 숨김 구역(Hidden Zone)에 8프레임 단위로 배치함으로써, 영상 본편의 자연스러움을 해치지 않으면서 스타일과 캐릭터 일관성(Identity)을 완벽히 유지해 줍니다.
  * **가이드 강도 제어 (`reference_strength`)**: 참조 이미지 가이드의 고정 강도를 슬라이더로 손쉽게 정밀 튜닝할 수 있습니다.

### 2. 📝 Antigravity Segment Namer
* 각 세그먼트 ID(예: `SEG_01`, `SEG_02`)와 프로젝트 이름을 조합하여 결과물 비디오 파일의 이름을 자동으로 매핑해주는 파일명 생성 도구입니다.

### 3. 🛑 Antigravity Auto Shutdown (Vast.ai)
* **Vast.ai 인스턴스 자동 종료**: 긴 시간 동안 배치 작업을 걸어놓고 완료 시점에 서버를 안전하게 자동 정지(Stop)시켜 불필요한 GPU 대여 비용 청구를 방지합니다.
* **디스크 저장 보장**: Video Save 노드의 출력(저장 경로)을 트리거 신호로 받아 작동하므로, 파일 저장이 100% 끝난 시점에만 서버를 종료합니다.
* **비동기 백그라운드 구동**: 종료 신호를 백그라운드 프로세스로 호출하여 ComfyUI의 비정상 종료(Crash)를 방지합니다.

---

## ⚙️ 설치 방법

1. ComfyUI의 `custom_nodes` 디렉토리로 이동합니다.
2. 저장소를 클론합니다:
   ```bash
   git clone https://github.com/jooyoncommerce/LtxBatchNode.git antigravity_ltx_batch
   ```
3. 필요한 패키지를 설치합니다:
   ```bash
   pip install -r requirements.txt
   ```
4. ComfyUI를 재시작합니다.

---

## 🛠️ 노드 매핑 정보
* **🎬 Antigravity LTX Batch Manager** (`AntigravityLTXBatchManager`)
* **📝 Antigravity Segment Namer** (`AntigravitySegmentNamer`)
* **🛑 Antigravity Auto Shutdown (Vast.ai)** (`AntigravityAutoShutdown`)

---

## 📝 라이선스
MIT License
