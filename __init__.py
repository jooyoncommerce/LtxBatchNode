"""
Antigravity LTX Batch Manager
로컬 환경 최적화 뮤직비디오 자동화 시스템
RTX 3060/3090 최적화 포함
"""

import json
import os
import torch
import numpy as np
from PIL import Image
try:
    import folder_paths
except ImportError:
    # Fallback for testing or non-standard environments
    class FolderPaths:
        def get_input_directory(self):
            return os.path.join(os.getcwd(), "input")
    folder_paths = FolderPaths()

def get_input_subdirectories():
    """ComfyUI input 폴더 내의 모든 하위 디렉토리 목록을 가져옵니다."""
    try:
        input_dir = folder_paths.get_input_directory()
    except Exception:
        input_dir = os.path.join(os.getcwd(), "input")
    
    if not os.path.exists(input_dir):
        return ["."]
    
    subdirs = ["."]
    for root, dirs, files in os.walk(input_dir):
        # 숨김 폴더나 시스템 폴더 제외
        dirs[:] = [d for d in dirs if not d.startswith('.') and d != '__pycache__']
        
        for d in dirs:
            full_path = os.path.join(root, d)
            rel_path = os.path.relpath(full_path, input_dir)
            rel_path = rel_path.replace("\\", "/")
            subdirs.append(rel_path)
            
    return sorted(list(set(subdirs)), key=lambda x: (x != ".", x.lower()))


import re

def strip_json_comments(json_str):
    """JSON 문자열에서 주석(//, /* */)을 제거합니다."""
    # /* ... */ 블록 주석 제거
    json_str = re.sub(r'/\*.*?\*/', '', json_str, flags=re.DOTALL)
    
    cleaned_lines = []
    for line in json_str.splitlines():
        # URL 스키마(http://, https://)를 제외한 // 주석 제거
        cleaned_line = re.sub(r'(?<!:)\/\/.*$', '', line)
        cleaned_lines.append(cleaned_line)
        
    return '\n'.join(cleaned_lines)

def parse_multi_json(json_str):
    """
    여러 개의 연속되거나 분리된 JSON 문서를 파싱하여 하나의 통합된 딕셔너리로 결합합니다.
    """
    json_str = strip_json_comments(json_str).strip()
    if not json_str:
        return {}

    decoder = json.JSONDecoder()
    idx = 0
    length = len(json_str)
    parsed_objects = []

    while idx < length:
        # 공백 문자 및 쉼표 구분선 건너뛰기
        while idx < length and json_str[idx].isspace():
            idx += 1
        if idx >= length:
            break
        
        if json_str[idx] == ',':
            idx += 1
            continue

        val, end_idx = decoder.raw_decode(json_str, idx)
        parsed_objects.append(val)
        idx = end_idx

    # 객체 결합 로직
    merged_config = {}
    segments_list = []

    for obj in parsed_objects:
        if isinstance(obj, dict):
            # segments 키가 있는 경우 리스트 병합
            if "segments" in obj:
                if isinstance(obj["segments"], list):
                    segments_list.extend(obj["segments"])
                elif isinstance(obj["segments"], dict):
                    segments_list.append(obj["segments"])
            
            # 기타 설정 키 병합 (project, image_dir 등)
            for k, v in obj.items():
                if k != "segments":
                    if isinstance(v, dict) and k in merged_config and isinstance(merged_config[k], dict):
                        merged_config[k].update(v)
                    else:
                        merged_config[k] = v
        elif isinstance(obj, list):
            # 리스트 자체를 세그먼트 배열로 취급
            segments_list.extend(obj)

    if segments_list:
        merged_config["segments"] = segments_list

    return merged_config


