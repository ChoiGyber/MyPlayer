import './style.css';

import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';

type RecentMediaItem = {
  path: string;
  displayName: string;
  lastOpenedAt: number;
};

type SubtitleCandidate = {
  path: string;
  displayName: string;
  format: string;
};

type PreparedMedia = {
  path: string;
  displayName: string;
  recentFiles: RecentMediaItem[];
  subtitles: SubtitleCandidate[];
};

type SubtitlePayload = {
  path: string;
  displayName: string;
  format: string;
  vtt: string;
  detectedEncoding: string;
};

type Language = 'ko' | 'en';

type AppSettings = {
  language: Language;
  isFirstRun: boolean;
  dataDir: string;
};

type MpvStatus = {
  isRunning: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  path: string | null;
};

type AppState = {
  mediaPath: string | null;
  mediaTitle: string;
  mediaUrl: string | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  previousVolume: number;
  isFullscreen: boolean;
  isLoadingMedia: boolean;
  isLoadingSubtitle: boolean;
  currentSubtitlePath: string | null;
  subtitleNotice: string;
  subtitleOptions: SubtitleCandidate[];
  recentFiles: RecentMediaItem[];
  resolutionLabel: string;
  statusMessage: string;
  errorMessage: string;
  language: Language;
  isFirstRun: boolean;
  portableDataDir: string;
};

const VIDEO_FILTER_EXTENSIONS = [
  'mp4',
  'm4v',
  'mov',
  'mkv',
  'avi',
  'wmv',
  'webm',
  'mpeg',
  'mpg',
  'ts',
  'm2ts',
  '3gp',
];

const SUBTITLE_FILTER_EXTENSIONS = ['srt', 'ass', 'ssa', 'vtt'];
const SEEK_SECONDS = 5;
const VOLUME_STEP = 5;
const FULLSCREEN_CONTROL_HIDE_MS = 2000;

const I18N = {
  ko: {
    windowTitle: 'MyPlayer - 한국어',
    brandSubtitle: 'Windows 데스크톱 비디오 플레이어',
    shortcuts: '단축키',
    openFile: '파일 열기',
    fullscreen: '전체화면',
    exitFullscreen: '전체화면 종료',
    close: '닫기',
    languageButton: 'EN',
    languageTitle: '언어 설정',
    languageCopy: '사용할 언어를 선택하세요. 설정은 실행 파일 옆 MyPlayerData 폴더에 저장됩니다.',
    languageFailed: '언어 설정을 저장하지 못했습니다.',
    korean: '한국어',
    english: 'English',
    emptyEyebrow: '최가이버 마이플레이어',
    emptyTitle: '영상과 자막을 빠르게 여는 플레이어',
    emptyCopy: '파일 열기, 최근 파일, 자막 자동 탐지, 전체화면, 볼륨과 탐색 컨트롤을 한 화면에 정리했습니다.',
    openVideo: '영상 파일 열기',
    openSubtitle: '자막 파일 열기',
    subtitleHint: '지원 자막: SRT / ASS / VTT',
    initialTitle: '파일을 열어 재생을 시작하세요',
    initialStatus: '영상 파일을 열어 주세요.',
    ready: '준비됨',
    subtitleAutoPending: '자막 자동 탐지 대기',
    subtitleAutoNotice: '외부 자막을 자동으로 찾습니다.',
    restartPlayback: '처음부터 재생',
    play: '재생',
    pause: '일시정지',
    seekBackward: '5초 뒤로',
    seekForward: '5초 앞으로',
    chooseSubtitle: '자막 선택',
    mute: '음소거',
    unmute: '음소거 해제',
    volume: '볼륨',
    recentFiles: '최근 파일',
    refresh: '새로고침',
    subtitles: '자막',
    off: '끄기',
    shortcutsTitle: '단축키',
    keyPlay: '재생 / 일시정지',
    keyFullscreen: '전체화면',
    keySeek: '-5초 / +5초',
    keyVolume: '볼륨 조절',
    keyEsc: '전체화면 해제',
    recentEmpty: '최근에 연 파일이 없습니다.',
    subtitleNone: '자동 탐지된 자막이 없습니다.',
    metadataLoading: '메타데이터 로딩 중',
    metadataLoaded: '메타데이터 로드 완료',
    playbackReady: '재생 준비 완료',
    pressPlay: '재생 버튼을 눌러 시작하세요.',
    preparingFile: '파일을 준비하는 중입니다...',
    openFileFailed: '파일을 열지 못했습니다.',
    openFileFailedStatus: '파일 열기 실패',
    openSubtitleAfterMedia: '먼저 영상을 연 뒤 자막을 선택하세요.',
    subtitleLoading: '자막을 불러오는 중입니다...',
    subtitleLoadFailed: '자막을 불러오지 못했습니다.',
    subtitleReadFailed: '자막을 읽지 못했습니다.',
    subtitleOff: '자막을 끈 상태입니다.',
    playing: '재생 중',
    paused: '일시정지',
    ended: '재생 완료',
    videoUnsupported: '이 파일은 현재 WebView 런타임에서 재생할 수 없거나 코덱이 지원되지 않습니다.',
    fullscreenNeedsMedia: '먼저 영상을 연 뒤 전체화면을 사용하세요.',
    fullscreenFailed: '전체화면 상태를 변경하지 못했습니다.',
    subtitleActive: '자막 적용 중',
    subtitleWaiting: '자막 대기',
    justNow: '방금',
    portrait: '세로',
    square: '정사각',
    landscape: '가로',
  },
  en: {
    windowTitle: 'MyPlayer - English',
    brandSubtitle: 'Windows desktop video player',
    shortcuts: 'Shortcuts',
    openFile: 'Open File',
    fullscreen: 'Fullscreen',
    exitFullscreen: 'Exit Fullscreen',
    close: 'Close',
    languageButton: 'KO',
    languageTitle: 'Language',
    languageCopy: 'Choose the language for MyPlayer. Settings are saved in MyPlayerData next to the executable.',
    languageFailed: 'Could not save the language setting.',
    korean: '한국어',
    english: 'English',
    emptyEyebrow: 'CHOIGYBER MyPlayer',
    emptyTitle: 'Open videos and subtitles quickly',
    emptyCopy: 'Open files, recent videos, subtitle detection, fullscreen, volume, and seeking controls are kept in one focused view.',
    openVideo: 'Open Video File',
    openSubtitle: 'Open Subtitle File',
    subtitleHint: 'Supported subtitles: SRT / ASS / VTT',
    initialTitle: 'Open a file to start playback',
    initialStatus: 'Open a video file.',
    ready: 'Ready',
    subtitleAutoPending: 'Subtitle auto-detect pending',
    subtitleAutoNotice: 'External subtitles will be detected automatically.',
    restartPlayback: 'Restart playback',
    play: 'Play',
    pause: 'Pause',
    seekBackward: 'Back 5 seconds',
    seekForward: 'Forward 5 seconds',
    chooseSubtitle: 'Choose Subtitle',
    mute: 'Mute',
    unmute: 'Unmute',
    volume: 'Volume',
    recentFiles: 'Recent Files',
    refresh: 'Refresh',
    subtitles: 'Subtitles',
    off: 'Off',
    shortcutsTitle: 'Shortcuts',
    keyPlay: 'Play / Pause',
    keyFullscreen: 'Fullscreen',
    keySeek: '-5s / +5s',
    keyVolume: 'Adjust volume',
    keyEsc: 'Exit fullscreen',
    recentEmpty: 'No recent files.',
    subtitleNone: 'No auto-detected subtitles.',
    metadataLoading: 'Loading metadata',
    metadataLoaded: 'Metadata loaded',
    playbackReady: 'Ready to play',
    pressPlay: 'Press play to start.',
    preparingFile: 'Preparing file...',
    openFileFailed: 'Could not open the file.',
    openFileFailedStatus: 'Open failed',
    openSubtitleAfterMedia: 'Open a video before choosing subtitles.',
    subtitleLoading: 'Loading subtitle...',
    subtitleLoadFailed: 'Could not load subtitles.',
    subtitleReadFailed: 'Could not read subtitles.',
    subtitleOff: 'Subtitles are off.',
    playing: 'Playing',
    paused: 'Paused',
    ended: 'Playback ended',
    videoUnsupported: 'This file cannot be played by the current WebView runtime or its codec is not supported.',
    fullscreenNeedsMedia: 'Open a video before using fullscreen.',
    fullscreenFailed: 'Could not change fullscreen state.',
    subtitleActive: 'Subtitles on',
    subtitleWaiting: 'Subtitles waiting',
    justNow: 'Just now',
    portrait: 'Portrait',
    square: 'Square',
    landscape: 'Landscape',
  },
} as const;

