import { setupFormTabs } from './form-tabs';
import { applyExpenseFields, clearFareRows, expenseCellsWritable, FARE_FIELD_SUFFIXES } from './expense-fields';
import { getCellRegions, invalidateCellRegions } from './cell-fields';
import { createWasmBridge, documentOpenProblem, fetchTemplateBytes } from './template-loader';
import { TEMPLATE_FILES, templateKindFor, type TemplateKind } from './template-kind';
import { applyTripNameLine } from './trip-name';
import { clearCustomTemplate, customTemplateProblem, loadCustomTemplate, saveCustomTemplate, type CustomTemplate } from './custom-template';
import { applyAttachmentLines, attachmentLines, ATTACHMENT_PRESETS, hasAttachmentItem, toggleAttachmentItem } from './attachments';
import { setupFareSuggestions, type FareSuggestionsHandle } from './fare-suggestions';
import { discoverFields, fillDateTimeRange, removeDateTimeRangeSeparator, setFieldValues, setSuppressedFareGuideLabels, type FieldMap } from './field-filler';
import { downloadHwp } from './download';
import { mountPreview, refreshPreview, reloadPreservingScroll, setPreviewReloadHook } from './preview';
import { registerFontFaces, preloadFonts } from './fonts';
import { attachInlineEditing, type InlineEditHandle } from './field-interaction';
import {
  buildDateTimeRangeChrome,
  showStampPopover,
  type FareDirection,
  type RangeChromeHandle,
} from './field-popover';
import { setupDateTimePicker, type DateTimePickerController } from './datetime-picker';
import { SignatureStampManager } from './signature-stamp';
import { clearStoredSignatureStamp, hasStoredSignatureStamp, loadStoredSignatureStamp, saveStoredSignatureStamp } from './signature-storage';
import { setupApplicantInfoStorage } from './applicant-storage';
import { createDefaultStamp, openStampGenerator } from './stamp-generator';
import { printPdf, type PdfSaveResult } from './print-pdf';
import { pushRecentValue } from './recent-values';
import { isPlaceLookupEnabled, lookupPlaceCityLoose, type PlaceCity } from './kakao-places';
import { joinCities, splitPlaces } from './place-region';
import { defaultSubmitDate } from './date-range';
import {
  buildShareUrl,
  clearUrlFormValues,
  copyTextToClipboard,
  hasUrlFormValues,
  isShareButtonUrl,
  readUrlFormValues,
} from './url-share';
import {
  FIELD_CONFIGS,
  GRADE_OPTIONS,
  TRANSPORT_OPTIONS,
  formatDateKR,
  formatDateTimeRange,
  parseDateKR,
  parseDateTimeRange,
} from './field-config';

/**
 * 출장신청서 자동작성기 엔트리.
 *
 * 두 가지 입력 경로:
 *  - 사이드패널 폼에서 16개 항목을 한꺼번에 입력 → "미리보기에 반영"
 *  - 미리보기에서 누름틀을 직접 클릭 → 팝오버에서 한 항목씩 수정
 *
 * 양쪽이 같은 setFieldValues / FieldMap 을 공유하므로 어느 쪽으로 수정해도 결과는 동일.
 */

// GitHub Pages 등 하위 경로 배포 대응 — BASE_URL 기준 상대 경로
const templateUrl = (kind: TemplateKind): string => `${import.meta.env.BASE_URL}${TEMPLATE_FILES[kind]}`;
const FORM_STORAGE_KEY = 'business-trip-form:form-values:v1';
const EDIT_HINTS_STORAGE_KEY = 'business-trip-form:edit-hints:v1';
const EXTENSION_GUIDE_STORAGE_KEY = 'business-trip-form:extension-guide-hidden:v1';

const statusEl = document.getElementById('status') as HTMLElement;
const formEl = document.getElementById('trip-form') as HTMLFormElement;
const previewContainer = document.getElementById('scroll-container') as HTMLDivElement;
const appBodyEl = document.querySelector('.app-body') as HTMLDivElement;
const toggleBtn = document.getElementById('btn-toggle-panel') as HTMLButtonElement;
const hintToggleBtn = document.getElementById('btn-toggle-hints') as HTMLButtonElement | null;
const signatureInput = document.getElementById('signature-image') as HTMLInputElement | null;
const signatureRotateBtn = document.getElementById('btn-rotate-signature') as HTMLButtonElement | null;
/** 앱이 만든 도장(자동 생성·도장 만들기)의 기본 기울기. 손으로 찍은 듯 보이도록 살짝 기울인다. */
const DEFAULT_STAMP_ROTATION_DEG = 7;
const signatureClearBtn = document.getElementById('btn-clear-signature') as HTMLButtonElement | null;
const signatureSaveBtn = document.getElementById('btn-save-signature') as HTMLButtonElement | null;
const signatureClearSavedBtn = document.getElementById('btn-clear-saved-signature') as HTMLButtonElement | null;
const signatureCurrentRoot = document.getElementById('signature-current') as HTMLElement | null;
const signatureCurrentThumb = document.getElementById('signature-current-thumb') as HTMLImageElement | null;
const signatureCurrentLabel = document.getElementById('signature-current-label') as HTMLElement | null;
const TRAVEL_DATE_DEFAULTS: Record<string, string> = {
  시작일시: '갈때일자',
  종료일시: '올때일자',
};
/** 갈 때 값으로 채우는 올 때 칸 — 출발지·도착지는 거꾸로, 교통편은 그대로 (대개 같은 교통편으로 돌아온다). */
const RETURN_TRIP_DEFAULTS: Record<string, string> = {
  갈때출발지: '올때도착지',
  갈때도착지: '올때출발지',
  갈때교통편: '올때교통편',
};
/** 지도 검색으로 도시명을 찾아 채울 곳 — 소속은 갈 때 출발지, 출장지는 갈 때 도착지 (올 때는 위 규칙이 거꾸로 채운다) */
const PLACE_CITY_DEFAULTS: Record<string, string> = {
  소속: '갈때출발지',
  출장지: '갈때도착지',
};
const PLACE_LOOKUP_DELAY_MS = 800;
const dateTimeControllers = new WeakMap<HTMLElement, DateTimePickerController>();
/** 사이드바 출장 일시(시작/종료)를 한 묶음으로 감싸는 공통 UI — 미리보기 팝오버와 동작을 공유한다. */
let dateTimeRangeChrome: RangeChromeHandle | null = null;
const autoTravelDates = new Map<string, string>();
const autoReturnLocations = new Map<string, string>();
/** 지도 검색으로 채운 출발지·도착지 값 — 사용자가 직접 고친 값은 덮어쓰지 않으려고 기억한다. */
const autoPlaceCities = new Map<string, string>();
/** 운임 탭의 금액 제안 칩 (fare-suggestions.ts) — 설정 전에는 null */
let fareSuggestions: FareSuggestionsHandle | null = null;
let liveDateTimePreviewHandler: (() => void) | null = null;
/** 인라인 편집 핸들 — 편집 가능 칸 마커 갱신/토글에 쓴다 (부착 전에는 null). */
let inlineEdit: InlineEditHandle | null = null;