def resolve_image_path(base_dir, filename):
    """
    다양한 예외 상황(확장자 누락, 잘못된 확장자, 대소문자 불일치 등)을 고려하여
    실제 파일 시스템에 존재하는 이미지 파일의 절대 경로를 찾아 반환합니다.
    """
    if not filename:
        return None

    # 공통 이미지 확장자 후보군
    extensions = ['', '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.PNG', '.JPG', '.JPEG', '.WEBP']
    
    # 1. 파일 이름 그대로 테스트 및 확장자 붙여서 테스트
    for ext in extensions:
        test_path = os.path.join(base_dir, filename + ext)
        if os.path.exists(test_path) and os.path.isfile(test_path):
            return test_path
            
    # 2. 파일 이름에 이미 확장자가 포함되어 있는 경우, 이를 제거하고 다른 확장자 조합 테스트
    name_without_ext, _ = os.path.splitext(filename)
    if name_without_ext != filename:
        for ext in extensions:
            if ext:  # 빈 확장자는 1단계에서 이미 테스트했으므로 제외
                test_path = os.path.join(base_dir, name_without_ext + ext)
                if os.path.exists(test_path) and os.path.isfile(test_path):
                    return test_path
                    
    # 3. 폴더 내부를 대소문자 구분 없이 탐색하여 일치하는 파일 찾기
    if os.path.exists(base_dir) and os.path.isdir(base_dir):
        try:
            files_in_dir = os.listdir(base_dir)
            lower_filename = filename.lower()
            lower_without_ext = name_without_ext.lower()
            
            for f in files_in_dir:
                lower_f = f.lower()
                f_without_ext, _ = os.path.splitext(lower_f)
                
                if lower_f == lower_filename or f_without_ext == lower_without_ext or f_without_ext == lower_filename:
                    return os.path.join(base_dir, f)
        except Exception:
            pass

    return None