const state: AppState = {
  mediaPath: null,
  mediaTitle: '파일을 열어 재생을 시작하세요',
  mediaUrl: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 72,
  previousVolume: 72,
  isFullscreen: false,
  isLoadingMedia: false,
  isLoadingSubtitle: false,
  currentSubtitlePath: null,
  subtitleNotice: '외부 자막을 자동으로 찾습니다.',
  subtitleOptions: [],
  recentFiles: [],
  resolutionLabel: '준비됨',
  statusMessage: '영상 파일을 열어 주세요.',
  errorMessage: '',
  language: 'ko',
  isFirstRun: true,
  portableDataDir: '',
};

let activeSubtitleUrl: string | null = null;
let fullscreenControlTimer: number | null = null;
let playbackStatusTimer: number | null = null;
let areFullscreenControlsVisible = false;
const appWindow = getCurrentWindow();

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('#app element not found');
}

app.innerHTML = `
  <div class="shell" id="app-shell">
    <header class="titlebar" id="app-titlebar" data-tauri-drag-region>
      <div class="brand" data-tauri-drag-region>
        <div class="brand-mark">MP</div>
        <div class="brand-copy" data-tauri-drag-region>
          <strong data-tauri-drag-region>MyPlayer <small class="app-version">v0.0.1</small></strong>
          <span id="brand-subtitle" data-tauri-drag-region>Windows desktop video player</span>
        </div>
      </div>
      <div class="titlebar-actions">
        <button class="titlebar-button ghost compact" id="toggle-language" type="button">EN</button>
        <button class="titlebar-button ghost" id="open-shortcuts-top" type="button">단축키</button>
        <button class="titlebar-button ghost" id="open-media-top" type="button">파일 열기</button>
        <button class="titlebar-button ghost" id="toggle-fullscreen-top" type="button">전체화면</button>
        <button class="titlebar-button danger" id="close-window" type="button">닫기</button>
      </div>
    </header>

    <main class="workspace">
      <section class="player-panel" id="player-panel">
        <div class="stage-frame" id="stage-frame">
          <video id="player-video" class="player-video" preload="metadata" playsinline></video>
          <div class="empty-state" id="empty-state">
            <p class="eyebrow" id="empty-eyebrow">Tauri desktop player</p>
            <h1 id="empty-title">영상과 자막을 빠르게 여는 플레이어</h1>
            <p class="empty-copy" id="empty-copy">
              파일 열기, 최근 파일, 자막 자동 탐지, 전체화면, 볼륨과 탐색 컨트롤을 한 화면에 정리했습니다.
            </p>
            <div class="empty-actions">
              <button class="primary-button" id="open-media-empty" type="button">영상 파일 열기</button>
              <button class="secondary-button" id="open-subtitle-empty" type="button">자막 파일 열기</button>
            </div>
            <p class="hint-line" id="subtitle-hint">지원 자막: SRT / ASS / VTT</p>
          </div>
          <div class="error-banner hidden" id="error-banner"></div>
        </div>

        <section class="control-dock" id="control-dock">
          <div class="control-topline">
            <div class="media-meta">
              <strong id="media-title">파일을 열어 재생을 시작하세요</strong>
              <span id="media-status">영상 파일을 열어 주세요.</span>
            </div>
            <div class="meta-pills">
              <span class="pill" id="resolution-pill">준비됨</span>
              <span class="pill" id="subtitle-pill">자막 자동 탐지 대기</span>
            </div>
          </div>

          <div class="timeline-block">
            <input id="timeline" class="timeline" type="range" min="0" max="1000" value="0" step="1" />
            <div class="timeline-meta">
              <span class="time-chip">
                <span class="inline-icon" aria-hidden="true">${iconSvg('clock')}</span>
                <span id="current-time">00:00</span>
              </span>
              <span class="time-chip">
                <span class="inline-icon" aria-hidden="true">${iconSvg('duration')}</span>
                <span id="duration-time">00:00</span>
              </span>
            </div>
          </div>

          <div class="control-row">
            <div class="transport">
              <button class="control-button icon-button" id="restart-playback" type="button" aria-label="처음부터 재생" title="처음부터 재생">
                <span class="control-icon" aria-hidden="true">${iconSvg('restart')}</span>
                <span class="sr-only">처음부터 재생</span>
              </button>
              <button class="control-button icon-button" id="toggle-play" type="button" aria-label="재생" title="재생">
                <span class="control-icon" id="play-icon" aria-hidden="true">${iconSvg('play')}</span>
                <span class="sr-only">재생</span>
              </button>
              <button class="control-button icon-button" id="seek-backward" type="button" aria-label="5초 뒤로" title="5초 뒤로">
                <span class="control-icon" aria-hidden="true">${iconSvg('backward')}</span>
                <span class="sr-only">5초 뒤로</span>
              </button>
              <button class="control-button icon-button" id="seek-forward" type="button" aria-label="5초 앞으로" title="5초 앞으로">
                <span class="control-icon" aria-hidden="true">${iconSvg('forward')}</span>
                <span class="sr-only">5초 앞으로</span>
              </button>
              <button class="control-button subtle" id="open-subtitle-manual" type="button">자막 선택</button>
            </div>

            <div class="volume-block">
              <button class="control-button subtle icon-button" id="toggle-mute" type="button" aria-label="음소거" title="음소거">
                <span class="control-icon" id="mute-icon" aria-hidden="true">${iconSvg('volume')}</span>
                <span class="sr-only">볼륨</span>
              </button>
              <input id="volume-slider" class="volume-slider" type="range" min="0" max="100" step="1" value="72" />
              <span class="volume-value">
                <span class="inline-icon" aria-hidden="true">${iconSvg('volume')}</span>
                <span id="volume-value">72%</span>
              </span>
            </div>
          </div>
        </section>
      </section>

      <aside class="sidebar">
        <section class="sidebar-card">
          <div class="sidebar-heading">
            <h2 id="recent-heading">최근 파일</h2>
            <button class="text-button" id="refresh-recent" type="button">새로고침</button>
          </div>
          <div class="list-stack" id="recent-list"></div>
        </section>

        <section class="sidebar-card">
          <div class="sidebar-heading">
            <h2 id="subtitle-heading">자막</h2>
            <button class="text-button" id="disable-subtitle" type="button">끄기</button>
          </div>
          <div class="subtitle-caption" id="subtitle-caption">외부 자막을 자동으로 찾습니다.</div>
          <div class="list-stack" id="subtitle-list"></div>
        </section>
      </aside>
    </main>

    <div class="shortcut-modal hidden" id="shortcut-modal" role="dialog" aria-modal="true" aria-labelledby="shortcut-modal-title">
      <div class="shortcut-modal-card">
        <div class="sidebar-heading">
          <h2 id="shortcut-modal-title">단축키</h2>
          <button class="text-button" id="close-shortcuts" type="button">닫기</button>
        </div>
        <div class="shortcut-grid">
          <span>Space</span><strong>재생 / 일시정지</strong>
          <span>Enter</span><strong>전체화면</strong>
            <span>Left / Right</span><strong>-5초 / +5초</strong>
          <span>Up / Down</span><strong>볼륨 조절</strong>
          <span>F</span><strong>전체화면</strong>
          <span>Esc</span><strong>전체화면 해제</strong>
        </div>
      </div>
    </div>

    <div class="language-modal hidden" id="language-modal" role="dialog" aria-modal="true" aria-labelledby="language-modal-title">
      <div class="language-modal-card">
        <h2 id="language-modal-title">언어 설정</h2>
        <p id="language-modal-copy">사용할 언어를 선택하세요.</p>
        <div class="language-options">
          <button class="language-option" id="choose-language-ko" type="button" data-language="ko">
            <strong>한국어</strong>
            <span>Korean UI</span>
          </button>
          <button class="language-option" id="choose-language-en" type="button" data-language="en">
            <strong>English</strong>
            <span>English UI</span>
          </button>
        </div>
      </div>
    </div>
  </div>
`;