/** "편집 가능 칸 표시" 설정 — 기본은 켜짐 (처음 쓰는 사람이 클릭할 자리를 알 수 있게) */
function loadEditHintsPreference(): boolean {
  try {
    return localStorage.getItem(EDIT_HINTS_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

function applyEditHintsVisible(visible: boolean): void {
  inlineEdit?.setHintsVisible(visible);
  if (hintToggleBtn) hintToggleBtn.setAttribute('aria-pressed', visible ? 'true' : 'false');
}

interface PreviewApplyOptions {
  clearEmpty?: boolean;
}

interface SavedFormState {
  autoPlaceCities?: Record<string, string>;
  autoReturnLocations?: Record<string, string>;
  autoTravelDates?: Record<string, string>;
  updatedAt?: string;
  values?: Record<string, string>;
}


let statusHideTimer = 0;

/**
 * 상태 메시지를 미리보기 위 토스트로 표시한다. 폼 패널이 닫힌 모바일에서도 보이도록
 * 폼 바깥(#app 직속)에 두고, 일정 시간 후 자동으로 사라진다 (에러는 더 오래 유지).
 */
function setStatus(message: string, isError = false): void {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
  statusEl.classList.add('is-visible');
  window.clearTimeout(statusHideTimer);
  statusHideTimer = window.setTimeout(
    () => statusEl.classList.remove('is-visible'),
    isError ? 8000 : 4000,
  );
}

/** 지금 쓰는 양식 — 내장 양식 둘 중 하나, 또는 사용자가 올린 양식 */
type ActiveTemplate = TemplateKind | 'custom';

/** 사용자가 올린 양식 (없으면 소속에 맞는 내장 양식을 쓴다) */
let customTemplate: CustomTemplate | null = null;
/** 올린 양식의 표가 기본 양식과 같은 구조라 일반 칸(식비·동승자·등급·금액)에 값을 써도 되는지 */
let customExpenseWritable = false;

/** 지금 쓸 양식 — 올린 양식이 있으면 그것, 없으면 소속에 맞는 양식 (태백교육지원청이면 태백 양식) */
function currentTemplateKind(): ActiveTemplate {
  if (customTemplate) return 'custom';
  const org = formEl.elements.namedItem('소속');
  return templateKindFor(org instanceof HTMLInputElement ? org.value : '');
}

/** 한 양식에만 있는 입력(예: 기본 양식의 식비)은 그 양식일 때만 보인다. 올린 양식은 기본 양식과 같은 입력을 보여 준다. */
function syncTemplateOnlyInputs(): void {
  const kind = currentTemplateKind();
  const shown = kind === 'custom' ? 'default' : kind;
  formEl.querySelectorAll<HTMLElement>('[data-template-only]').forEach((el) => {
    el.hidden = el.dataset.templateOnly !== shown;
  });
}

function collectFormValues(): Record<string, string> {
  syncAllDateTimeControlsToHidden();
  const data = new FormData(formEl);
  const raw: Record<string, string> = {};
  data.forEach((v, k) => {
    raw[k] = typeof v === 'string' ? v : '';
  });
  const name = raw.성명 ?? '';
  for (const direction of ['갈때', '올때']) {
    if (raw[`${direction}운임삭제`] === '1') {
      for (const suffix of ['일자', '교통편', '출발지', '도착지']) raw[`${direction}${suffix}`] = '';
    }
  }
  const startDateTime = raw.시작일시 ?? '';
  const endDateTime = raw.종료일시 ?? '';
  const kind = currentTemplateKind();
  return {
    소속: raw.소속 ?? '',
    직급: raw.직급 ?? '',
    성명: name,
    이름: name,
    // 시작·종료를 한 누름틀(시작일시)에 합쳐 넣는다 — 종료일시 누름틀은 fillDateTimeRange 가 비운다
    시작일시: formatDateTimeRange(startDateTime, endDateTime),
    출장지: raw.출장지 ?? '',
    // 출장명 누름틀은 태백 양식에만 있다. 기본 양식은 applyTripNameLine 이 출장지 셀 아래 줄에 넣는다.
    // (올린 양식은 출장명 누름틀이 있는지에 따라 applyCollectedValuesToPreview 가 정한다.)
    ...(kind === 'taebaek' ? { 출장명: raw.출장명 ?? '' } : {}),
    갈때일자: formatDateKR(raw.갈때일자 ?? ''),
    갈때교통편: raw.갈때교통편 ?? '',
    갈때출발지: raw.갈때출발지 ?? '',
    갈때도착지: raw.갈때도착지 ?? '',
    올때일자: formatDateKR(raw.올때일자 ?? ''),
    올때교통편: raw.올때교통편 ?? '',
    올때출발지: raw.올때출발지 ?? '',
    올때도착지: raw.올때도착지 ?? '',
    제출날짜: formatDateKR(raw.제출날짜 ?? ''),
    // 누름틀에는 첫 줄만 — 둘째 줄부터는 applyAttachmentLines 가 누름틀 아래 문단에 넣는다
    첨부서류: attachmentLines(raw.첨부서류 ?? '')[0] ?? '',
  };
}

function setupLocalFormPersistence(): void {
  formEl.addEventListener('input', saveFormState);
  formEl.addEventListener('change', saveFormState);
  // 신청인 소속이 채워지면 동승자 「같음」 버튼도 함께 쓸 수 있게 된다.
  formEl.addEventListener('input', () => syncPassengerOrgButtons?.());
  formEl.addEventListener('change', () => syncPassengerOrgButtons?.());
  formEl.addEventListener('input', updateRequiredBadges);
  formEl.addEventListener('change', updateRequiredBadges);
}

/** 첨부서류 입력 동기화용 — 인라인 편집 등으로 값이 바뀌었을 때 칩 활성 상태를 맞춘다. */
let syncAttachmentPresetChips: (() => void) | null = null;

/**
 * 첨부서류 입력창 위의 "자주 쓰는 항목" 토글 칩.
 * 누르면 새 줄로 추가, 다시 누르면 제거 — 들어있는 동안은 파랗게 표시된다.
 */
function setupAttachmentPresets(): void {
  const wrap = document.getElementById('attachment-presets');
  const textarea = formEl.elements.namedItem('첨부서류');
  if (!wrap || !(textarea instanceof HTMLTextAreaElement)) return;

  const chips = ATTACHMENT_PRESETS.map((preset) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'attachment-preset-chip';
    btn.textContent = preset;
    btn.addEventListener('click', () => {
      textarea.value = toggleAttachmentItem(textarea.value, preset);
      // input 이벤트로 미리보기 반영 + 임시저장까지 한 번에 태운다
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      sync();
    });
    wrap.appendChild(btn);
    return { btn, preset };
  });

  const sync = (): void => {
    for (const { btn, preset } of chips) {
      btn.classList.toggle('is-active', hasAttachmentItem(textarea.value, preset));
    }
  };
  textarea.addEventListener('input', sync);
  syncAttachmentPresetChips = sync;
  sync();
}

/** 운임 탭 빠른 선택 칩 — 교통편(방향별)과 등급. 미리보기 팝오버의 선택지와 같은 목록을 쓴다. */
let syncPresetChips: (() => void) | null = null;

function setupPresetChips(): void {
  const groups: Array<{ input: HTMLInputElement; chips: HTMLButtonElement[] }> = [];
  const attach = (wrap: HTMLElement, inputName: string, options: readonly string[]): void => {
    const input = formEl.elements.namedItem(inputName);
    if (!(input instanceof HTMLInputElement)) return;
    const chips = options.map((option) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'attachment-preset-chip';
      btn.textContent = option;
      btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', () => {
        // 같은 칩을 다시 누르면 비운다 (첨부서류 칩과 같은 토글 감각)
        input.value = input.value === option ? '' : option;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        sync();
      });
      wrap.appendChild(btn);
      return btn;
    });
    groups.push({ input, chips });
    input.addEventListener('input', sync);
  };
  formEl.querySelectorAll<HTMLElement>('[data-transport-presets]').forEach((wrap) => {
    attach(wrap, `${wrap.dataset.transportPresets ?? ''}교통편`, TRANSPORT_OPTIONS);
  });
  formEl.querySelectorAll<HTMLElement>('[data-grade-presets]').forEach((wrap) => attach(wrap, '등급', GRADE_OPTIONS));

  function sync(): void {
    for (const { input, chips } of groups) {
      for (const chip of chips) {
        const active = chip.textContent === input.value.trim();
        chip.classList.toggle('is-active', active);
        chip.setAttribute('aria-pressed', String(active));
      }
    }
  }
  syncPresetChips = sync;
  sync();
}

/**
 * 비어 있는 필수 항목 — 표시 중이고 활성화된 입력만 센다 (운임 행을 삭제하면 그 행의 칸은 제외).
 * 출장 일시처럼 hidden input 으로만 존재하는 항목은 data-required-label 로 필수임을 표시한다.
 */
interface MissingRequiredField {
  control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  label: string;
  panel: HTMLElement | null;
}

function findMissingRequired(): MissingRequiredField[] {
  const missing: MissingRequiredField[] = [];
  for (const el of Array.from(formEl.elements)) {
    if (
      !(el instanceof HTMLInputElement) &&
      !(el instanceof HTMLTextAreaElement) &&
      !(el instanceof HTMLSelectElement)
    ) continue;
    const explicitLabel = el.dataset.requiredLabel;
    if (!el.required && !explicitLabel) continue;
    if (el.disabled || el.closest('[hidden]:not(.form-tab-panel)')) continue;
    if (el.value.trim()) continue;
    missing.push({
      control: el,
      label: explicitLabel ?? describeRequiredControl(el),
      panel: el.closest<HTMLElement>('.form-tab-panel'),
    });
  }
  return missing;
}

function describeRequiredControl(el: HTMLElement): string {
  const labelText = el.closest('label')?.firstChild?.textContent?.trim() ?? '';
  const fare = el.closest<HTMLElement>('[data-fare-inputs]')?.dataset.fareInputs;
  const prefix = fare === '갈때' ? '갈 때 ' : fare === '올때' ? '올 때 ' : '';
  return `${prefix}${labelText || (el as HTMLInputElement).name}`;
}

/** 탭 버튼의 미입력 배지를 갱신한다. */
function updateRequiredBadges(): void {
  const counts = new Map<string, number>();
  for (const item of findMissingRequired()) {
    if (!item.panel) continue;
    counts.set(item.panel.id, (counts.get(item.panel.id) ?? 0) + 1);
  }
  formEl.querySelectorAll<HTMLButtonElement>('[data-form-tab]').forEach((tab) => {
    const badge = tab.querySelector<HTMLElement>('.form-tab__badge');
    const name = tab.querySelector('.form-tab__label')?.textContent ?? tab.textContent ?? '';
    const count = counts.get(tab.getAttribute('aria-controls') ?? '') ?? 0;
    if (badge) {
      badge.textContent = String(count);
      badge.hidden = count === 0;
    }
    tab.setAttribute('aria-label', count > 0 ? `${name}, 미입력 ${count}개` : name);
  });
}

/** 미리보기의 첫 빈 필수칸으로 이동 — 해당 탭을 열고 폼 패널을 펼친 뒤 포커스한다. */
function focusMissingRequired(item: MissingRequiredField): void {
  appBodyEl.classList.remove('panel-collapsed');
  syncPanelToggleState();
  const tab = item.panel
    ? formEl.querySelector<HTMLButtonElement>(`[data-form-tab][aria-controls="${item.panel.id}"]`)
    : null;
  tab?.click();
  const target = item.control.type === 'hidden'
    ? item.control.closest<HTMLElement>('.datetime-picker')?.querySelector<HTMLInputElement>('input:not([type="hidden"])')
    : item.control;
  target?.focus();
  target?.scrollIntoView({ block: 'center' });
}

/**
 * 미리보기에서 칸을 눌렀을 때 사이드패널에 그 칸의 입력이 든 탭을 보여 준다.
 * 폼 패널을 접어 둔 상태면 그대로 둔다 (펼치지 않는다). 포커스는 팝오버에 남겨 둔다.
 */
function revealFormControl(name: string): void {
  if (appBodyEl.classList.contains('panel-collapsed')) return;
  const control = formEl.elements.namedItem(name === '이름' ? '성명' : name);
  const el = control instanceof RadioNodeList ? control[0] : control;
  if (!(el instanceof HTMLElement)) return;
  const panel = el.closest<HTMLElement>('.form-tab-panel');
  if (panel?.hidden) formEl.querySelector<HTMLButtonElement>(`[data-form-tab][aria-controls="${panel.id}"]`)?.click();
  // 숨은 입력(일시)은 화면에 보이는 선택기 쪽으로 스크롤한다
  const visible = el instanceof HTMLInputElement && el.type === 'hidden'
    ? el.closest<HTMLElement>('label, fieldset') ?? el.parentElement
    : el;
  visible?.scrollIntoView({ block: 'nearest' });
}

/**
 * 출력(HWP/PDF) 전에 빈 필수칸을 알린다. 의도적으로 비워 두는 경우가 있으므로 막지는 않고,
 * 그대로 진행할지 묻는다 — 취소하면 첫 빈칸으로 이동한다.
 */
function confirmMissingRequired(actionLabel: string): boolean {
  const missing = findMissingRequired();
  if (missing.length === 0) return true;
  const names = missing.map((item) => item.label);
  const shown = names.slice(0, 6).join(', ') + (names.length > 6 ? ` 외 ${names.length - 6}개` : '');
  const ok = window.confirm(`필수 항목 ${missing.length}개가 비어 있습니다.\n${shown}\n\n그대로 ${actionLabel}할까요?`);
  if (!ok) {
    focusMissingRequired(missing[0]);
    setStatus(`빈 항목부터 채워 주세요: ${missing[0].label}`);
  }
  return ok;
}

/**
 * 링크(확장프로그램·「URL 공유」)로 새 출장을 열 때 저장본에서 이어 쓰는 칸 — 신청인 정보와 매번 같기 쉬운 선택.
 * 나머지(출장지·일시·운임·식비·동승자·첨부서류·제출날짜·운임 행 삭제)는 출장마다 달라 빈 칸에서 시작한다.
 */
const URL_CARRY_OVER_KEYS: ReadonlySet<string> = new Set(['소속', '직급', '성명', '등급', '갈때교통편', '올때교통편']);

/**
 * 저장된 입력을 폼에 되살린다. keepOnly 를 주면 그 칸만 되살리고 자동 입력 기록은 버린다 —
 * 링크로 연 새 출장에 지난 출장의 값이 섞여 빈칸 확인에도 걸리지 않은 채 찍히던 문제를 막는다.
 */