class AntigravityLTXBatchManager:
    """
    JSON 설정으로 LTX 2.3 완전 자동 배치 처리
    OUTPUT_IS_LIST 기능으로 ComfyUI 엔진 자동 반복 실행
    """
    
    # 🔄 [Auto Increment] 상태 유지를 위한 클래스 레벨 변수
    _current_auto_index = None
    _last_json_config = None
    _last_start_index = None
    
    @classmethod
    def INPUT_TYPES(cls):
        subdirs = get_input_subdirectories()
        return {
            "required": {
                "json_config": ("STRING", {
                    "multiline": True,
                    "default": cls._get_default_json(),
                    "tooltip": "뮤직비디오 배치 설정 JSON"
                }),
                "image_directory": (subdirs, {
                    "default": ".",
                    "tooltip": "입력 이미지가 저장된 폴더를 선택하세요 (ComfyUI/input 폴더 기준 상대 경로)"
                }),
            },
            "optional": {
                "run_mode": (["all", "single_segment", "auto_increment"], {
                    "default": "all",
                    "tooltip": "all: 모든 세그먼트 일괄 실행, single_segment: 선택한 1개 세그먼트만 단독 실행, auto_increment: 큐 실행 시마다 세그먼트 번호를 1씩 증가시키며 실행"
                }),
                "single_segment_index": ("INT", {
                    "default": 0,
                    "min": 0,
                    "max": 999,
                    "step": 1,
                    "tooltip": "single_segment 모드에서 실행할 세그먼트 인덱스 (0부터 시작)"
                }),
                "single_segment_id": ("STRING", {
                    "default": "auto",
                    "tooltip": "특정 세그먼트 ID 지정 (예: SEG_02). auto가 아닌 경우 index보다 우선 적용됩니다."
                }),
                "enable_debug": ("BOOLEAN", {
                    "default": True,
                    "label_on": "디버그 ON",
                    "label_off": "디버그 OFF"
                }),
                "vram_optimization": (["auto", "3060_12gb", "3090_24gb", "rtx_6000_ada_48gb", "none"], {
                    "default": "auto",
                    "tooltip": "GPU별 VRAM 최적화. none 선택 시 이미지를 축소하지 않고 원본 해상도와 화질 그대로 입력합니다. (단, LTX 비디오 규격 준수를 위해 32배수 크기로 최소 조정만 수행)"
                }),
                "loop_on_complete": ("BOOLEAN", {
                    "default": True,
                    "label_on": "루프 반복 ON",
                    "label_off": "루프 반복 OFF (완료 후 정지)",
                    "tooltip": "auto_increment 모드에서 모든 세그먼트를 실행 완료했을 때 처음부터 다시 반복할지(ON), 혹은 멈출지(OFF) 결정합니다."
                }),
            }
        }
    
    RETURN_TYPES = (
        "IMAGE",    # first_frame
        "STRING",   # prompt
        "FLOAT",    # audio_start
        "FLOAT",    # duration
        "FLOAT",    # motion_strength
        "INT",      # steps
        "STRING",   # segment_id
        "STRING",   # negative_prompt
        "INT",      # width
        "INT",      # height
    )
    
    RETURN_NAMES = (
        "images",
        "prompts",
        "audio_starts",
        "durations",
        "motion_strengths",
        "steps",
        "segment_ids",
        "negative_prompts",
        "widths",
        "heights",
    )
    
    # 🔑 핵심: ComfyUI 자동 배치 처리 활성화
    OUTPUT_IS_LIST = (True, True, True, True, True, True, True, True, True, True)
    
    FUNCTION = "process_batch"
    CATEGORY = "🚀 Antigravity/LTX"
    
    @classmethod
    def IS_CHANGED(cls, json_config, image_directory=".", enable_debug=True, vram_optimization="auto", run_mode="all", single_segment_index=0, single_segment_id="auto", loop_on_complete=True):
        # auto_increment 모드일 때만 매번 실행되도록 타임스탬프 반환
        if run_mode == "auto_increment":
            import time
            return time.time()
        # 그 외에는 json_config 등이 변경될 때만 실행
        import hashlib
        h = hashlib.sha256()
        h.update(json_config.encode('utf-8'))
        h.update(image_directory.encode('utf-8'))
        h.update(run_mode.encode('utf-8'))
        h.update(str(single_segment_index).encode('utf-8'))
        h.update(single_segment_id.encode('utf-8'))
        h.update(str(loop_on_complete).encode('utf-8'))
        return h.hexdigest()
        
    def process_batch(self, json_config, image_directory=".", enable_debug=True, vram_optimization="auto", run_mode="all", single_segment_index=0, single_segment_id="auto", loop_on_complete=True):
        
        # JSON 파싱 및 검증
        try:
            config = parse_multi_json(json_config)
        except json.JSONDecodeError as e:
            error_msg = f"JSON 파싱 오류: {e}"
            if enable_debug:
                print(f"[Antigravity] ❌ {error_msg}")
            raise ValueError(error_msg)
        
        # 출력 리스트 초기화
        images = []
        prompts = []
        audio_starts = []
        durations = []
        motion_strengths = []
        steps_list = []
        segment_ids = []
        negative_prompts = []
        widths = []
        heights = []
        
        # 경로 설정
        input_dir = folder_paths.get_input_directory()
        if image_directory and image_directory != ".":
            image_dir = os.path.join(input_dir, image_directory)
            if enable_debug:
                print(f"[Antigravity] 📁 노드 UI에서 선택한 이미지 폴더 사용: {image_directory}")
        else:
            image_subdir = config.get("image_dir", "images")
            image_dir = os.path.join(input_dir, image_subdir)
            if enable_debug:
                print(f"[Antigravity] 📁 JSON 설정의 이미지 폴더 사용: {image_subdir}")
        
        # VRAM 최적화 설정
        max_resolution = self._get_max_resolution(vram_optimization)
        
        # 기본 네거티브 프롬프트
        default_negative = config.get(
            "default_negative",
            "microphone, mic stand, dark noir lighting, cartoon, anime, blurry face, distorted mouth, camera shake, text, watermark, low quality"
        )
        
        # 이미지 캐시 (중복 로드 방지)
        image_cache = {}
        
        segments = config.get("segments", [])
        original_total = len(segments)
        
        # 1. auto_increment 모드 처리
        if run_mode == "auto_increment":
            cls = AntigravityLTXBatchManager
            
            # 설정이나 시작 인덱스가 변경된 경우 또는 초기 상태일 때 인덱스 초기화
            if (cls._last_json_config != json_config or 
                cls._last_start_index != single_segment_index or 
                cls._current_auto_index is None):
                cls._current_auto_index = single_segment_index
                cls._last_json_config = json_config
                cls._last_start_index = single_segment_index
                
            idx_to_run = cls._current_auto_index
            if idx_to_run >= len(segments):
                if not loop_on_complete:
                    error_msg = f"[Antigravity] 🎉 모든 세그먼트({len(segments)}개)의 렌더링이 완료되었습니다! 루프 반복이 비활성화되어 있으므로 실행을 종료합니다."
                    if enable_debug:
                        print(f"\n{'='*60}")
                        print(error_msg)
                        print(f"{'='*60}\n")
                    # 다음 수동 실행을 위해 인덱스를 single_segment_index로 초기화해둡니다.
                    cls._current_auto_index = single_segment_index
                    raise ValueError(error_msg)
                
                if enable_debug:
                    print(f"[Antigravity] 🔄 모든 세그먼트 실행을 완료하여 처음(인덱스 0)으로 되돌아갑니다.")
                idx_to_run = 0
                cls._current_auto_index = 0
                
            selected_segment = segments[idx_to_run]
            
            # 다음 번 실행을 위해 인덱스 1 증가
            cls._current_auto_index += 1
            
            if enable_debug:
                print(f"[Antigravity] 🔄 [Auto Increment] 이번 실행 세그먼트 인덱스: {idx_to_run} / {original_total - 1} ({selected_segment.get('id')})")
                print(f"[Antigravity] 🔄 [Auto Increment] 다음 실행 예정 세그먼트 인덱스: {cls._current_auto_index}")
                
            segments = [selected_segment]
            
        # 2. single_segment 모드인 경우 필터링 적용
        elif run_mode == "single_segment":
            filtered_segments = []
            
            # 1. ID 매칭 시도
            if single_segment_id and single_segment_id != "auto":
                target_id = single_segment_id.strip()
                for seg in segments:
                    if seg.get("id") == target_id:
                        filtered_segments.append(seg)
                        break
                if not filtered_segments and enable_debug:
                    print(f"[Antigravity] ⚠️ 지정한 세그먼트 ID '{target_id}'를 찾지 못했습니다. 인덱스 기준으로 시도합니다.")
            
            # 2. 인덱스 매칭 시도
            if not filtered_segments:
                if 0 <= single_segment_index < len(segments):
                    filtered_segments.append(segments[single_segment_index])
                else:
                    error_msg = f"유효하지 않은 세그먼트 인덱스: {single_segment_index} (총 {len(segments)}개)"
                    if enable_debug:
                        print(f"[Antigravity] ❌ {error_msg}")
                    raise ValueError(error_msg)
            
            segments = filtered_segments
        
        if enable_debug:
            project_title = config.get("project", {}).get("title", "Unknown Project")
            print(f"\n{'='*60}")
            print(f"[Antigravity] 🎬 프로젝트: {project_title}")
            print(f"[Antigravity] 모드: {run_mode} (전체 세그먼트 수: {original_total}, 실행 세그먼트 수: {len(segments)})")
            print(f"[Antigravity] VRAM 최적화: {vram_optimization} (최대 해상도: {max_resolution})")
            print(f"{'='*60}")
        
        # 세그먼트별 처리
        for idx, segment in enumerate(segments, 1):
            
            seg_id = segment.get("id", f"SEG_{idx:02d}")
            img_file = segment.get("image", "")
            
            # 이미지 로드 및 캐싱
            if img_file not in image_cache:
                tensor = self._load_and_optimize_image(
                    image_dir, input_dir, img_file, max_resolution, enable_debug
                )
                if tensor is None:
                    if enable_debug:
                        print(f"[Antigravity] ⚠️ {seg_id} 건너뜀 (이미지 로드 실패)")
                    continue
                image_cache[img_file] = tensor
            
            # 파라미터 수집
            tensor = image_cache[img_file]
            images.append(tensor)
            prompts.append(segment.get("prompt", ""))
            audio_starts.append(float(segment.get("start", 0.0)))
            durations.append(float(segment.get("duration", 15.0)))
            motion_strengths.append(float(segment.get("motion_strength", 0.5)))
            steps_list.append(int(segment.get("steps", 32)))
            segment_ids.append(seg_id)
            negative_prompts.append(
                segment.get("negative_prompt", default_negative)
            )
            # 해상도 정보 수집
            widths.append(int(tensor.shape[2]))
            heights.append(int(tensor.shape[1]))
            
            if enable_debug:
                start = float(segment.get("start", 0.0))
                dur = float(segment.get("duration", 15.0))
                motion = float(segment.get("motion_strength", 0.5))
                steps = int(segment.get("steps", 32))
                print(
                    f"[Antigravity] ✅ [{idx:02d}] {seg_id} | "
                    f"이미지: {img_file} | "
                    f"크기: {tensor.shape[2]}x{tensor.shape[1]} | "
                    f"{start}초~{start+dur}초 | "
                    f"motion: {motion} | steps: {steps}"
                )
        
        total = len(images)
        
        if enable_debug:
            estimated_time_3060 = total * 12  # 분
            estimated_time_3090 = total * 3.5  # 분
            print(f"\n[Antigravity] 🚀 총 {total}개 세그먼트 배치 준비 완료!")
            print(f"[Antigravity] 예상 처리 시간:")
            print(f"  - RTX 3060: 약 {estimated_time_3060}분")
            print(f"  - RTX 3090: 약 {estimated_time_3090}분")
            print(f"{'='*60}\n")
        
        if total == 0:
            raise ValueError("처리할 세그먼트가 없습니다. JSON 설정과 이미지 파일을 확인하세요.")
        
        return (
            images,
            prompts,
            audio_starts,
            durations,
            motion_strengths,
            steps_list,
            segment_ids,
            negative_prompts,
            widths,
            heights,
        )
    
    def _get_max_resolution(self, vram_optimization):
        """VRAM 최적화에 따른 최대 해상도 설정"""
        if vram_optimization == "3060_12gb":
            return 1280  # 안전한 해상도
        elif vram_optimization == "3090_24gb":
            return 2048  # 고해상도 가능
        elif vram_optimization == "rtx_6000_ada_48gb":
            return 3072  # 초고해상도 (48GB VRAM용)
        elif vram_optimization == "none":
            return 99999  # 원본 해상도 유지 (축소 없음)
        else:  # auto
            return 1536  # 중간값
    
    def _load_and_optimize_image(self, image_dir, input_dir, img_file, max_resolution, debug=True):
        """이미지 로드 및 VRAM 최적화 (32배수로 해상도 조절)"""
        
        # 1단계: image_dir에서 탐색 및 해결
        path = resolve_image_path(image_dir, img_file)
        
        # 2단계: 못 찾았을 경우 input_dir에서 탐색 및 해결
        if path is None:
            path = resolve_image_path(input_dir, img_file)
            
        # 3단계: 절대 경로이거나 현재 작업 디렉토리 기준일 때
        if path is None and os.path.isabs(img_file):
            if os.path.exists(img_file):
                path = img_file
            else:
                dir_name = os.path.dirname(img_file)
                base_name = os.path.basename(img_file)
                path = resolve_image_path(dir_name, base_name)
        
        # 4단계: 마지막으로 상대 경로 탐색
        if path is None:
            path = resolve_image_path(os.getcwd(), img_file)
            
        if path is None:
            if debug:
                print(f"[Antigravity] ❌ 이미지를 찾을 수 없습니다: {img_file} (폴더: {image_dir})")
            return None

        try:
            pil = Image.open(path).convert("RGB")
            
            # VRAM 최적화: 해상도 조정 (LTX 비디오 호환을 위해 32배수 보장)
            w, h = pil.size
            if max(w, h) > max_resolution:
                ratio = max_resolution / max(w, h)
                new_w = int(round(w * ratio / 32.0) * 32)
                new_h = int(round(h * ratio / 32.0) * 32)
            else:
                new_w = int(round(w / 32.0) * 32)
                new_h = int(round(h / 32.0) * 32)
            
            new_w = max(32, new_w)
            new_h = max(32, new_h)
            
            if new_w != w or new_h != h:
                pil = pil.resize((new_w, new_h), Image.Resampling.LANCZOS)
                if debug:
                    print(f"[Antigravity] 📐 해상도 최적화(32배수 조절): {w}x{h} → {new_w}x{new_h}")
            
            # ComfyUI 표준 텐서 형식 [1, H, W, C] float32 0~1
            np_img = np.array(pil).astype(np.float32) / 255.0
            tensor = torch.from_numpy(np_img)[None,]
            
            if debug:
                print(f"[Antigravity] 🖼️ 로드 성공: {os.path.basename(path)} {tensor.shape}")
            
            return tensor
            
        except Exception as e:
            if debug:
                print(f"[Antigravity] ❌ 로드 실패 ({path}): {e}")
            return None
    
    @staticmethod
    def _get_default_json():
        """기본 JSON 템플릿"""
        template = {
            "project": {
                "title": "Le Printemps de Mon Village",
                "audio_file": "le_printemps.wav"
            },
            "image_dir": "images",
            "default_negative": "microphone, mic stand, dark noir lighting, cartoon, anime, blurry face, distorted mouth, camera shake, text, watermark, low quality",
            "segments": [
                {
                    "id": "SEG_01",
                    "image": "madeleine_front.png",
                    "start": 0.0,
                    "duration": 15.0,
                    "motion_strength": 0.45,
                    "steps": 32,
                    "prompt": "Beautiful French woman Madeleine, eyes closed humming, slowly opening with compassionate gaze, warm golden sepia, ultra realistic"
                },
                {
                    "id": "SEG_05",
                    "image": "madeleine_front.png",
                    "start": 65.0,
                    "duration": 20.0,
                    "motion_strength": 0.55,
                    "steps": 35,
                    "prompt": "Madeleine OH MON VILLAGE! healing chorus, profound compassion, golden halo, ultra realistic"
                }
            ]
        }
        return json.dumps(template, ensure_ascii=False, indent=2)