const video = getRequiredElement<HTMLVideoElement>('player-video');
const shell = getRequiredElement<HTMLDivElement>('app-shell');
const playerPanel = getRequiredElement<HTMLElement>('player-panel');
const stageFrame = getRequiredElement<HTMLDivElement>('stage-frame');
const titlebar = getRequiredElement<HTMLElement>('app-titlebar');
const controlDock = getRequiredElement<HTMLElement>('control-dock');
const emptyState = getRequiredElement<HTMLDivElement>('empty-state');
const errorBanner = getRequiredElement<HTMLDivElement>('error-banner');
const brandSubtitle = getRequiredElement<HTMLElement>('brand-subtitle');
const emptyEyebrow = getRequiredElement<HTMLElement>('empty-eyebrow');
const emptyTitle = getRequiredElement<HTMLElement>('empty-title');
const emptyCopy = getRequiredElement<HTMLElement>('empty-copy');
const subtitleHint = getRequiredElement<HTMLElement>('subtitle-hint');
const mediaTitle = getRequiredElement<HTMLElement>('media-title');
const mediaStatus = getRequiredElement<HTMLElement>('media-status');
const resolutionPill = getRequiredElement<HTMLElement>('resolution-pill');
const subtitlePill = getRequiredElement<HTMLElement>('subtitle-pill');
const currentTimeLabel = getRequiredElement<HTMLElement>('current-time');
const durationTimeLabel = getRequiredElement<HTMLElement>('duration-time');
const timeline = getRequiredElement<HTMLInputElement>('timeline');
const volumeSlider = getRequiredElement<HTMLInputElement>('volume-slider');
const volumeValue = getRequiredElement<HTMLElement>('volume-value');
const recentList = getRequiredElement<HTMLDivElement>('recent-list');
const subtitleList = getRequiredElement<HTMLDivElement>('subtitle-list');
const subtitleCaption = getRequiredElement<HTMLElement>('subtitle-caption');
const recentHeading = getRequiredElement<HTMLElement>('recent-heading');
const subtitleHeading = getRequiredElement<HTMLElement>('subtitle-heading');
const shortcutModal = getRequiredElement<HTMLDivElement>('shortcut-modal');
const shortcutModalTitle = getRequiredElement<HTMLElement>('shortcut-modal-title');
const languageModal = getRequiredElement<HTMLDivElement>('language-modal');
const languageModalTitle = getRequiredElement<HTMLElement>('language-modal-title');
const languageModalCopy = getRequiredElement<HTMLElement>('language-modal-copy');
const restartButton = getRequiredElement<HTMLButtonElement>('restart-playback');
const playButton = getRequiredElement<HTMLButtonElement>('toggle-play');
const playIcon = getRequiredElement<HTMLSpanElement>('play-icon');
const muteButton = getRequiredElement<HTMLButtonElement>('toggle-mute');
const muteIcon = getRequiredElement<HTMLSpanElement>('mute-icon');
const fullscreenButton = getRequiredElement<HTMLButtonElement>('toggle-fullscreen-top');