function restoreFormState(keepOnly?: ReadonlySet<string>): boolean {
  let saved: SavedFormState | null = null;
  try {
    const raw = localStorage.getItem(FORM_STORAGE_KEY);
    saved = raw ? JSON.parse(raw) as SavedFormState : null;
  } catch {
    return false;
  }
  if (!saved?.values) return false;

  for (const [name, value] of Object.entries(saved.values)) {
    if (keepOnly && !keepOnly.has(name)) continue;
    const control = findValueControl(name);
    if (control) setFormControlValue(control, value);
  }

  autoTravelDates.clear();
  autoReturnLocations.clear();
  autoPlaceCities.clear();
  if (keepOnly) return true;
  for (const [name, value] of Object.entries(saved.autoTravelDates ?? {})) {
    autoTravelDates.set(name, value);
  }
  for (const [name, value] of Object.entries(saved.autoReturnLocations ?? {})) {
    autoReturnLocations.set(name, value);
  }
  for (const [name, value] of Object.entries(saved.autoPlaceCities ?? {})) {
    autoPlaceCities.set(name, value);
  }
  return true;
}

type ValueControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** 값을 넣을 수 없는 input — 파일 선택칸은 빈 문자열이 아닌 값을 넣으면 예외가 난다. */
const NON_VALUE_INPUT_TYPES = new Set(['file', 'button', 'submit', 'reset', 'image']);

/**
 * name 이 정확히 같은 값 입력칸을 찾는다. elements.namedItem 은 id 로도 찾아서, 링크에
 * `#signature-image=x` 같은 키가 있으면 파일 선택칸에 값을 넣다 예외가 나 시작이 통째로 멈췄다.
 */
function findValueControl(name: string): ValueControl | null {
  for (const el of Array.from(formEl.elements)) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) continue;
    if (el.name !== name) continue;
    if (el instanceof HTMLInputElement && NON_VALUE_INPUT_TYPES.has(el.type)) continue;
    return el;
  }
  return null;
}

function saveFormState(): void {
  try {
    localStorage.setItem(FORM_STORAGE_KEY, JSON.stringify({
      autoPlaceCities: Object.fromEntries(autoPlaceCities),
      autoReturnLocations: Object.fromEntries(autoReturnLocations),
      autoTravelDates: Object.fromEntries(autoTravelDates),
      updatedAt: new Date().toISOString(),
      values: collectRawFormValues(),
    } satisfies SavedFormState));
  } catch {
    // Safari private mode 등 저장소를 쓸 수 없는 환경에서는 저장만 건너뛴다.
  }
}

function clearSavedFormState(): void {
  try { localStorage.removeItem(FORM_STORAGE_KEY); } catch { /* ignore */ }
}

function setDefaultSubmitDate(): void {
  const end = formEl.elements.namedItem('종료일시') as HTMLInputElement | null;
  applySubmitDateDefault(end?.value.slice(0, 10) ?? '');
}

/**
 * 제출날짜 기본값은 오늘, 출장 종료일이 오늘 이후면 종료 다음날 (defaultSubmitDate).
 * 비었거나 전에 자동으로 넣은 날짜·오늘 날짜일 때만 바꾸고, 직접 고른 날짜는 그대로 둔다.
 */
function applySubmitDateDefault(endDate: string): void {
  const input = formEl.elements.namedItem('제출날짜') as HTMLInputElement | null;
  if (!input) return;
  const today = todayDateValue();
  const previousAuto = autoTravelDates.get('제출날짜');
  if (input.value && input.value !== previousAuto && input.value !== today) return;
  const next = defaultSubmitDate(endDate, today);
  input.value = next;
  autoTravelDates.set('제출날짜', next);
}

function collectRawFormValues(): Record<string, string> {
  syncAllDateTimeControlsToHidden();
  const values: Record<string, string> = {};
  for (const el of Array.from(formEl.elements)) {
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLTextAreaElement
    ) {
      if (el.name) values[el.name] = el.value;
    }
  }
  return values;
}

/** 인라인 편집으로 누름틀이 바뀌면 같은 라벨의 폼 입력도 동기화한다. */
function syncFormFromInline(label: string, hwpValue: string): void {
  const cfg = FIELD_CONFIGS[label];
  if (!cfg) return;
  // 시작·종료 일시는 한 누름틀(시작일시)에 범위로 합쳐 있으므로 양쪽 입력을 함께 갱신
  if (label === '시작일시' || label === '종료일시') {
    const { start, end } = parseDateTimeRange(hwpValue);
    setDateTimeControlValue('시작일시', start);
    setDateTimeControlValue('종료일시', end);
    dateTimeRangeChrome?.refresh();
    return;
  }
  const inputName = label === '이름' ? '성명' : label;
  const input = formEl.elements.namedItem(inputName) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
  if (!input) return;
  if (cfg.type === 'date') setFormControlValue(input, parseDateKR(hwpValue));
  else setFormControlValue(input, hwpValue);
  if (label === '첨부서류') syncAttachmentPresetChips?.();
  // 미리보기에서 소속을 고쳤으면 동승자 「같음」 버튼도 다시 쓸 수 있게 된다
  if (label === '소속') syncPassengerOrgButtons?.();
  if (label.endsWith('교통편')) syncPresetChips?.();
}

function setFormControlValue(
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
): void {
  if (control instanceof HTMLSelectElement) {
    ensureSelectOption(control, value);
  }
  control.value = value;
}

/**
 * URL 해시(또는 예전 쿼리스트링)의 값 중 폼에 있는 칸에 들어갈 것만 고른다.
 * 폼에 없는 키뿐인 링크는 빈 목록 — 그때는 저장본을 평소처럼 모두 되살린다.
 */
function readUrlFormEntries(): Array<[ValueControl, string]> {
  if (!hasUrlFormValues()) return [];
  // 「URL 공유」 링크는 보낸 사람이 입력한 그대로 연다 — 소속 줄이기는 외부에서 넘어온 값에만.
  const shortenOrg = !isShareButtonUrl();
  const entries: Array<[ValueControl, string]> = [];
  for (const [name, rawValue] of Object.entries(readUrlFormValues())) {
    const control = findValueControl(name);
    if (!control) continue;
    entries.push([control, shortenOrg && ORG_KEY.test(name) ? shortenOrgName(rawValue) : rawValue]);
  }
  return entries;
}

/** 신청인·동승자 소속 칸 */
const ORG_KEY = /^(동승자[1-4])?소속$/;

/**
 * 외부(확장프로그램 등)에서 URL 로 받은 소속은 "강원특별자치도고성교육지원청 교육과" 처럼 부서까지 붙어 칸에 비해 긴 경우가 많아,
 * 기본값은 첫 띄어쓰기 앞(기관명)까지만 쓴다. 원래 전체 값은 소속 "최근 입력" 칩에 남겨 다시 고를 수 있게 한다.
 */
function shortenOrgName(value: string): string {
  const full = value.trim();
  const short = full.split(/\s+/)[0] ?? '';
  if (short !== full) pushRecentValue('소속', full);
  return short;
}

function ensureSelectOption(select: HTMLSelectElement, value: string): void {
  if (!value) return;
  const exists = Array.from(select.options).some((option) => option.value === value);
  if (exists) return;
  const option = document.createElement('option');
  option.value = value;
  option.textContent = value;
  select.appendChild(option);
}

/** ☰ 버튼이 현재 상태(펼침/접힘)를 라벨과 aria 로 함께 드러내게 한다. */
function syncPanelToggleState(): void {
  const expanded = !appBodyEl.classList.contains('panel-collapsed');
  toggleBtn.setAttribute('aria-expanded', String(expanded));
  const label = expanded ? '입력 폼 접기' : '입력 폼 열기';
  toggleBtn.title = label;
  toggleBtn.setAttribute('aria-label', label);
  const labelEl = toggleBtn.querySelector('.panel-toggle__label');
  if (labelEl) labelEl.textContent = label;
}

function setupPanelToggle(): void {
  const mobileQuery = window.matchMedia('(max-width: 800px)');
  const syncAria = syncPanelToggleState;
  // 모바일은 기본 접힘 (미리보기 우선), 데스크톱은 기본 펼침
  if (mobileQuery.matches) appBodyEl.classList.add('panel-collapsed');
  // 창 크기 변경/기기 회전으로 모바일 ↔ 데스크톱이 바뀌면 그 시점의 기본 상태로 보정
  mobileQuery.addEventListener('change', (e) => {
    appBodyEl.classList.toggle('panel-collapsed', e.matches);
    syncAria();
  });
  toggleBtn.addEventListener('click', () => {
    appBodyEl.classList.toggle('panel-collapsed');
    syncAria();
  });
  syncAria();
}

/**
 * 크롬 확장프로그램 안내 — 「안내 닫기」를 누르면 이 브라우저에서는 다시 보이지 않는다.
 * 확장프로그램이 넘긴 링크로 열었으면 이미 설치한 사람이므로 처음부터 감춘다.
 * (휴대폰·태블릿은 확장프로그램을 설치할 수 없어 CSS 가 감춘다.)
 */
function setupExtensionGuide(openedByExtension: boolean): void {
  const guide = document.querySelector<HTMLElement>('.extension-guide');
  if (!guide) return;
  const hide = (): void => {
    guide.hidden = true;
    try {
      localStorage.setItem(EXTENSION_GUIDE_STORAGE_KEY, '1');
    } catch { /* 저장소를 못 쓰면 이번 방문에만 감춘다 */ }
  };
  let dismissed = false;
  try {
    dismissed = localStorage.getItem(EXTENSION_GUIDE_STORAGE_KEY) === '1';
  } catch { /* 저장소를 못 쓰면 안내를 보인다 */ }
  if (dismissed || openedByExtension) hide();
  document.getElementById('btn-hide-extension-guide')?.addEventListener('click', hide);
}

function setupDateTimeControls(): void {
  const startControl = formEl.querySelector<HTMLElement>('[data-datetime-picker="시작일시"]');
  const endControl = formEl.querySelector<HTMLElement>('[data-datetime-picker="종료일시"]');
  if (!startControl || !endControl) return;

  // 프리셋·자동제안처럼 chrome 내부에서 picker.setValue 로 값을 바꾼 경우 picker onChange 가 안 뜨므로,
  // 그 직후 양쪽 출발/도착 기본일자 + 미리보기를 직접 동기화한다.
  const syncSidebar = (): void => {
    applyTravelDateDefault(startControl);
    applyTravelDateDefault(endControl);
    liveDateTimePreviewHandler?.();
  };

  const startController = setupDateTimePicker(startControl, {
    defaultHour: startControl.dataset.datetimeDefaultHour,
    inline: true,
    onChange: () => {
      applyTravelDateDefault(startControl);
      liveDateTimePreviewHandler?.();
      dateTimeRangeChrome?.handleStartChange();
    },
  });
  const endController = setupDateTimePicker(endControl, {
    defaultHour: endControl.dataset.datetimeDefaultHour,
    inline: true,
    onChange: () => {
      applyTravelDateDefault(endControl);
      liveDateTimePreviewHandler?.();
      dateTimeRangeChrome?.refresh();
    },
  });
  if (startController) {
    dateTimeControllers.set(startControl, startController);
    applyTravelDateDefault(startControl);
  }
  if (endController) {
    dateTimeControllers.set(endControl, endController);
    applyTravelDateDefault(endControl);
  }

  // 두 picker 를 탭·빠른선택·경고로 감싼다 — buildDateTimeRangeChrome 가 picker 를 판 안으로 옮겨 담는다.
  dateTimeRangeChrome = buildDateTimeRangeChrome({
    startPicker: startControl,
    endPicker: endControl,
    onChange: syncSidebar,
  });
  document.getElementById('datetime-range')?.appendChild(dateTimeRangeChrome.root);
}