class AntigravitySegmentNamer:
    """세그먼트 ID 기반 자동 파일명 생성"""
    
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "segment_id": ("STRING", {"default": "SEG_01"}),
                "project_name": ("STRING", {"default": "antigravity_mv"}),
            }
        }
    
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("filename_prefix",)
    
    INPUT_IS_LIST = (True, False)
    OUTPUT_IS_LIST = (True,)
    
    FUNCTION = "generate_names"
    CATEGORY = "🚀 Antigravity/LTX"
    
    def generate_names(self, segment_id, project_name):
        filenames = []
        for seg_id in segment_id:
            filename = f"{project_name}_{seg_id}"
            filenames.append(filename)
            print(f"[Antigravity Namer] 📝 파일명: {filename}")
        return (filenames,)


class AntigravityAutoShutdown:
    """
    모든 렌더링과 저장이 끝난 후 Vast.ai 서버를 종료하는 노드.
    반드시 Video Save 노드의 출력(예: 파일 경로)을 이 노드의 입력으로 연결해야 순서가 보장됩니다.
    """
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # 비디오 이미지, 파일명 문자열 등 임의의 포트를 강제로 입력받아 실행 순서를 미룸
                "trigger_signal": ("*", {"forceInput": True}),
                "vast_api_key": ("STRING", {"default": "YOUR_API_KEY_HERE"}),
                "instance_id": ("STRING", {"default": "YOUR_INSTANCE_ID"}),
                "enable_shutdown": ("BOOLEAN", {"default": False, "label_on": "종료 활성화", "label_off": "테스트 모드(종료 안함)"})
            }
        }
    
    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("status",)
    
    INPUT_IS_LIST = True
    OUTPUT_IS_LIST = False
    
    FUNCTION = "execute_shutdown"
    CATEGORY = "🚀 Antigravity/LTX"
    
    def execute_shutdown(self, trigger_signal, vast_api_key, instance_id, enable_shutdown):
        # 100% 안전하게 리스트 여부와 상관없이 값을 추출하는 언패킹 로직
        def get_value(val):
            if isinstance(val, list):
                return val[0] if len(val) > 0 else None
            return val
            
        api_key = get_value(vast_api_key)
        inst_id = get_value(instance_id)
        should_shutdown = get_value(enable_shutdown)
        
        # 공백 제거
        if isinstance(api_key, str):
            api_key = api_key.strip()
        if isinstance(inst_id, str):
            inst_id = inst_id.strip()

        # Vast.ai 환경 변수 자동 감지 로직
        import os
        
        # 1. API Key 자동 감지
        if not api_key or api_key == "YOUR_API_KEY_HERE" or api_key == "":
            env_api_key = os.environ.get("CONTAINER_API_KEY", "").strip()
            if env_api_key:
                api_key = env_api_key
                print("[Antigravity] ℹ️ Vast.ai 환경 변수에서 API Key를 감지하여 자동으로 적용했습니다.")
                
        # 2. Instance ID 자동 감지
        if not inst_id or inst_id == "YOUR_INSTANCE_ID" or inst_id == "":
            env_inst_id = os.environ.get("CONTAINER_ID", "").strip()
            if env_inst_id:
                inst_id = env_inst_id
                print(f"[Antigravity] ℹ️ Vast.ai 환경 변수에서 Instance ID({inst_id})를 감지하여 자동으로 적용했습니다.")

        if should_shutdown:
            if not api_key or api_key == "YOUR_API_KEY_HERE":
                print("[Antigravity] ❌ Vast.ai API Key가 설정되지 않았거나 기본값입니다. 종료를 건너뜁니다.")
                return ("API Key Missing",)
            if not inst_id or inst_id == "YOUR_INSTANCE_ID":
                print("[Antigravity] ❌ Vast.ai Instance ID가 설정되지 않았거나 기본값입니다. 종료를 건너뜁니다.")
                return ("Instance ID Missing",)

            print(f"[Antigravity] 🛑 모든 렌더링 완료 감지! 안전한 디스크 저장을 위해 15초 대기 후 Vast.ai 서버({inst_id}) 정지 명령을 전송합니다...")
            # 백그라운드에서 15초 대기 후 실행되도록 하여 비디오 파일이 안전하게 저장된 후 인스턴스가 종료되게 함
            if os.name == 'nt':
                # Windows 환경 (로컬 테스트 및 대비용, 15초 대기)
                os.system(f"start /B cmd /c \"timeout 15 && vastai stop instance {inst_id} --api-key {api_key}\" > NUL 2>&1")
            else:
                # Linux 환경 (실제 Vast.ai 서버 환경, 15초 대기)
                os.system(f"nohup sh -c \"sleep 15 && vastai stop instance {inst_id} --api-key {api_key}\" > /dev/null 2>&1 &")
        else:
            print("[Antigravity] ⚠️ 자동 종료가 비활성화되어 있습니다. 서버를 유지합니다.")
            
        return ("Shutdown Executed",)


# ComfyUI 노드 등록
NODE_CLASS_MAPPINGS = {
    "AntigravityLTXBatchManager": AntigravityLTXBatchManager,
    "AntigravitySegmentNamer": AntigravitySegmentNamer,
    "AntigravityAutoShutdown": AntigravityAutoShutdown,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AntigravityLTXBatchManager": "🎬 Antigravity LTX Batch Manager",
    "AntigravitySegmentNamer": "📝 Antigravity Segment Namer",
    "AntigravityAutoShutdown": "🛑 Antigravity Auto Shutdown (Vast.ai)",
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]