const controls = {
  toggleLanguage: getRequiredElement<HTMLButtonElement>('toggle-language'),
  openMediaTop: getRequiredElement<HTMLButtonElement>('open-media-top'),
  openShortcutsTop: getRequiredElement<HTMLButtonElement>('open-shortcuts-top'),
  openMediaEmpty: getRequiredElement<HTMLButtonElement>('open-media-empty'),
  openSubtitleEmpty: getRequiredElement<HTMLButtonElement>('open-subtitle-empty'),
  openSubtitleManual: getRequiredElement<HTMLButtonElement>('open-subtitle-manual'),
  closeWindow: getRequiredElement<HTMLButtonElement>('close-window'),
  restartPlayback: restartButton,
  togglePlay: playButton,
  seekBackward: getRequiredElement<HTMLButtonElement>('seek-backward'),
  seekForward: getRequiredElement<HTMLButtonElement>('seek-forward'),
  toggleMute: muteButton,
  toggleFullscreenTop: fullscreenButton,
  refreshRecent: getRequiredElement<HTMLButtonElement>('refresh-recent'),
  disableSubtitle: getRequiredElement<HTMLButtonElement>('disable-subtitle'),
  closeShortcuts: getRequiredElement<HTMLButtonElement>('close-shortcuts'),
  chooseLanguageKo: getRequiredElement<HTMLButtonElement>('choose-language-ko'),
  chooseLanguageEn: getRequiredElement<HTMLButtonElement>('choose-language-en'),
};

volumeSlider.value = String(state.volume);

bindEvents();
void bootstrap();

function getRequiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`missing element: ${id}`);
  }

  return element as T;
}

async function bootstrap(): Promise<void> {
  state.isFullscreen = false;
  try {
    const settings = await invoke<AppSettings>('get_app_settings');
    applySettings(settings);
  } catch {
    state.language = 'ko';
  }
  await syncWindowTitle();
  await refreshRecentFiles();
  updateUi();
  if (state.isFirstRun) {
    showLanguageModal();
  }
}

function applySettings(settings: AppSettings): void {
  state.language = settings.language;
  state.isFirstRun = settings.isFirstRun;
  state.portableDataDir = settings.dataDir;
  document.documentElement.lang = settings.language === 'ko' ? 'ko' : 'en';
  resetLocalizedIdleState();
}

function resetLocalizedIdleState(): void {
  if (!state.mediaPath) {
    state.mediaTitle = t('initialTitle');
    state.statusMessage = t('initialStatus');
    state.resolutionLabel = t('ready');
    state.subtitleNotice = t('subtitleAutoNotice');
  }
}