function setupReturnTripDefaults(): void {
  for (const sourceName of Object.keys(RETURN_TRIP_DEFAULTS)) {
    const source = formEl.elements.namedItem(sourceName);
    if (!(source instanceof HTMLInputElement)) continue;
    const apply = (): void => {
      // 올 때 교통편이 바뀌면 그 칸의 빠른 선택 칩 표시도 맞춘다 (값만 바꿔서 칩 쪽 input 이벤트가 없다).
      if (applyReturnTripDefault(sourceName)) syncPresetChips?.();
    };
    source.addEventListener('input', apply);
    source.addEventListener('change', apply);
    apply();
  }
}

/**
 * 소속·출장지를 지도에서 찾아 그 장소가 있는 도시명을 운임 출발지·도착지에 채운다.
 * 예: "강원특별자치도고성교육지원청" → 출발지 "고성", "삼척다목적체육관" → 도착지 "삼척".
 * 비어 있거나 전에 자동으로 채운 칸만 바꾸고, 사용자가 직접 쓴 값은 그대로 둔다.
 * URL·저장본으로 채워진 값도 시작할 때 한 번 찾는다.
 */
function setupPlaceCityLookup(): void {
  if (!isPlaceLookupEnabled()) return;
  for (const sourceName of Object.keys(PLACE_CITY_DEFAULTS)) {
    const source = formEl.elements.namedItem(sourceName);
    if (!(source instanceof HTMLInputElement)) continue;
    let timer = 0;
    const schedule = (delay: number): void => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { void applyPlaceCity(sourceName); }, delay);
    };
    // 인라인 편집은 input 만 보내므로 input 은 입력이 멈출 때까지 기다리고, change(포커스 이동)는 바로 찾는다.
    source.addEventListener('input', () => schedule(PLACE_LOOKUP_DELAY_MS));
    source.addEventListener('change', () => schedule(0));
    // URL·저장본으로 채워진 값은 입력 이벤트가 없으므로 시작할 때 한 번 찾는다 (빈 칸만 채운다).
    void applyPlaceCity(sourceName);
  }
}

async function applyPlaceCity(sourceName: string): Promise<void> {
  const targetName = PLACE_CITY_DEFAULTS[sourceName];
  const source = formEl.elements.namedItem(sourceName) as HTMLInputElement | null;
  const target = formEl.elements.namedItem(targetName) as HTMLInputElement | null;
  if (!source || !target) return;
  const query = source.value.trim();
  if (!query) return;

  let found: PlaceCity[];
  try {
    const results = await Promise.all(splitPlaces(query).map((place) => lookupPlaceCityLoose(place)));
    found = results.filter((result): result is PlaceCity => result !== null);
  } catch (err) {
    console.error(err);
    return;
  }
  // 검색하는 동안 입력이 바뀌었거나 사용자가 직접 칸을 채웠으면 결과를 버린다.
  if (source.value.trim() !== query || found.length === 0 || target.disabled) return;
  const city = joinCities(found.map((result) => result.city));
  // 찾은 장소가 한 도시면 그 시도를 기억한다 — 칸에는 "고성" 만 들어가도 강원 고성·경남 고성을 가려 운임을 찾는다.
  const regions = new Set(found.map((result) => `${result.시도} ${result.city}`));
  const rememberRegion = (): void => {
    fareSuggestions?.setRegionHint(targetName, city, regions.size === 1 && found[0].시도 ? { 시도: found[0].시도, 시군: found[0].city } : null);
  };
  const previousAutoValue = autoPlaceCities.get(targetName);
  if (target.value && target.value !== previousAutoValue) {
    // 직접 썼거나 URL·저장본으로 채워진 값이 찾은 도시와 같으면 시도만 기억한다.
    if (target.value.trim() === city) {
      rememberRegion();
      fareSuggestions?.sync();
    }
    return;
  }

  autoPlaceCities.set(targetName, city);
  rememberRegion();
  fareSuggestions?.sync();
  if (setFormFieldValue(targetName, city)) {
    const label = targetName.endsWith('출발지') ? '출발지' : '도착지';
    const places = found.map((result) => `${result.placeName} · ${result.address}`).join(' / ');
    setStatus(`${label}를 "${city}"(으)로 채웠습니다 — ${places}`);
  }
}

function syncAllDateTimeControlsToHidden(): void {
  for (const control of formEl.querySelectorAll<HTMLElement>('[data-datetime-picker]')) {
    dateTimeControllers.get(control)?.syncHidden();
  }
}

/**
 * 모든 일시 picker 를 빈 값으로 강제 초기화한다.
 *
 * `<input type="hidden">` 은 일반 입력과 달리 `.value =` 만 해도 defaultValue/attribute 가 함께
 * 변하기 때문에, `formEl.reset()` 이 이전에 적용된 값을 "기본값" 으로 오해해 그대로 두는 문제가 있다.
 * 그래서 초기화 시에는 hidden value 와 attribute 를 둘 다 비우고 picker controller 도 빈 상태로 갱신한다.
 */
function resetAllDateTimeControls(): void {
  for (const control of formEl.querySelectorAll<HTMLElement>('[data-datetime-picker]')) {
    const hidden = control.querySelector<HTMLInputElement>('input[type="hidden"]');
    if (hidden) {
      hidden.value = '';
      hidden.defaultValue = '';
      hidden.removeAttribute('value');
    }
    dateTimeControllers.get(control)?.setValue('');
  }
  dateTimeRangeChrome?.refresh();
}

function setDateTimeControlValue(name: string, value: string): void {
  const hidden = formEl.elements.namedItem(name) as HTMLInputElement | null;
  if (hidden) hidden.value = value;

  for (const control of formEl.querySelectorAll<HTMLElement>('[data-datetime-picker]')) {
    if (control.dataset.datetimePicker === name) {
      dateTimeControllers.get(control)?.setValue(value);
      applyTravelDateDefault(control);
      return;
    }
  }
}

function applyTravelDateDefault(control: HTMLElement): void {
  const sourceName = control.dataset.datetimePicker;
  if (!sourceName) return;
  const targetName = TRAVEL_DATE_DEFAULTS[sourceName];
  if (!targetName) return;

  const date = dateTimeControllers.get(control)?.getDate();
  if (sourceName === '종료일시') applySubmitDateDefault(date ?? '');
  const target = formEl.elements.namedItem(targetName) as HTMLInputElement | null;
  if (!target) return;
  if (!date) {
    if (autoTravelDates.get(targetName) === target.value) target.value = '';
    autoTravelDates.delete(targetName);
    return;
  }
  const previousAutoDate = autoTravelDates.get(targetName);
  if (target.value && target.value !== previousAutoDate) {
    if (target.value === date) autoTravelDates.set(targetName, date);
    return;
  }
  target.value = date;
  autoTravelDates.set(targetName, date);
}

function applyReturnTripDefault(sourceName: string): boolean {
  const targetName = RETURN_TRIP_DEFAULTS[sourceName];
  if (!targetName) return false;

  const source = formEl.elements.namedItem(sourceName) as HTMLInputElement | null;
  const target = formEl.elements.namedItem(targetName) as HTMLInputElement | null;
  if (!source || !target) return false;

  const nextValue = source.value;
  const previousAutoValue = autoReturnLocations.get(targetName);
  if (!nextValue) {
    autoReturnLocations.delete(targetName);
    if (previousAutoValue !== undefined && target.value === previousAutoValue) {
      target.value = '';
      return true;
    }
    return false;
  }

  if (target.value && target.value !== previousAutoValue) {
    if (target.value === nextValue) autoReturnLocations.set(targetName, nextValue);
    return false;
  }
  if (target.value === nextValue && previousAutoValue === nextValue) return false;

  target.value = nextValue;
  autoReturnLocations.set(targetName, nextValue);
  return true;
}

function syncFareRowControls(): void {
  for (const direction of ['갈때', '올때']) {
    const flag = formEl.elements.namedItem(`${direction}운임삭제`) as HTMLInputElement;
    const deleted = flag.value === '1';
    const group = formEl.querySelector<HTMLElement>(`[data-fare-inputs="${direction}"]`)!;
    group.hidden = deleted;
    group.querySelectorAll('input').forEach((input) => { input.disabled = deleted; });
    const button = formEl.querySelector(`[data-fare-toggle="${direction}"]`)!;
    button.textContent = deleted ? '행 복원' : '행 삭제';
    button.setAttribute('aria-label', `${direction === '갈때' ? '갈 때' : '올 때'} 운임 ${deleted ? '행 복원' : '행 삭제'}`);
  }
  updateRequiredBadges();
}

/** 운임 행 삭제 상태를 토글한다 — 사이드패널 버튼과 미리보기 팝오버가 함께 쓴다. */
function toggleFareRow(direction: FareDirection): void {
  const flag = formEl.elements.namedItem(`${direction}운임삭제`) as HTMLInputElement | null;
  if (!flag) return;
  flag.value = flag.value === '1' ? '0' : '1';
  // hidden input의 value 변경은 defaultValue도 바꾸므로 초기화 기준을 별도로 복원한다.
  syncFareRowControls();
  flag.dispatchEvent(new Event('input', { bubbles: true }));
}

function getFareDeletedState(): Record<FareDirection, boolean> {
  const read = (direction: FareDirection): boolean =>
    (formEl.elements.namedItem(`${direction}운임삭제`) as HTMLInputElement | null)?.value === '1';
  return { 갈때: read('갈때'), 올때: read('올때') };
}

/** 미리보기 셀 편집용 — 대응하는 폼 입력값을 읽는다. */
function getFormFieldValue(name: string): string {
  const control = formEl.elements.namedItem(name);
  if (
    control instanceof HTMLInputElement ||
    control instanceof HTMLSelectElement ||
    control instanceof HTMLTextAreaElement
  ) {
    return control.value;
  }
  return '';
}

/**
 * 미리보기 셀 편집용 — 폼 입력에 값을 넣고 input 이벤트를 흘려 기존 반영 경로를 그대로 탄다.
 * (임시 저장 → applyExpenseFields → 미리보기 재렌더까지 사이드패널 입력과 동일하게 처리된다.)
 */
