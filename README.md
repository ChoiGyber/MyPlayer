# MyPlayer

mpv 기반 데스크톱 미디어 플레이어. Tauri 2 + Vite + TypeScript로 만들었습니다.

## 기술 스택

- **Frontend**: Vite 8, TypeScript 6, Vanilla TS
- **Backend**: Rust (Tauri 2.10)
- **Player Core**: mpv (외부 바이너리)

## 요구 사항

- Node.js 18+
- Rust (`rustup`, edition 2021, 1.77.2 이상)
- mpv 바이너리 — `tools/mpv/mpv.exe` 경로에 배치 (저장소에 포함되어 있지 않음)

## 개발

```bash
npm install
npm run tauri dev
```

## 빌드

```bash
npm run tauri build
```

## 프로젝트 구조

```
src/                Vite + TypeScript 프론트엔드
src-tauri/
  src/
    lib.rs          Tauri 엔트리, invoke_handler 등록
    media.rs        파일 처리, 자막, 최근 파일, 설정
    mpv.rs          mpv 프로세스/IPC 제어
  tauri.conf.json   윈도우/번들 설정
tools/              mpv 바이너리 (gitignored)
```

## mpv 바이너리 준비

`tools/` 디렉토리는 `.gitignore`에 포함되어 있어 직접 받아야 합니다. mpv 공식 빌드를 받아 `tools/mpv/`에 풀어두세요.

## 라이선스

미정.