function bindEvents(): void {
  titlebar.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || state.isFullscreen || !isTitlebarDragTarget(event.target)) {
      return;
    }

    event.preventDefault();
    void appWindow.startDragging();
  });

  controls.toggleLanguage.addEventListener('click', () => {
    showLanguageModal();
  });

  controls.chooseLanguageKo.addEventListener('click', () => {
    void setAppLanguage('ko');
  });

  controls.chooseLanguageEn.addEventListener('click', () => {
    void setAppLanguage('en');
  });

  controls.openMediaTop.addEventListener('click', () => {
    void handleOpenMediaDialog();
  });
  controls.openShortcutsTop.addEventListener('click', () => {
    shortcutModal.classList.remove('hidden');
  });
  controls.closeShortcuts.addEventListener('click', () => {
    shortcutModal.classList.add('hidden');
  });
  shortcutModal.addEventListener('click', (event) => {
    if (event.target === shortcutModal) {
      shortcutModal.classList.add('hidden');
    }
  });

  controls.openMediaEmpty.addEventListener('click', () => {
    void handleOpenMediaDialog();
  });

  controls.openSubtitleEmpty.addEventListener('click', () => {
    void handleOpenSubtitleDialog();
  });

  controls.openSubtitleManual.addEventListener('click', () => {
    void handleOpenSubtitleDialog();
  });

  controls.closeWindow.addEventListener('click', () => {
    void invoke('close_window');
  });

  controls.togglePlay.addEventListener('click', () => {
    void togglePlayback();
  });

  controls.restartPlayback.addEventListener('click', () => {
    void restartPlayback();
  });

  controls.seekBackward.addEventListener('click', () => {
    void seekRelative(-SEEK_SECONDS);
  });

  controls.seekForward.addEventListener('click', () => {
    void seekRelative(SEEK_SECONDS);
  });

  controls.toggleMute.addEventListener('click', () => {
    if (state.volume === 0) {
      void setVolume(state.previousVolume > 0 ? state.previousVolume : 72);
      return;
    }

    state.previousVolume = state.volume;
    void setVolume(0);
  });

  controls.toggleFullscreenTop.addEventListener('click', () => {
    void toggleFullscreen();
  });

  document.addEventListener('fullscreenchange', () => {
    syncFullscreenState();
  });

  controls.refreshRecent.addEventListener('click', () => {
    void refreshRecentFiles();
  });

  controls.disableSubtitle.addEventListener('click', () => {
    disableSubtitle();
  });

  playerPanel.addEventListener('mousemove', () => {
    if (state.isFullscreen) {
      showFullscreenControls();
    }
  });

  stageFrame.addEventListener('mouseenter', () => {
    if (state.isFullscreen) {
      showFullscreenControls();
    }
  });

  stageFrame.addEventListener('mousemove', () => {
    if (state.isFullscreen) {
      showFullscreenControls();
    }
  });

  stageFrame.addEventListener('mouseleave', () => {
    if (state.isFullscreen) {
      hideFullscreenControls();
    }
  });

  controlDock.addEventListener('mouseenter', () => {
    if (state.isFullscreen) {
      showFullscreenControls();
    }
  });

  controlDock.addEventListener('mousemove', (event) => {
    event.stopPropagation();
    if (state.isFullscreen) {
      showFullscreenControls();
    }
  });

  controlDock.addEventListener('mouseleave', () => {
    if (state.isFullscreen) {
      hideFullscreenControls();
    }
  });

  timeline.addEventListener('input', () => {
    const ratio = Number(timeline.value) / 1000;
    const nextTime = state.duration * ratio;
    if (Number.isFinite(nextTime)) {
      state.currentTime = nextTime;
      void seekAbsolute(nextTime);
      updateUi();
    }
  });

  volumeSlider.addEventListener('input', () => {
    void setVolume(Number(volumeSlider.value));
  });

  recentList.addEventListener('click', (event) => {
    const target = event.target;
    const element =
      target instanceof HTMLElement ? target : target instanceof Node ? target.parentElement : null;
    if (!element) {
      return;
    }

    const button = element.closest('button');
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const { mediaPath } = button.dataset;
    if (!mediaPath) {
      return;
    }

    void openPreparedMedia(mediaPath);
  });

  subtitleList.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) {
      return;
    }

    const { subtitlePath } = target.dataset;
    if (!subtitlePath) {
      return;
    }

    void loadSubtitle(subtitlePath, true);
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !shortcutModal.classList.contains('hidden')) {
      shortcutModal.classList.add('hidden');
      return;
    }

    if (isTypingTarget(event.target)) {
      return;
    }

    switch (event.key) {
      case ' ':
        event.preventDefault();
        void togglePlayback();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        void seekRelative(-SEEK_SECONDS);
        break;
      case 'ArrowRight':
        event.preventDefault();
        void seekRelative(SEEK_SECONDS);
        break;
      case 'ArrowUp':
        event.preventDefault();
        void setVolume(state.volume + VOLUME_STEP);
        break;
      case 'ArrowDown':
        event.preventDefault();
        void setVolume(state.volume - VOLUME_STEP);
        break;
      case 'f':
      case 'F':
      case 'Enter':
        event.preventDefault();
        void toggleFullscreen();
        break;
      case 'Escape':
        if (state.isFullscreen) {
          void setFullscreen(false);
        }
        break;
      default:
        break;
    }
  });

  window.addEventListener('beforeunload', () => {
    releaseSubtitleUrl();
  });
}

function t(key: keyof typeof I18N.ko): string {
  return I18N[state.language][key];
}

function showLanguageModal(): void {
  languageModal.classList.remove('hidden');
  updateLanguageModalState();
}

async function setAppLanguage(language: Language): Promise<void> {
  try {
    const settings = await invoke<AppSettings>('set_app_language', { language });
    applySettings(settings);
    state.isFirstRun = false;
    languageModal.classList.add('hidden');
    await syncWindowTitle();
    updateUi();
  } catch (error) {
    state.errorMessage = getErrorMessage(error, t('languageFailed'));
    updateUi();
  }
}

async function syncWindowTitle(): Promise<void> {
  const title = t('windowTitle');
  document.title = title;
  try {
    await invoke('set_window_title', { title });
  } catch {
    // The document title is still updated if the native title command fails.
  }
}

function updateLanguageModalState(): void {
  controls.chooseLanguageKo.classList.toggle('active', state.language === 'ko');
  controls.chooseLanguageEn.classList.toggle('active', state.language === 'en');
}

async function handleOpenMediaDialog(): Promise<void> {
  clearError();

  const selected = await open({
    multiple: false,
    directory: false,
    filters: [
      {
        name: 'Video',
        extensions: VIDEO_FILTER_EXTENSIONS,
      },
    ],
  });

  if (!selected || Array.isArray(selected)) {
    return;
  }

  await openPreparedMedia(selected);
}

async function handleOpenSubtitleDialog(): Promise<void> {
  if (!state.mediaPath) {
    state.errorMessage = t('openSubtitleAfterMedia');
    updateUi();
    return;
  }

  const selected = await open({
    multiple: false,
    directory: false,
    filters: [
      {
        name: 'Subtitle',
        extensions: SUBTITLE_FILTER_EXTENSIONS,
      },
    ],
  });

  if (!selected || Array.isArray(selected)) {
    return;
  }

  await loadSubtitle(selected, true);
}