function setFormFieldValue(name: string, value: string): boolean {
  const control = formEl.elements.namedItem(name);
  if (
    !(control instanceof HTMLInputElement) &&
    !(control instanceof HTMLSelectElement) &&
    !(control instanceof HTMLTextAreaElement)
  ) {
    return false;
  }
  if (control.value === value) return false;
  setFormControlValue(control, value);
  control.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

const PASSENGER_ORG_KEY = /^동승자([1-4])소속$/;

/**
 * 동승자 소속은 신청인과 같은 학교인 경우가 대부분이라, 매번 학교 이름을 다시 치지 않게
 * "신청인 소속" 을 한 번 클릭으로 넣을 수 있게 한다.
 * 사이드패널의 「같음」 버튼과 미리보기 팝오버의 칩이 이 값을 함께 쓴다.
 */
function getPassengerOrgSuggestion(key: string): { label: string; values: string[] } | null {
  if (!PASSENGER_ORG_KEY.test(key)) return null;
  const org = getFormFieldValue('소속').trim();
  if (!org) return null;
  return { label: '신청인 소속', values: [org] };
}

/** 동승자 소속 칸 옆 「같음」 버튼 상태를 신청인 소속 유무에 맞춘다 (setup 후에 채워진다). */
let syncPassengerOrgButtons: (() => void) | null = null;

function setupPassengerOrgShortcuts(): void {
  const buttons = [...formEl.querySelectorAll<HTMLButtonElement>('[data-same-org]')];
  if (buttons.length === 0) return;

  for (const button of buttons) {
    button.addEventListener('click', () => {
      const org = getFormFieldValue('소속').trim();
      if (!org) return;
      const index = button.dataset.sameOrg;
      setFormFieldValue(`동승자${index}소속`, org);
      // 학교 이름에 조사(으로/로)를 붙이면 받침에 따라 어색해지므로 값 없이 문장을 맺는다
      setStatus(`동승자 ${index} 소속을 신청인 소속과 같게 채웠습니다.`);
    });
  }

  syncPassengerOrgButtons = (): void => {
    const org = getFormFieldValue('소속').trim();
    for (const button of buttons) {
      button.disabled = !org;
      // 조사(을/를)는 학교 이름의 받침에 따라 달라지므로 붙이지 않는다
      button.title = org
        ? `신청인 소속과 같게 채우기: "${org}"`
        : '신청자 정보의 소속을 먼저 입력하세요';
    }
  };
  syncPassengerOrgButtons();
}

function setupFareRowControls(): void {
  syncFareRowControls();
  formEl.querySelectorAll<HTMLButtonElement>('[data-fare-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      toggleFareRow(button.dataset.fareToggle as FareDirection);
    });
  });
}