async function openPreparedMedia(path: string): Promise<void> {
  state.isLoadingMedia = true;
  state.statusMessage = t('preparingFile');
  state.errorMessage = '';
  updateUi();

  try {
    const prepared = await invoke<PreparedMedia>('prepare_media', { path });
    applyPreparedMedia(prepared);
    const status = await invoke<MpvStatus>('mpv_open_media', { path: prepared.path });
    applyMpvStatus(status);
    startPlaybackStatusPolling();
  } catch (error) {
    state.errorMessage = getErrorMessage(error, t('openFileFailed'));
    state.statusMessage = t('openFileFailedStatus');
    await refreshRecentFiles();
  } finally {
    state.isLoadingMedia = false;
    updateUi();
  }
}

function applyPreparedMedia(prepared: PreparedMedia): void {
  releaseSubtitleUrl();

  state.mediaPath = prepared.path;
  state.mediaTitle = prepared.displayName;
  state.mediaUrl = null;
  state.currentTime = 0;
  state.duration = 0;
  state.isPlaying = false;
  state.recentFiles = prepared.recentFiles;
  state.subtitleOptions = prepared.subtitles;
  state.currentSubtitlePath = null;
  state.subtitleNotice =
    prepared.subtitles.length > 0
      ? formatSubtitleCandidateCount(prepared.subtitles.length)
      : t('subtitleNone');
  state.resolutionLabel = t('metadataLoading');
  state.statusMessage = t('playbackReady');
  state.errorMessage = '';

  resetVideoPresentation();
  clearNativeTracks();

  if (prepared.subtitles.length > 0) {
    void loadSubtitle(prepared.subtitles[0].path, false);
  }
}

async function loadSubtitle(path: string, announceManualChoice: boolean): Promise<void> {
  state.isLoadingSubtitle = true;
  state.errorMessage = '';
  state.subtitleNotice = t('subtitleLoading');
  updateUi();

  try {
    const subtitle = await invoke<SubtitlePayload>('load_subtitle', { path });
    await invoke<MpvStatus>('mpv_load_subtitle', { path: subtitle.path });
    state.currentSubtitlePath = subtitle.path;
    state.subtitleNotice = announceManualChoice
      ? formatSubtitleApplied(subtitle.displayName, false)
      : formatSubtitleApplied(subtitle.displayName, true);
    state.errorMessage = '';
  } catch (error) {
    state.errorMessage = getErrorMessage(error, t('subtitleLoadFailed'));
    state.subtitleNotice = t('subtitleReadFailed');
  } finally {
    state.isLoadingSubtitle = false;
    updateUi();
  }
}

function disableSubtitle(): void {
  state.currentSubtitlePath = null;
  state.subtitleNotice = t('subtitleOff');
  clearNativeTracks();
  releaseSubtitleUrl();
  void invoke<MpvStatus>('mpv_disable_subtitle').then(applyMpvStatus).catch(() => undefined);
  updateUi();
}

function clearNativeTracks(): void {
  for (const track of Array.from(video.querySelectorAll('track'))) {
    track.remove();
  }

  for (let index = 0; index < video.textTracks.length; index += 1) {
    video.textTracks[index].mode = 'disabled';
  }
}

function releaseSubtitleUrl(): void {
  if (activeSubtitleUrl) {
    URL.revokeObjectURL(activeSubtitleUrl);
    activeSubtitleUrl = null;
  }
}

async function togglePlayback(): Promise<void> {
  if (!state.mediaPath) {
    void handleOpenMediaDialog();
    return;
  }

  try {
    const status = await invoke<MpvStatus>('mpv_toggle_playback');
    applyMpvStatus(status);
  } catch (error) {
    setPlaybackError(error);
  }
}

async function restartPlayback(): Promise<void> {
  if (!state.mediaPath) {
    return;
  }

  try {
    const status = await invoke<MpvStatus>('mpv_restart');
    applyMpvStatus(status);
  } catch (error) {
    setPlaybackError(error);
  }
}

async function seekRelative(deltaSeconds: number): Promise<void> {
  if (!state.mediaPath) {
    return;
  }

  try {
    const status = await invoke<MpvStatus>('mpv_seek_relative', { seconds: deltaSeconds });
    applyMpvStatus(status);
  } catch (error) {
    setPlaybackError(error);
  }
}

async function seekAbsolute(nextTime: number): Promise<void> {
  if (!state.mediaPath) {
    return;
  }

  try {
    const status = await invoke<MpvStatus>('mpv_seek_absolute', { seconds: nextTime });
    applyMpvStatus(status);
  } catch (error) {
    setPlaybackError(error);
  }
}

async function setVolume(nextVolume: number): Promise<void> {
  const clamped = clamp(Math.round(nextVolume), 0, 100);
  state.volume = clamped;
  if (clamped > 0) {
    state.previousVolume = clamped;
  }
  volumeSlider.value = String(clamped);
  updateUi();

  if (state.mediaPath) {
    try {
      const status = await invoke<MpvStatus>('mpv_set_volume', { volume: clamped });
      applyMpvStatus(status);
    } catch (error) {
      setPlaybackError(error);
    }
  }
}

async function toggleFullscreen(): Promise<void> {
  await setFullscreen(!state.isFullscreen);
}

async function setFullscreen(fullscreen: boolean): Promise<void> {
  if (fullscreen && !state.mediaPath) {
    state.errorMessage = t('fullscreenNeedsMedia');
    updateUi();
    return;
  }

  try {
    state.errorMessage = '';

    if (fullscreen) {
      if (document.fullscreenElement !== playerPanel) {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        }
        await playerPanel.requestFullscreen();
      }
    } else if (document.fullscreenElement) {
      await document.exitFullscreen();
    }

    syncFullscreenState();
  } catch (error) {
    state.errorMessage = getErrorMessage(error, t('fullscreenFailed'));
    syncFullscreenState();
  }
}

function syncFullscreenState(): void {
  state.isFullscreen = document.fullscreenElement === playerPanel;
  if (state.isFullscreen) {
    showFullscreenControls(FULLSCREEN_CONTROL_HIDE_MS);
  } else {
    clearFullscreenControlTimer();
    areFullscreenControlsVisible = false;
  }
  updateUi();
}

function showFullscreenControls(autoHideMs?: number): void {
  clearFullscreenControlTimer();
  areFullscreenControlsVisible = true;
  updateFullscreenControlVisibility();

  if (autoHideMs === undefined) {
    return;
  }

  fullscreenControlTimer = window.setTimeout(() => {
    areFullscreenControlsVisible = false;
    fullscreenControlTimer = null;
    updateFullscreenControlVisibility();
  }, autoHideMs);
}

function hideFullscreenControls(): void {
  if (!state.isFullscreen) {
    return;
  }

  clearFullscreenControlTimer();
  areFullscreenControlsVisible = false;
  updateFullscreenControlVisibility();
}

function startPlaybackStatusPolling(): void {
  stopPlaybackStatusPolling();
  playbackStatusTimer = window.setInterval(() => {
    void refreshPlaybackStatus();
  }, 500);
}

function stopPlaybackStatusPolling(): void {
  if (playbackStatusTimer !== null) {
    window.clearInterval(playbackStatusTimer);
    playbackStatusTimer = null;
  }
}

async function refreshPlaybackStatus(): Promise<void> {
  if (!state.mediaPath) {
    stopPlaybackStatusPolling();
    return;
  }

  try {
    const status = await invoke<MpvStatus>('mpv_get_status');
    applyMpvStatus(status);
  } catch {
    stopPlaybackStatusPolling();
  }
}

function applyMpvStatus(status: MpvStatus): void {
  state.isPlaying = status.isPlaying;
  state.currentTime = Number.isFinite(status.currentTime) ? status.currentTime : 0;
  state.duration = Number.isFinite(status.duration) ? status.duration : 0;
  state.volume = clamp(Math.round(status.volume), 0, 100);
  if (state.volume > 0) {
    state.previousVolume = state.volume;
  }
  volumeSlider.value = String(state.volume);

  if (state.mediaPath) {
    if (state.duration > 0 && state.currentTime >= state.duration - 0.25 && !state.isPlaying) {
      state.statusMessage = t('ended');
    } else {
      state.statusMessage = state.isPlaying ? t('playing') : t('paused');
    }
  }

  if (state.duration > 0) {
    state.resolutionLabel = 'mpv';
  }

  if (state.isFullscreen && state.isPlaying) {
    showFullscreenControls(FULLSCREEN_CONTROL_HIDE_MS);
  }

  updateUi();
}

function setPlaybackError(error: unknown): void {
  state.errorMessage = getErrorMessage(error, t('videoUnsupported'));
  state.statusMessage = t('openFileFailedStatus');
  updateUi();
}

function clearFullscreenControlTimer(): void {
  if (fullscreenControlTimer !== null) {
    window.clearTimeout(fullscreenControlTimer);
    fullscreenControlTimer = null;
  }
}

function updateFullscreenControlVisibility(): void {
  shell.classList.toggle(
    'is-controls-visible',
    !state.isFullscreen || areFullscreenControlsVisible,
  );
}

function resetVideoPresentation(): void {
  stageFrame.classList.toggle('has-media', Boolean(state.mediaPath));
  stageFrame.classList.remove('is-portrait');
}

async function refreshRecentFiles(): Promise<void> {
  try {
    state.recentFiles = await invoke<RecentMediaItem[]>('list_recent_files');
    updateUi();
  } catch (error) {
    state.errorMessage = getErrorMessage(error, '최근 파일을 읽지 못했습니다.');
    updateUi();
  }
}

function updateUi(): void {
  brandSubtitle.textContent = t('brandSubtitle');
  controls.toggleLanguage.textContent = t('languageButton');
  controls.openShortcutsTop.textContent = t('shortcuts');
  controls.openMediaTop.textContent = t('openFile');
  controls.closeWindow.textContent = t('close');
  controls.openMediaEmpty.textContent = t('openVideo');
  controls.openSubtitleEmpty.textContent = t('openSubtitle');
  controls.openSubtitleManual.textContent = t('chooseSubtitle');
  controls.refreshRecent.textContent = t('refresh');
  controls.disableSubtitle.textContent = t('off');
  controls.closeShortcuts.textContent = t('close');
  emptyEyebrow.textContent = t('emptyEyebrow');
  emptyTitle.innerHTML = renderEmptyTitle();
  emptyCopy.textContent = t('emptyCopy');
  subtitleHint.textContent = t('subtitleHint');
  recentHeading.textContent = t('recentFiles');
  subtitleHeading.textContent = t('subtitles');
  shortcutModalTitle.textContent = t('shortcutsTitle');
  languageModalTitle.textContent = t('languageTitle');
  languageModalCopy.textContent = t('languageCopy');
  mediaTitle.textContent = state.mediaTitle;
  mediaStatus.textContent = state.statusMessage;
  resolutionPill.textContent = state.resolutionLabel;
  subtitlePill.textContent = state.currentSubtitlePath ? t('subtitleActive') : t('subtitleWaiting');
  currentTimeLabel.textContent = formatTime(state.currentTime);
  durationTimeLabel.textContent = formatTime(state.duration);
  volumeValue.textContent = `${state.volume}%`;
  subtitleCaption.textContent = state.subtitleNotice;
  playIcon.innerHTML = state.isPlaying ? iconSvg('pause') : iconSvg('play');
  playButton.setAttribute('aria-label', state.isPlaying ? t('pause') : t('play'));
  playButton.title = state.isPlaying ? t('pause') : t('play');
  muteIcon.innerHTML = state.volume === 0 ? iconSvg('mute') : iconSvg('volume');
  muteButton.setAttribute('aria-label', state.volume === 0 ? t('unmute') : t('mute'));
  muteButton.title = state.volume === 0 ? t('unmute') : t('mute');
  restartButton.setAttribute('aria-label', t('restartPlayback'));
  restartButton.title = t('restartPlayback');
  controls.seekBackward.setAttribute('aria-label', t('seekBackward'));
  controls.seekBackward.title = t('seekBackward');
  controls.seekForward.setAttribute('aria-label', t('seekForward'));
  controls.seekForward.title = t('seekForward');
  fullscreenButton.textContent = state.isFullscreen ? t('exitFullscreen') : t('fullscreen');
  timeline.value =
    state.duration > 0 ? String(Math.round((state.currentTime / state.duration) * 1000)) : '0';

  shell.classList.toggle('is-fullscreen', state.isFullscreen);
  shell.classList.toggle('is-playing', state.isPlaying);
  updateFullscreenControlVisibility();
  shell.classList.remove('is-immersive-playback');
  emptyState.classList.toggle('hidden', Boolean(state.mediaPath));
  errorBanner.classList.toggle('hidden', state.errorMessage.length === 0);
  errorBanner.textContent = state.errorMessage;

  renderRecentFiles();
  renderSubtitleOptions();
  renderShortcutLabels();
  updateLanguageModalState();
}