async function initialize(): Promise<void> {
  setStatus('양식 엔진 초기화 중...');
  registerFontFaces();
  setupPanelToggle();
  setupFormTabs(formEl);
  // 링크로 열면 새 출장이다 — 저장본에서는 신청인 정보 등(URL_CARRY_OVER_KEYS)만 이어 쓰고, URL 값이 그보다 우선한다.
  // setupDateTimeControls 보다 먼저 채워야 일시 picker 가 초기화 때 hidden input 값을 읽어 간다.
  const urlEntries = readUrlFormEntries();
  const urlFormApplied = urlEntries.length > 0;
  // 「URL 공유」 표시가 없는 링크는 확장프로그램이 넘긴 것이다 (주소창을 지우기 전에 본다).
  setupExtensionGuide(urlFormApplied && !isShareButtonUrl());
  const restoredFormState = restoreFormState(urlFormApplied ? URL_CARRY_OVER_KEYS : undefined);
  for (const [control, value] of urlEntries) setFormControlValue(control, value);
  setupFareRowControls();
  setDefaultSubmitDate();
  setupDateTimeControls();
  // 운임 제안보다 먼저 붙인다 — 갈 때 교통편·장소를 고치면 올 때 칸을 먼저 채운 뒤 두 방향 운임을 다시 계산하도록.
  setupReturnTripDefaults();
  fareSuggestions = setupFareSuggestions(formEl);
  setupPlaceCityLookup();
  syncTemplateOnlyInputs();
  formEl.addEventListener('input', syncTemplateOnlyInputs);
  setupAttachmentPresets();
  setupPassengerOrgShortcuts();
  setupPresetChips();
  setupLocalFormPersistence();
  updateRequiredBadges();
  document.getElementById('btn-submit-today')?.addEventListener('click', () => {
    const input = formEl.elements.namedItem('제출날짜') as HTMLInputElement;
    input.value = todayDateValue();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  setupApplicantInfoStorage({ formEl, setStatus, onSaved: saveFormState });
  if (urlFormApplied) {
    // 링크 값은 바로 저장하고 주소창에서 지운다 — 뒤의 양식 로드가 실패해도 주소에 링크가 남아
    // 새로고침마다 같은 실패를 되풀이하지 않고, 새로고침하면 저장본(= 이 링크의 값)으로 다시 열린다.
    saveFormState();
    clearUrlFormValues();
  }
  // 1) 글꼴·HWP 엔진·양식 두 개(소속에 따라 바꿔 끼운다)를 한꺼번에 받는다 — 예전처럼 글꼴을 다 받은 뒤에
  //    엔진을, 그다음 양식을 차례로 받으면 느린 학교망에서 그 합만큼 첫 화면이 늦다.
  //    문서를 여는 것(글자 폭을 재 줄을 나눈다)은 기본 글꼴까지 다 온 뒤에 한다.
  const [wasm, defaultTemplateBytes, taebaekTemplateBytes] = await Promise.all([
    createWasmBridge(),
    fetchTemplateBytes(templateUrl('default')),
    fetchTemplateBytes(templateUrl('taebaek')),
    preloadFonts(),
  ]);
  const templateBytesByKind: Record<TemplateKind, Uint8Array> = {
    default: defaultTemplateBytes,
    taebaek: taebaekTemplateBytes,
  };
  const docInfo = wasm.loadDocument(templateBytesByKind.default, 'business-trip.hwp');
  const taebaekDocInfo = wasm.loadDocument(templateBytesByKind.taebaek, 'business-trip-taebaek.hwp');
  const templateBytes = (kind: ActiveTemplate): Uint8Array =>
    (kind === 'custom' && customTemplate ? customTemplate.bytes : templateBytesByKind[kind === 'custom' ? 'default' : kind]);

  /**
   * 올린 양식을 엔진에 열어 쓸 수 있는지 본다 (문서가 그 양식으로 바뀐다 — 못 쓰면 부른 쪽이 원래 양식을 다시 연다).
   * 누름틀이 하나도 없으면 채울 칸이 없으므로 받지 않는다.
   */
  function inspectCustomTemplate(template: CustomTemplate): { fontsUsed: string[]; expenseWritable: boolean } | { problem: string } {
    // 깨진 파일을 엔진에 바로 올리면 쓰던 문서까지 잃으므로 먼저 따로 열어 본다 (문서는 아직 그대로다).
    const openProblem = documentOpenProblem(template.bytes);
    if (openProblem) return { problem: `양식을 열지 못했습니다: ${openProblem}` };
    try {
      const info = wasm.loadDocument(template.bytes, template.name);
      if (discoverFields(wasm).size === 0) {
        return { problem: '이 파일에는 누름틀이 없습니다. 한글에서 누름틀(Ctrl+K, E)을 넣고 이름을 소속·성명·출장지 등으로 맞춘 뒤 다시 올려 주세요.' };
      }
      return { fontsUsed: info.fontsUsed ?? [], expenseWritable: expenseCellsWritable(wasm) };
    } catch (err) {
      return { problem: `양식을 열지 못했습니다: ${describeError(err)}` };
    }
  }

  // 지난번에 올려 둔 양식이 있으면 그것으로 연다. 열 수 없게 됐으면 저장본을 버리고 내장 양식으로 돌아간다.
  let customFonts: string[] = [];
  customTemplate = loadCustomTemplate();
  if (customTemplate) {
    const inspected = inspectCustomTemplate(customTemplate);
    if ('problem' in inspected) {
      console.warn('[web-form] 저장된 양식을 열지 못해 내장 양식으로 엽니다:', inspected.problem);
      customTemplate = null;
      clearCustomTemplate();
    } else {
      customFonts = inspected.fontsUsed;
      customExpenseWritable = inspected.expenseWritable;
    }
  }
  let templateKind = currentTemplateKind();
  if (templateKind !== 'custom') wasm.loadDocument(templateBytes(templateKind));
  syncTemplateOnlyInputs();

  // 1.5) 문서가 실제로 쓰는 폰트들을 적극 프리로드한 뒤 레이아웃 폭 측정값을 갱신
  await preloadFonts([...(docInfo.fontsUsed ?? []), ...(taebaekDocInfo.fontsUsed ?? []), ...customFonts]);
  wasm.refreshLayout();

  setStatus(`양식 로드 완료 (${docInfo.pageCount}쪽). 폼에서 입력하거나 미리보기에서 누름틀을 클릭하세요.`);

  // 2) 누름틀 매핑 구성
  let fields: FieldMap = discoverFields(wasm);
  if (fields.size === 0) {
    setStatus('경고: 양식에서 누름틀을 찾지 못했습니다. 양식 파일을 확인해 주세요.', true);
  } else {
    console.info('[web-form] 발견한 누름틀 라벨:', [...fields.keys()]);
  }

  // 2.5) 시작·종료 일시를 한 누름틀에 합쳐 넣으므로 템플릿의 리터럴 구분자(" ~ ")를 제거
  removeDateTimeRangeSeparator(wasm, fields);
  wasm.refreshLayout();

  // 3) 미리보기 캔버스 마운트
  const canvasView = mountPreview(previewContainer, wasm);
  const signatureStamp = new SignatureStampManager(wasm);
  // 성명으로 만든 자동 도장 상태 — 도장 표시(updateSignatureButtons)가 읽으므로 그보다 먼저 둔다.
  let automaticStampTimer = 0;
  let automaticStampVersion = 0;
  let automaticStampDataUrl: string | null = null;
  updateSignatureButtons();
  // refreshPreview 가 문서를 export→reload 하면 도장 배치(글 뒤로)가 풀리므로, 위치는 그대로
  // 두고 본문배치만 다시 적용한다. (realign 은 reload 직후 좌표가 틀어져 위치가 어긋난다.)
  setPreviewReloadHook(() => {
    if (signatureStamp.hasStamp()) signatureStamp.reapplyPlacement();
  });

  function hasFilledRangeField(): boolean {
    return (fields.get('시작일시') ?? []).some((entry) => entry.value.trim() !== '');
  }

  /**
   * 문서를 원본 양식 상태로 다시 로드한다.
   *
   * rhwp 0.7.11 은 같은 셀에 시작·종료 누름틀이 나란히 있는 구조에서, 값이 있는 시작일시
   * 누름틀을 빈 값으로 덮으면(setFieldValue '') 뒤따르는 종료일시 누름틀의 범위 인덱스가
   * 빈 문단을 벗어나 WASM 이 panic 하고, 그 뒤로는 모든 엔진 호출이 "recursive use" 로
   * 실패한다(페이지 새로고침 전까지 복구 불가). 그래서 범위를 비워야 할 때는 지우는 대신
   * 원본 바이트를 다시 로드하고 나머지 값을 처음부터 채운다.
   */
  let appliedFareState = '0,0';
  /** 올린 양식을 바꿔 끼웠거나 되돌렸을 때 — 양식 종류가 같아도 다음 반영에서 원본을 다시 연다. */
  let templateSwapped = false;
  function reloadPristineTemplate(): void {
    const storedStamp = signatureStamp.getStoredStamp();
    const hadStamp = signatureStamp.hasStamp();
    signatureStamp.forgetDocumentState();
    wasm.loadDocument(templateBytes(templateKind));
    // 운임 "행 삭제"는 표의 행을 지우지 않고 그 행의 내용(값·안내문구)만 비운다.
    const rawValues = collectRawFormValues();
    setSuppressedFareGuideLabels(
      ['갈때', '올때']
        .filter((direction) => rawValues[`${direction}운임삭제`] === '1')
        .flatMap((direction) => FARE_FIELD_SUFFIXES.map((suffix) => `${direction}${suffix}`)),
    );
    clearFareRows(wasm, rawValues);
    fields = discoverFields(wasm);
    removeDateTimeRangeSeparator(wasm, fields);
    wasm.refreshLayout();
    fields = discoverFields(wasm);
    if (hadStamp && storedStamp) {
      try {
        signatureStamp.applyStored(storedStamp);
      } catch (err) {
        console.warn('[web-form] 양식 재로드 후 도장/서명 재적용 실패:', err);
      }
    }
  }

  function applyCollectedValuesToPreview(
    statusMessage?: string,
    options: PreviewApplyOptions = {},
  ): void {
    const { 시작일시: rangeText, ...values } = collectFormValues();
    const rawValues = collectRawFormValues();
    const fareState = ['갈때', '올때'].map((direction) => rawValues[`${direction}운임삭제`] === '1' ? '1' : '0').join(',');
    const nextTemplateKind = currentTemplateKind();
    const templateChanged = nextTemplateKind !== templateKind;
    templateKind = nextTemplateKind;
    if (templateChanged || templateSwapped || fareState !== appliedFareState || (options.clearEmpty && !rangeText && hasFilledRangeField())) {
      reloadPristineTemplate();
      appliedFareState = fareState;
      templateSwapped = false;
    }
    if (templateChanged) updateTemplateStatus();
    if (templateChanged && !statusMessage && templateKind !== 'custom') {
      setStatus(templateKind === 'taebaek' ? '태백교육지원청 양식으로 바꿨습니다.' : '기본 양식으로 바꿨습니다.');
    }
    // 올린 양식은 표 구조가 기본 양식과 같을 때만 일반 칸(식비·동승자·등급·금액)을 쓴다 — 다르면 엉뚱한 칸을 지울 수 있다.
    if (templateKind !== 'custom' || customExpenseWritable) applyExpenseFields(wasm, rawValues);
    // 올린 양식: 출장명 누름틀이 있으면 거기에, 없으면 기본 양식처럼 출장지 아래 줄에 넣는다.
    const tripNameInField = templateKind === 'taebaek' || (templateKind === 'custom' && fields.has('출장명'));
    const fieldValues: Record<string, string> = templateKind === 'custom' && tripNameInField
      ? { ...values, 출장명: rawValues.출장명 ?? '' }
      : values;
    const { applied, missing } = setFieldValues(wasm, fields, fieldValues, {
      clearEmpty: options.clearEmpty,
    });
    // 기본 양식: 출장지 셀 아래 줄에 [출장명 : …] 을 넣는다 (출장명 누름틀을 쓰는 양식은 줄을 비운다).
    applyTripNameLine(wasm, fields.get('출장지')?.[0]?.fieldId, tripNameInField ? '' : rawValues.출장명 ?? '');
    // 첨부서류가 여럿이면 누름틀(첫 줄) 아래에 한 줄씩 — 마지막 줄 끝에 "  끝."
    applyAttachmentLines(wasm, fields.get('첨부서류')?.[0]?.fieldId, attachmentLines(rawValues.첨부서류 ?? ''));
    fillDateTimeRange(wasm, fields, rangeText, { clearEmpty: options.clearEmpty });
    refreshPreviewAndRealignSignatureStamp();
    fields = discoverFields(wasm);
    if (!statusMessage) return;
    const warn = missing.length > 0 ? ` (양식에 없는 라벨: ${missing.join(', ')})` : '';
    setStatus(statusMessage.replace('{applied}', String(applied)) + warn, missing.length > 0);
  }

  function applyTravelDatesToPreview(): void {
    const { 갈때일자, 올때일자 } = collectFormValues();
    setFieldValues(wasm, fields, { 갈때일자, 올때일자 });
  }

  function applyReturnTripToPreview(): void {
    const { 올때교통편, 올때출발지, 올때도착지 } = collectFormValues();
    setFieldValues(wasm, fields, { 올때교통편, 올때출발지, 올때도착지 }, { clearEmpty: true });
  }

  if (urlFormApplied) {
    // 공유 URL 의 의도를 한 번 더 명확히 — 폼에 반영한 값을 그대로 미리보기에 적용한다.
    applyCollectedValuesToPreview('공유 URL 의 값을 양식에 채웠습니다.');
  } else if (restoredFormState) {
    applyCollectedValuesToPreview('저장된 입력 내용을 복원했습니다.');
  }

  const storedSignatureStamp = loadStoredSignatureStamp();
  if (storedSignatureStamp) {
    try {
      signatureStamp.applyStored(storedSignatureStamp);
      refreshPreviewAndRealignSignatureStamp();
      updateSignatureButtons();
      setStatus('브라우저에 저장된 도장/서명 이미지를 복원했습니다.');
    } catch (err) {
      console.warn('[web-form] 저장된 도장/서명 이미지 복원 실패:', err);
      clearStoredSignatureStamp();
      updateSignatureButtons();
      setStatus('저장된 도장/서명 이미지를 불러오지 못해 저장본을 삭제했습니다.', true);
    }
  }

  function cancelAutomaticStamp(): void {
    window.clearTimeout(automaticStampTimer);
    automaticStampVersion += 1;
    automaticStampDataUrl = null;
  }

  function applicantStampName(): string {
    const control = formEl.elements.namedItem('성명');
    return control instanceof HTMLInputElement ? control.value.replace(/\s+/g, '') : '';
  }

  function scheduleAutomaticStamp(): void {
    window.clearTimeout(automaticStampTimer);
    const version = ++automaticStampVersion;
    const name = applicantStampName();
    const canReplace = () => !signatureStamp.hasStamp()
      || (automaticStampDataUrl !== null && signatureStamp.getStoredStamp()?.dataUrl === automaticStampDataUrl);
    if (!canReplace()) return;
    if (!name) {
      if (automaticStampDataUrl) {
        signatureStamp.clear();
        automaticStampDataUrl = null;
        refreshPreviewAndRealignSignatureStamp();
        updateSignatureButtons();
      }
      return;
    }
    // 한글 조합과 연속 입력이 끝난 뒤 생성하며, 이전 이름의 비동기 결과는 버린다.
    automaticStampTimer = window.setTimeout(async () => {
      const isCurrent = () => version === automaticStampVersion && name === applicantStampName() && canReplace();
      try {
        const file = await createDefaultStamp(name);
        if (!isCurrent()) return;
        const stored = await signatureStamp.applyFile(file, isCurrent, { rotationDeg: DEFAULT_STAMP_ROTATION_DEG });
        if (!stored) return;
        automaticStampDataUrl = stored.dataUrl;
        refreshPreviewAndRealignSignatureStamp();
        updateSignatureButtons();
        setStatus('성명으로 기본 개인인감을 만들었습니다. 계속 쓰려면 브라우저 저장을 누르세요.');
      } catch (err) {
        // 올린 양식에 (인) 자리가 없으면 도장을 넣을 수 없다 — 이름을 칠 때마다 오류를 띄우지 않고 넘어간다.
        if (templateKind === 'custom') console.warn('[web-form] 올린 양식에 기본 도장을 넣지 못했습니다:', err);
        else if (isCurrent()) setStatus(`기본 도장 생성 실패: ${describeError(err)}`, true);
      }
    }, 650);
  }

  scheduleAutomaticStamp();

  let livePreviewTimer = 0;
  function scheduleLivePreview(statusMessage?: string): void {
    window.clearTimeout(livePreviewTimer);
    livePreviewTimer = window.setTimeout(() => {
      try {
        saveFormState();
        applyCollectedValuesToPreview(statusMessage, { clearEmpty: true });
      } catch (err) {
        console.error(err);
        setStatus(`미리보기 반영 실패: ${(err as Error).message}`, true);
      }
    }, 120);
  }

  liveDateTimePreviewHandler = () => {
    scheduleLivePreview();
  };

  formEl.addEventListener('input', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type === 'file') return;
    scheduleLivePreview();
    if (target instanceof HTMLInputElement && target.name === '성명') scheduleAutomaticStamp();
  });
  formEl.addEventListener('change', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type === 'file') return;
    scheduleLivePreview();
    if (target instanceof HTMLInputElement && target.name === '성명') scheduleAutomaticStamp();
  });

  // 4) 인라인 편집 핸들러 부착 — 누름틀 + 일반 셀(식비·동승자·운임) + (인)/도장 영역
  inlineEdit = attachInlineEditing({
    wasm,
    canvasView,
    container: previewContainer,
    getFields: () => fields,
    formFields: {
      labels: new Set(['첨부서류']),
      getValue: (label) => getFormFieldValue(label),
      commit: (label, value) => {
        if (setFormFieldValue(label, value)) setStatus(`"${label}" 항목을 반영했습니다.`);
      },
    },
    cells: {
      getRegions: () => {
        // "행 삭제"된 운임 행의 등급 칸은 비어 있으므로 편집 대상에서 뺀다
        const deleted = getFareDeletedState();
        // 올린 양식의 표 구조가 다르면 일반 칸은 쓰지 않으므로 눌러 고치는 자리도 두지 않는다 (운임 행 메뉴만 남긴다).
        const writable = templateKind !== 'custom' || customExpenseWritable;
        return getCellRegions(wasm).filter((region) =>
          region.kind !== 'text' ? true : writable && (!region.fareDirection || !deleted[region.fareDirection]));
      },
      getValue: (key) => getFormFieldValue(key),
      getSuggestions: (key) => (key === '등급' ? { label: '등급', values: [...GRADE_OPTIONS] } : getPassengerOrgSuggestion(key)),
      getExtras: (key, ctx) => fareSuggestions?.popoverExtras(key, ctx) ?? null,
      commit: (key, value) => {
        if (!setFormFieldValue(key, value)) return;
        setStatus(value ? `"${value}" 을(를) 반영했습니다.` : '해당 칸을 비웠습니다.');
      },
      getFareDeleted: () => getFareDeletedState(),
      toggleFare: (direction) => {
        toggleFareRow(direction);
        const deleted = getFareDeletedState()[direction];
        setStatus(`${direction === '갈때' ? '갈 때' : '올 때'} 운임 행의 내용을 ${deleted ? '지웠습니다' : '복원했습니다'}.`);
      },
    },
    stamp: {
      getRect: () => signatureStamp.getInteractionRect(),
      onOpen: (anchor) => {
        showStampPopover({
          anchor,
          hasStamp: signatureStamp.hasStamp(),
          rotationDeg: signatureStamp.getRotationDeg(),
          onPickImage: () => signatureInput?.click(),
          onMakeStamp: openStampGeneratorWithName,
          onRotate: rotateSignatureTo,
          onClear: clearSignatureFromDocument,
        });
      },
    },
    onReveal: revealFormControl,
    onAfterEdit: (label, value) => {
      syncFormFromInline(label, value);
      if (label === '성명' || label === '이름') scheduleAutomaticStamp();
      if (label === '시작일시' || label === '종료일시') {
        applyTravelDatesToPreview();
      }
      if (applyReturnTripDefault(label)) {
        applyReturnTripToPreview();
        syncPresetChips?.();
      }
      if (label.endsWith('출발지') || label.endsWith('도착지') || label.endsWith('교통편')) fareSuggestions?.sync();
      refreshPreviewAndRealignSignatureStamp();
      fields = discoverFields(wasm);
      saveFormState();
      setStatus(`"${label}" 항목을 반영했습니다.`);
    },
  });

  // 4-1) "편집 가능 칸 표시" 토글 — 미리보기에서 눌러 고칠 수 있는 칸을 사각형으로 보여준다
  applyEditHintsVisible(loadEditHintsPreference());
  hintToggleBtn?.addEventListener('click', () => {
    const next = !(inlineEdit?.isHintsVisible() ?? true);
    applyEditHintsVisible(next);
    try {
      localStorage.setItem(EDIT_HINTS_STORAGE_KEY, next ? '1' : '0');
    } catch { /* 저장 실패는 무시 — 표시 자체는 이번 세션에 적용된다 */ }
    setStatus(next
      ? '미리보기에서 눌러 고칠 수 있는 칸을 표시합니다.'
      : '편집 가능 칸 표시를 껐습니다.');
  });

  // 5) 액션 버튼 바인딩
  /** 지금 문서의 도장을 브라우저에 저장한다. 실패하면 이유를 돌려준다 (문서에는 그대로 들어가 있다). */
  function persistCurrentSignature(): string | null {
    const stored = signatureStamp.getStoredStamp();
    if (!stored) return null;
    const result = saveStoredSignatureStamp(stored);
    return result.ok ? null : result.reason;
  }

  /** 이미지를 넣거나 만든 도장은 다음 방문에도 쓰도록 바로 브라우저에 저장한다. */
  async function applySignatureFile(
    file: File,
    successMessage: string,
    options: { rotationDeg?: number } = {},
  ): Promise<void> {
    cancelAutomaticStamp();
    try {
      await signatureStamp.applyFile(file, undefined, options);
      const saveError = persistCurrentSignature();
      refreshPreviewAndRealignSignatureStamp();
      updateSignatureButtons();
      if (saveError) setStatus(`${successMessage} 다만 ${saveError}`, true);
      else setStatus(`${successMessage} 브라우저에도 저장해 다음에도 씁니다.`);
    } catch (err) {
      console.error(err);
      if (signatureInput) signatureInput.value = '';
      updateSignatureButtons();
      setStatus(`도장/서명 이미지 적용 실패: ${describeError(err)}`, true);
    }
  }

  signatureInput?.addEventListener('change', async () => {
    const file = signatureInput.files?.[0];
    if (!file) return;
    await applySignatureFile(file, '도장/서명 이미지를 성명 옆 (인)에 넣었습니다.');
  });

  /** 이름 → 막도장 생성기. 사이드패널 버튼과 미리보기 도장 메뉴가 공유한다. */
  function openStampGeneratorWithName(): void {
    window.clearTimeout(automaticStampTimer);
    automaticStampVersion += 1;
    const nameControl = formEl.elements.namedItem('성명');
    openStampGenerator({
      initialName: nameControl instanceof HTMLInputElement ? nameControl.value.trim() : '',
      onGenerate: (file) => {
        void applySignatureFile(file, '만든 도장을 성명 옆 (인)에 넣었습니다.', { rotationDeg: DEFAULT_STAMP_ROTATION_DEG });
      },
    });
  }

  /** 도장 기울기를 deg(0~10°)로 적용하고 미리보기/버튼/상태 메시지를 갱신한다. */
  function rotateSignatureTo(deg: number): boolean {
    if (!signatureStamp.hasStamp()) return false;
    if (!signatureStamp.rotate(deg)) {
      setStatus('도장 회전에 실패했습니다.', true);
      return false;
    }
    // 성명으로 만든 자동 도장이 아니면 저장본도 새 기울기로 맞춘다.
    const isAutomatic = automaticStampDataUrl !== null && signatureStamp.getStoredStamp()?.dataUrl === automaticStampDataUrl;
    const saveError = isAutomatic ? null : persistCurrentSignature();
    refreshPreviewAndRealignSignatureStamp();
    updateSignatureButtons();
    const message = deg === 0 ? '도장 회전을 원래대로(0°) 되돌렸습니다.' : `도장을 ${deg}° 기울였습니다.`;
    if (saveError) setStatus(`${message} 다만 ${saveError}`, true);
    else setStatus(isAutomatic ? `${message} 계속 쓰려면 브라우저 저장을 누르세요.` : message);
    return true;
  }

  function clearSignatureFromDocument(): void {
    cancelAutomaticStamp();
    const removed = signatureStamp.clear();
    if (signatureInput) signatureInput.value = '';
    updateSignatureButtons();
    if (removed) {
      refreshPreview(wasm);
      setStatus('문서에서 도장/서명 이미지를 삭제했습니다. 브라우저 저장본은 유지됩니다.');
    } else {
      setStatus('삭제할 도장/서명 이미지가 없습니다.');
    }
  }

  document.getElementById('btn-make-stamp')?.addEventListener('click', openStampGeneratorWithName);

  signatureRotateBtn?.addEventListener('click', () => {
    if (!signatureStamp.hasStamp()) return;
    const current = signatureStamp.getRotationDeg();
    rotateSignatureTo(current >= 10 ? 0 : Math.min(10, current + 2)); // 2°씩 → 10° → 0° 순환 (기본 7°에서는 9→10→0)
  });

  signatureClearBtn?.addEventListener('click', clearSignatureFromDocument);

  signatureSaveBtn?.addEventListener('click', () => {
    const stored = signatureStamp.getStoredStamp();
    if (!stored) {
      setStatus('먼저 도장/서명 이미지를 선택하세요.', true);
      return;
    }
    const result = saveStoredSignatureStamp(stored);
    if (!result.ok) {
      setStatus(result.reason, true);
      return;
    }
    updateSignatureButtons();
    cancelAutomaticStamp();
    setStatus('도장/서명 이미지를 브라우저에 저장했습니다.');
  });

  signatureClearSavedBtn?.addEventListener('click', () => {
    if (!window.confirm('브라우저에 저장된 도장/서명 이미지를 삭제할까요?')) return;
    if (!clearStoredSignatureStamp()) {
      setStatus('브라우저 저장소를 사용할 수 없어 저장된 이미지를 삭제하지 못했습니다.', true);
      return;
    }
    updateSignatureButtons();
    setStatus('브라우저에 저장된 도장/서명 이미지를 삭제했습니다.');
  });

  function refreshPreviewAndRealignSignatureStamp(): void {
    refreshPreview(wasm);
    // 문서를 다시 그리면 표 좌표가 달라지므로 미리보기 셀 영역 캐시를 버린다.
    invalidateCellRegions();
    if (realignSignatureStamp()) {
      reloadPreservingScroll(canvasView);
    }
    // 편집 가능 칸 마커도 새 좌표로 다시 그린다 (초기화 전이면 부착 시 함께 그려진다)
    inlineEdit?.refreshHints();
  }

  function realignSignatureStamp(): boolean {
    if (!signatureStamp.hasStamp()) return false;
    try {
      return signatureStamp.realign();
    } catch (err) {
      console.warn('[web-form] 도장/서명 위치 재정렬 실패:', err);
      return false;
    }
  }

  function updateSignatureButtons(): void {
    if (signatureRotateBtn) {
      signatureRotateBtn.disabled = !signatureStamp.hasStamp();
      signatureRotateBtn.textContent = `회전 ${signatureStamp.getRotationDeg()}°`;
    }
    if (signatureClearBtn) signatureClearBtn.disabled = !signatureStamp.hasStamp();
    if (signatureSaveBtn) signatureSaveBtn.disabled = !signatureStamp.getStoredStamp();
    if (signatureClearSavedBtn) signatureClearSavedBtn.disabled = !hasStoredSignatureStamp();
    updateSignatureCurrentBadge();
  }

  /**
   * 파일 input 은 "방금 고른 파일" 만 가리키므로 브라우저 저장본을 자동 복원한 뒤에도
   * "선택된 파일 없음" 으로 보여 혼동을 준다. 현재 문서에 들어가 있는 도장의 작은 썸네일과
   * 출처 라벨(브라우저 저장본 / 방금 업로드) 을 함께 보여줘서 상태를 명확히 한다.
   */
  function updateSignatureCurrentBadge(): void {
    if (!signatureCurrentRoot || !signatureCurrentThumb || !signatureCurrentLabel) return;
    const stamp = signatureStamp.getStoredStamp();
    if (!stamp) {
      signatureCurrentRoot.hidden = true;
      signatureCurrentThumb.removeAttribute('src');
      signatureCurrentLabel.textContent = '';
      return;
    }
    signatureCurrentRoot.hidden = false;
    signatureCurrentThumb.src = stamp.dataUrl;
    const savedInBrowser = hasStoredSignatureStamp();
    const isAutomatic = automaticStampDataUrl !== null && stamp.dataUrl === automaticStampDataUrl;
    signatureCurrentLabel.textContent = isAutomatic
      ? '성명으로 만든 기본 도장 사용 중 — 계속 쓰려면 "브라우저 저장"'
      : savedInBrowser
        ? '브라우저 저장본 사용 중 — 새 이미지를 넣거나 만들면 바꿔 저장합니다'
        : '브라우저에 저장하지 못한 이미지 사용 중 — "브라우저 저장"을 다시 눌러 보세요';
  }

  // 5-1) 양식 바꾸기 — 누름틀이 든 자기 기관 HWP 를 올려 쓰거나 내장 양식으로 되돌린다.
  const templateFileInput = document.getElementById('template-file') as HTMLInputElement | null;
  const templateResetBtn = document.getElementById('btn-template-reset') as HTMLButtonElement | null;
  const templateStatusEl = document.getElementById('template-current');
  /** 올린 양식에서 연결하지 못한 입력 항목 (성명·이름은 한쪽만 있어도 된다. 출장명·종료일시는 없어도 다른 칸에 들어간다) */
  function unmatchedTemplateLabels(): string[] {
    return Object.keys(FIELD_CONFIGS).filter((label) => {
      if (label === '이름' || label === '출장명' || label === '종료일시') return false;
      if (label === '성명') return !fields.has('성명') && !fields.has('이름');
      return !fields.has(label);
    });
  }
  function updateTemplateStatus(): void {
    if (templateResetBtn) templateResetBtn.hidden = !customTemplate;
    if (!templateStatusEl) return;
    if (!customTemplate) {
      templateStatusEl.textContent = templateKind === 'taebaek' ? '태백교육지원청 양식 사용 중 (소속에 따라 자동 선택)' : '기본 양식 사용 중';
      return;
    }
    const notes = [`올린 양식 사용 중: ${customTemplate.name}`];
    const unmatched = unmatchedTemplateLabels();
    if (unmatched.length > 0) notes.push(`양식에 누름틀이 없어 들어가지 않는 항목: ${unmatched.join(', ')}`);
    if (!customExpenseWritable) notes.push('표 구조가 기본 양식과 달라 식비·동승자·등급·금액 칸은 자동으로 넣지 않습니다');
    templateStatusEl.textContent = notes.join(' · ');
  }
  /** 양식을 바꿔 끼운 뒤 지금 입력값을 새 양식에 다시 채운다. */
  function reapplyAfterTemplateSwap(): void {
    templateSwapped = true;
    window.clearTimeout(livePreviewTimer);
    syncTemplateOnlyInputs();
    applyCollectedValuesToPreview(undefined, { clearEmpty: true });
    updateTemplateStatus();
    updateSignatureButtons();
  }
  updateTemplateStatus();

  templateFileInput?.addEventListener('change', async () => {
    const file = templateFileInput.files?.[0];
    templateFileInput.value = '';
    if (!file) return;
    try {
      const candidate: CustomTemplate = { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
      const problem = customTemplateProblem(candidate.bytes);
      if (problem) {
        setStatus(problem, true);
        return;
      }
      const inspected = inspectCustomTemplate(candidate);
      if ('problem' in inspected) {
        // 살펴보느라 문서가 올린 파일로 바뀌었으므로 쓰던 양식을 다시 연다.
        reapplyAfterTemplateSwap();
        setStatus(inspected.problem, true);
        return;
      }
      customTemplate = candidate;
      customExpenseWritable = inspected.expenseWritable;
      await preloadFonts(inspected.fontsUsed);
      reapplyAfterTemplateSwap();
      const saved = saveCustomTemplate(candidate);
      setStatus(saved
        ? `올린 양식으로 바꿨습니다: ${file.name} (이 브라우저에 저장해 다음에도 씁니다)`
        : `올린 양식으로 바꿨습니다: ${file.name} (브라우저에 저장하지 못해 이번 방문 동안만 씁니다)`, !saved);
    } catch (err) {
      console.error(err);
      setStatus(`양식 적용 실패: ${describeError(err)}`, true);
    }
  });

  templateResetBtn?.addEventListener('click', () => {
    if (!customTemplate) return;
    customTemplate = null;
    customExpenseWritable = false;
    clearCustomTemplate();
    try {
      reapplyAfterTemplateSwap();
      setStatus('내장 양식으로 되돌렸습니다. 올려 둔 양식은 브라우저에서 지웠습니다.');
    } catch (err) {
      console.error(err);
      setStatus(`양식 되돌리기 실패: ${describeError(err)}`, true);
    }
  });

  // 모바일 전용 — 폼을 닫고 미리보기를 보여준다. 입력은 이미 자동 반영되어 있다.
  document.getElementById('btn-show-preview')?.addEventListener('click', () => {
    pushRecentValuesFromForm();
    appBodyEl.classList.add('panel-collapsed');
    syncPanelToggleState();
  });

  // 모바일 하단 툴바 — 폼을 열지 않고도 입력/저장을 바로 시작
  document.getElementById('btn-mobile-edit')?.addEventListener('click', () => {
    appBodyEl.classList.remove('panel-collapsed');
    syncPanelToggleState();
  });
  document.getElementById('btn-mobile-hwp')?.addEventListener('click', () => {
    document.getElementById('btn-download-hwp')?.click();
  });
  document.getElementById('btn-mobile-pdf')?.addEventListener('click', () => {
    document.getElementById('btn-print')?.click();
  });

  // 화면 회전/창 크기 변경 시 모바일 폭 맞춤 줌을 다시 적용한다.
  // 높이만 변하는 경우(iOS 키보드 노출 등)는 건너뛴다 — 재계산이 스크롤 위치를 초기화하기 때문.
  let lastViewportWidth = window.innerWidth;
  let viewportResizeTimer = 0;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastViewportWidth) return;
    lastViewportWidth = window.innerWidth;
    window.clearTimeout(viewportResizeTimer);
    viewportResizeTimer = window.setTimeout(() => {
      if (window.innerWidth < 1024) canvasView.loadDocument();
    }, 200);
  });

  document.getElementById('btn-download-hwp')!.addEventListener('click', async () => {
    if (!confirmMissingRequired('저장')) return;
    try {
      window.clearTimeout(livePreviewTimer);
      applyCollectedValuesToPreview(undefined, { clearEmpty: true });
      pushRecentValuesFromForm();
      const fileName = suggestFileName(collectFormValues());
      setStatus('HWP 다운로드 준비 중...');
      await downloadHwp(wasm, fileName);
      setStatus(`다운로드: ${fileName}`);
    } catch (err) {
      console.error(err);
      setStatus(`다운로드 실패: ${(err as Error).message}`, true);
    }
  });

  document.getElementById('btn-print')!.addEventListener('click', async () => {
    const btn = document.getElementById('btn-print') as HTMLButtonElement;
    if (!confirmMissingRequired('출력')) return;
    btn.disabled = true;
    try {
      window.clearTimeout(livePreviewTimer);
      applyCollectedValuesToPreview(undefined, { clearEmpty: true });
      pushRecentValuesFromForm();
      const fileName = suggestPdfFileName(collectFormValues());
      setStatus('PDF를 준비 중...');
      const result = await printPdf(wasm, fileName);
      setStatus(describePdfSaveResult(result, fileName));
    } catch (err) {
      console.error(err);
      setStatus(`PDF 준비 실패: ${describeError(err)}`, true);
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('btn-share-url')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-share-url') as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
    try {
      pushRecentValuesFromForm();
      const url = buildShareUrl(collectRawFormValues());
      const copied = await copyTextToClipboard(url);
      if (copied) {
        setStatus(`현재 입력값이 담긴 URL 을 복사했습니다. 공유받은 사람이 열면 같은 값으로 채워져 표시됩니다.`);
      } else {
        // 클립보드 권한이 거부됐을 때를 위해 마지막 수단으로 prompt 표시
        window.prompt('URL 을 직접 복사하세요 (Ctrl/Cmd+C):', url);
        setStatus('URL 복사 권한이 없어 직접 복사 창을 열었습니다.');
      }
    } catch (err) {
      console.error(err);
      setStatus(`URL 공유 실패: ${describeError(err)}`, true);
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById('btn-reset')!.addEventListener('click', () => {
    if (!window.confirm('작성 중인 모든 입력과 임시 저장 내용을 지울까요?')) return;
    // 입력 직후 초기화하면 120ms 디바운스 타이머가 옛 입력값을 다시 반영할 수 있어 먼저 취소
    window.clearTimeout(livePreviewTimer);
    cancelAutomaticStamp();
    const removedStamp = signatureStamp.clear();
    formEl.reset();
    for (const direction of ['갈때', '올때']) {
      (formEl.elements.namedItem(`${direction}운임삭제`) as HTMLInputElement).value = '0';
    }
    syncFareRowControls();
    syncPassengerOrgButtons?.();
    autoTravelDates.clear();
    autoReturnLocations.clear();
    autoPlaceCities.clear();
    fareSuggestions?.forgetAutoAmounts();
    clearSavedFormState();
    // 일시 picker 는 hidden input 의 defaultValue 가 이전 입력값으로 굳어버려 formEl.reset() 만으로는
    // 비워지지 않는다. 명시적으로 controller + attribute 를 함께 초기화한다.
    resetAllDateTimeControls();
    setDefaultSubmitDate();
    if (signatureInput) signatureInput.value = '';
    updateSignatureButtons();
    syncPresetChips?.();
    fareSuggestions?.sync();
    updateRequiredBadges();
    try {
      applyCollectedValuesToPreview(undefined, { clearEmpty: true });
    } catch (err) {
      console.error(err);
      if (removedStamp) refreshPreview(wasm);
    }
    setStatus('초기화했습니다.');
  });

  /**
   * 사이드 폼에서 "미리보기에 반영" 을 눌렀을 때, 빈칸이 아닌 입력값을 라벨별 "최근 입력" 칩 저장소에
   * 누적한다. 팝오버에서 직접 입력하는 케이스는 commitSingleField 가 별도로 처리한다.
   */
  function pushRecentValuesFromForm(): void {
    const labels = [
      '소속', '직급', '성명',
      '출장명', '출장지',
      '갈때출발지', '갈때도착지', '올때출발지', '올때도착지',
      '첨부서류',
    ];
    for (const label of labels) {
      const control = formEl.elements.namedItem(label);
      const value = control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement
        ? control.value.trim()
        : '';
      if (value) pushRecentValue(label, value);
    }
  }
}

function suggestFileName(values: Record<string, string>): string {
  const date = values.제출날짜.replace(/[. ]/g, '').slice(0, 8) || 'undated';
  const who = (values.성명 || 'anonymous').replace(/\s/g, '');
  return `여비정산신청서_${who}_${date}.hwp`;
}

function suggestPdfFileName(values: Record<string, string>): string {
  return suggestFileName(values).replace(/\.hwp$/i, '.pdf');
}

function describePdfSaveResult(result: PdfSaveResult, fileName: string): string {
  switch (result) {
    case 'shared':
      return `PDF 공유/저장 시트를 열었습니다: ${fileName}`;
    case 'downloaded':
      return `PDF 저장을 시작했습니다: ${fileName}`;
    case 'opened':
      return 'PDF를 새 화면으로 열었습니다. 공유 버튼에서 파일에 저장할 수 있습니다.';
    case 'cancelled':
      return 'PDF 저장을 취소했습니다.';
    case 'printed':
    default:
      return '인쇄 다이얼로그를 열었습니다. 데스크톱에서는 여기서 PDF로 저장할 수 있습니다.';
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  try { return JSON.stringify(err); } catch { return String(err); }
}

function todayDateValue(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

initialize().catch((err) => {
  console.error('[web-form] 초기화 실패:', err);
  setStatus(`초기화 실패: ${describeError(err)}`, true);
});