function renderRecentFiles(): void {
  recentList.innerHTML = '';

  if (state.recentFiles.length === 0) {
    recentList.innerHTML = `<div class="placeholder-item">${escapeHtml(t('recentEmpty'))}</div>`;
    return;
  }

  for (const item of state.recentFiles) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'list-item';
    button.dataset.mediaPath = item.path;
    button.innerHTML = `
      <strong>${escapeHtml(item.displayName)}</strong>
      <span>${escapeHtml(item.path)}</span>
      <small>${formatDate(item.lastOpenedAt)}</small>
    `;
    recentList.appendChild(button);
  }
}

function renderSubtitleOptions(): void {
  subtitleList.innerHTML = '';

  if (state.subtitleOptions.length === 0) {
    subtitleList.innerHTML = `<div class="placeholder-item">${escapeHtml(t('subtitleNone'))}</div>`;
    return;
  }

  for (const subtitle of state.subtitleOptions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'list-item';
    if (subtitle.path === state.currentSubtitlePath) {
      button.classList.add('active');
    }
    button.dataset.subtitlePath = subtitle.path;
    button.innerHTML = `
      <strong>${escapeHtml(subtitle.displayName)}</strong>
      <span>${escapeHtml(subtitle.format.toUpperCase())}</span>
    `;
    subtitleList.appendChild(button);
  }
}

function renderShortcutLabels(): void {
  const rows = [
    ['Space', t('keyPlay')],
    ['Enter', t('keyFullscreen')],
    ['Left / Right', t('keySeek')],
    ['Up / Down', t('keyVolume')],
    ['F', t('keyFullscreen')],
    ['Esc', t('keyEsc')],
  ];

  const grid = shortcutModal.querySelector('.shortcut-grid');
  if (!grid) {
    return;
  }

  grid.innerHTML = rows
    .map(([key, label]) => `<span>${escapeHtml(key)}</span><strong>${escapeHtml(label)}</strong>`)
    .join('');
}

function renderEmptyTitle(): string {
  if (state.language === 'ko') {
    return '영상과 자막을 빠르게<br />여는 플레이어';
  }

  return escapeHtml(t('emptyTitle'));
}

function formatSubtitleCandidateCount(count: number): string {
  if (state.language === 'ko') {
    return `${count}개의 자막 후보를 찾았습니다.`;
  }

  return `${count} subtitle candidate${count === 1 ? '' : 's'} found.`;
}

function formatSubtitleApplied(displayName: string, automatic: boolean): string {
  if (state.language === 'ko') {
    return automatic
      ? `${displayName} 자막을 자동으로 적용했습니다.`
      : `${displayName} 자막을 적용했습니다.`;
  }

  return automatic
    ? `${displayName} was applied automatically.`
    : `${displayName} was applied.`;
}

function clearError(): void {
  state.errorMessage = '';
  updateUi();
}

function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '00:00';
  }

  const wholeSeconds = Math.floor(totalSeconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const seconds = wholeSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatDate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return t('justNow');
  }

  return new Intl.DateTimeFormat(state.language === 'ko' ? 'ko-KR' : 'en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.length > 0) {
    return error;
  }

  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return fallback;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLButtonElement ||
    target instanceof HTMLSelectElement
  );
}

function isTitlebarDragTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !target.closest('button, input, select, textarea, a');
}

function iconSvg(
  name:
    | 'play'
    | 'pause'
    | 'restart'
    | 'backward'
    | 'forward'
    | 'volume'
    | 'mute'
    | 'clock'
    | 'duration',
): string {
  switch (name) {
    case 'play':
      return `
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5.5v13l10-6.5-10-6.5Z" />
        </svg>
      `;
    case 'pause':
      return `
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
        </svg>
      `;
    case 'restart':
      return `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 12a9 9 0 1 0 3-6.708" />
          <path d="M3 4v4h4" />
        </svg>
      `;
    case 'backward':
      return `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 6 5 12l6 6" />
          <path d="m19 6-6 6 6 6" />
        </svg>
      `;
    case 'forward':
      return `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="m13 6 6 6-6 6" />
          <path d="m5 6 6 6-6 6" />
        </svg>
      `;
    case 'volume':
      return `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 10h4l5-4v12l-5-4H5z" />
          <path d="M18 9a4.5 4.5 0 0 1 0 6" />
          <path d="M20 6.5a8 8 0 0 1 0 11" />
        </svg>
      `;
    case 'mute':
      return `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 10h4l5-4v12l-5-4H5z" />
          <path d="m17 9 4 6" />
          <path d="m21 9-4 6" />
        </svg>
      `;
    case 'clock':
      return `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l3 2" />
        </svg>
      `;
    case 'duration':
      return `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M7 4h10" />
          <path d="M12 8v5l3 2" />
          <circle cx="12" cy="14" r="7" />
        </svg>
      `;
  }
}
