import { loadTemplate } from './template-loader';
import { discoverFields, fillDateTimeRange, removeDateTimeRangeSeparator, setFieldValues, type FieldMap } from './field-filler';
import { downloadHwp } from './download';
import { mountPreview, refreshPreview, setPreviewReloadHook } from './preview';
import { registerFontFaces, preloadFonts } from './fonts';
import { attachInlineEditing } from './field-interaction';
import { showStampPopover } from './field-popover';
import { setupDateTimePicker, type DateTimePickerController } from './datetime-picker';
import { SignatureStampManager, type StoredSignatureStamp } from './signature-stamp';
import { openStampGenerator } from './stamp-generator';
import { printPdf, type PdfSaveResult } from './print-pdf';
import { pushRecentValue } from './recent-values';
import {
  buildShareUrl,
  clearUrlFormValues,
  copyTextToClipboard,
  hasUrlFormValues,
  readUrlFormValues,
} from './url-share';
import {
  FIELD_CONFIGS,
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
const TEMPLATE_URL = `${import.meta.env.BASE_URL}templates/business-trip.hwp`;
const FORM_STORAGE_KEY = 'business-trip-form:form-values:v1';
const APPLICANT_STORAGE_KEY = 'business-trip-form:applicant-info:v1';
const SIGNATURE_STORAGE_KEY = 'business-trip-form:signature-stamp:v1';
const APPLICANT_FIELDS = ['소속', '직급', '성명'] as const;
const APPLICANT_DATALISTS: Record<ApplicantField, string> = {
  소속: 'applicant-org-options',
  직급: 'applicant-position-options',
  성명: 'applicant-name-options',
};
const MAX_SAVED_APPLICANTS = 30;

const statusEl = document.getElementById('status') as HTMLElement;
const formEl = document.getElementById('trip-form') as HTMLFormElement;
const previewContainer = document.getElementById('scroll-container') as HTMLDivElement;
const appBodyEl = document.querySelector('.app-body') as HTMLDivElement;
const toggleBtn = document.getElementById('btn-toggle-panel') as HTMLButtonElement;
const applicantSaveBtn = document.getElementById('btn-save-applicant') as HTMLButtonElement | null;
const applicantClearBtn = document.getElementById('btn-clear-applicants') as HTMLButtonElement | null;
const signatureInput = document.getElementById('signature-image') as HTMLInputElement | null;
const signatureRotateBtn = document.getElementById('btn-rotate-signature') as HTMLButtonElement | null;
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
const RETURN_LOCATION_DEFAULTS: Record<string, string> = {
  갈때출발지: '올때도착지',
  갈때도착지: '올때출발지',
};
const dateTimeControllers = new WeakMap<HTMLElement, DateTimePickerController>();
const autoTravelDates = new Map<string, string>();
const autoReturnLocations = new Map<string, string>();
let liveDateTimePreviewHandler: (() => void) | null = null;

interface PreviewApplyOptions {
  clearEmpty?: boolean;
}

interface SavedFormState {
  autoReturnLocations?: Record<string, string>;
  autoTravelDates?: Record<string, string>;
  updatedAt?: string;
  values?: Record<string, string>;
}

type ApplicantField = typeof APPLICANT_FIELDS[number];
type SavedApplicantInfo = Record<ApplicantField, string> & { updatedAt: string };

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

function collectFormValues(): Record<string, string> {
  syncAllDateTimeControlsToHidden();
  const data = new FormData(formEl);
  const raw: Record<string, string> = {};
  data.forEach((v, k) => {
    raw[k] = typeof v === 'string' ? v : '';
  });
  const name = raw.성명 ?? '';
  const startDateTime = raw.시작일시 ?? '';
  const endDateTime = raw.종료일시 ?? '';
  return {
    소속: raw.소속 ?? '',
    직급: raw.직급 ?? '',
    성명: name,
    이름: name,
    // 시작·종료를 한 누름틀(시작일시)에 합쳐 넣는다 — 종료일시 누름틀은 fillDateTimeRange 가 비운다
    시작일시: formatDateTimeRange(startDateTime, endDateTime),
    출장지: raw.출장지 ?? '',
    갈때일자: formatDateKR(raw.갈때일자 ?? ''),
    갈때교통편: raw.갈때교통편 ?? '',
    갈때출발지: raw.갈때출발지 ?? '',
    갈때도착지: raw.갈때도착지 ?? '',
    올때일자: formatDateKR(raw.올때일자 ?? ''),
    올때교통편: raw.올때교통편 ?? '',
    올때출발지: raw.올때출발지 ?? '',
    올때도착지: raw.올때도착지 ?? '',
    제출날짜: formatDateKR(raw.제출날짜 ?? ''),
    첨부서류: raw.첨부서류 ?? '',
  };
}

function setupLocalFormPersistence(): void {
  formEl.addEventListener('input', saveFormState);
  formEl.addEventListener('change', saveFormState);
}

function setupApplicantInfoStorage(): void {
  refreshApplicantDatalists();
  applicantSaveBtn?.addEventListener('click', () => {
    const info = collectApplicantInfo();
    if (!info) {
      setStatus('저장할 신청자 정보를 입력하세요.', true);
      return;
    }

    const saved = loadApplicantInfos();
    const next = [
      info,
      ...saved.filter((item) => !isSameApplicantInfo(item, info)),
    ].slice(0, MAX_SAVED_APPLICANTS);

    try {
      localStorage.setItem(APPLICANT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      setStatus('브라우저 저장소를 사용할 수 없어 신청자 정보를 저장하지 못했습니다.', true);
      return;
    }

    refreshApplicantDatalists(next);
    saveFormState();
    setStatus('신청자 정보를 브라우저에 저장했습니다.');
  });

  applicantClearBtn?.addEventListener('click', () => {
    if (!window.confirm('브라우저에 저장된 신청자 정보 목록을 모두 삭제할까요?')) return;
    try {
      localStorage.removeItem(APPLICANT_STORAGE_KEY);
    } catch {
      setStatus('브라우저 저장소를 사용할 수 없어 저장 목록을 삭제하지 못했습니다.', true);
      return;
    }

    refreshApplicantDatalists([]);
    setStatus('저장된 신청자 정보 목록을 모두 삭제했습니다.');
  });
}

function collectApplicantInfo(): SavedApplicantInfo | null {
  const values = Object.fromEntries(
    APPLICANT_FIELDS.map((name) => [name, getApplicantInput(name)?.value.trim() ?? '']),
  ) as Record<ApplicantField, string>;
  if (!APPLICANT_FIELDS.some((name) => values[name])) return null;
  return { ...values, updatedAt: new Date().toISOString() };
}

function getApplicantInput(name: ApplicantField): HTMLInputElement | null {
  const control = formEl.elements.namedItem(name);
  return control instanceof HTMLInputElement ? control : null;
}

function loadApplicantInfos(): SavedApplicantInfo[] {
  try {
    const raw = localStorage.getItem(APPLICANT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeApplicantInfo)
      .filter((item): item is SavedApplicantInfo => item !== null);
  } catch {
    return [];
  }
}

function normalizeApplicantInfo(raw: unknown): SavedApplicantInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<Record<ApplicantField | 'updatedAt', unknown>>;
  const values = Object.fromEntries(
    APPLICANT_FIELDS.map((name) => [name, typeof item[name] === 'string' ? item[name].trim() : '']),
  ) as Record<ApplicantField, string>;
  if (!APPLICANT_FIELDS.some((name) => values[name])) return null;
  return {
    ...values,
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
  };
}

function refreshApplicantDatalists(applicants = loadApplicantInfos()): void {
  for (const field of APPLICANT_FIELDS) {
    const datalist = document.getElementById(APPLICANT_DATALISTS[field]) as HTMLDataListElement | null;
    if (!datalist) continue;
    datalist.replaceChildren(
      ...uniqueApplicantValues(applicants, field).map((value) => {
        const option = document.createElement('option');
        option.value = value;
        return option;
      }),
    );
  }
}

function uniqueApplicantValues(applicants: SavedApplicantInfo[], field: ApplicantField): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const item of applicants) {
    const value = item[field].trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

function isSameApplicantInfo(a: SavedApplicantInfo, b: SavedApplicantInfo): boolean {
  return APPLICANT_FIELDS.every((field) => a[field] === b[field]);
}

function restoreFormState(): boolean {
  let saved: SavedFormState | null = null;
  try {
    const raw = localStorage.getItem(FORM_STORAGE_KEY);
    saved = raw ? JSON.parse(raw) as SavedFormState : null;
  } catch {
    return false;
  }
  if (!saved?.values) return false;

  for (const [name, value] of Object.entries(saved.values)) {
    const control = formEl.elements.namedItem(name);
    if (!control) continue;
    if (control instanceof RadioNodeList) {
      control.value = value;
    } else if (
      control instanceof HTMLInputElement ||
      control instanceof HTMLSelectElement ||
      control instanceof HTMLTextAreaElement
    ) {
      setFormControlValue(control, value);
    }
  }

  autoTravelDates.clear();
  for (const [name, value] of Object.entries(saved.autoTravelDates ?? {})) {
    autoTravelDates.set(name, value);
  }
  autoReturnLocations.clear();
  for (const [name, value] of Object.entries(saved.autoReturnLocations ?? {})) {
    autoReturnLocations.set(name, value);
  }
  return true;
}

function saveFormState(): void {
  try {
    localStorage.setItem(FORM_STORAGE_KEY, JSON.stringify({
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

function loadStoredSignatureStamp(): StoredSignatureStamp | null {
  try {
    const raw = localStorage.getItem(SIGNATURE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : null;
    return normalizeStoredSignatureStamp(parsed);
  } catch {
    return null;
  }
}

function saveStoredSignatureStamp(stamp: StoredSignatureStamp): { ok: true } | { ok: false; reason: string } {
  const payload = JSON.stringify({
    ...stamp,
    updatedAt: new Date().toISOString(),
  } satisfies StoredSignatureStamp);
  try {
    localStorage.setItem(SIGNATURE_STORAGE_KEY, payload);
    return { ok: true };
  } catch (err) {
    console.error('[signature] localStorage 저장 실패', err);
    const sizeKb = Math.round(payload.length / 1024);
    const quotaLike =
      (err instanceof DOMException &&
        (err.name === 'QuotaExceededError' || err.code === 22 || err.code === 1014)) ||
      /quota/i.test(String((err as { message?: unknown })?.message ?? ''));
    if (quotaLike) {
      return {
        ok: false,
        reason: `브라우저 저장 용량 부족(${sizeKb}KB). 이미지를 좀 더 작게 만들어 다시 시도해 주세요.`,
      };
    }
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `브라우저 저장 실패: ${detail || '알 수 없는 오류'}` };
  }
}

function clearStoredSignatureStamp(): boolean {
  try {
    localStorage.removeItem(SIGNATURE_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

function hasStoredSignatureStamp(): boolean {
  try {
    return localStorage.getItem(SIGNATURE_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

function normalizeStoredSignatureStamp(raw: unknown): StoredSignatureStamp | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Partial<StoredSignatureStamp>;
  if (
    item.mime !== 'image/png' ||
    typeof item.dataUrl !== 'string' ||
    !item.dataUrl.startsWith('data:image/png;base64,') ||
    typeof item.widthPx !== 'number' ||
    typeof item.heightPx !== 'number'
  ) {
    return null;
  }
  const rotationDeg = typeof item.rotationDeg === 'number'
    ? Math.min(10, Math.max(0, Math.round(item.rotationDeg)))
    : 0;
  return {
    mime: 'image/png',
    dataUrl: item.dataUrl,
    widthPx: Math.max(1, Math.round(item.widthPx)),
    heightPx: Math.max(1, Math.round(item.heightPx)),
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
    ...(rotationDeg > 0 ? { rotationDeg } : {}),
  };
}

function setDefaultSubmitDate(): void {
  const input = formEl.elements.namedItem('제출날짜') as HTMLInputElement | null;
  if (!input || input.value) return;
  input.value = todayDateValue();
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
    return;
  }
  const inputName = label === '이름' ? '성명' : label;
  const input = formEl.elements.namedItem(inputName) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
  if (!input) return;
  if (cfg.type === 'date') setFormControlValue(input, parseDateKR(hwpValue));
  else setFormControlValue(input, hwpValue);
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
 * URL 쿼리스트링의 값을 폼 input 들에 채워 넣는다. setupDateTimeControls 보다 먼저 호출해서
 * 일시 picker 가 초기화 시 hidden input 값을 읽어가게 해야 한다.
 *
 * 반환값: 채워 넣은 키가 하나라도 있으면 true (이후 미리보기 자동 반영 트리거에 사용).
 */
function applyUrlFormValuesToInputs(): boolean {
  if (!hasUrlFormValues()) return false;
  const values = readUrlFormValues();
  let applied = 0;
  for (const [name, value] of Object.entries(values)) {
    const control = formEl.elements.namedItem(name);
    if (!control) continue;
    if (control instanceof RadioNodeList) {
      control.value = value;
      applied += 1;
    } else if (
      control instanceof HTMLInputElement ||
      control instanceof HTMLSelectElement ||
      control instanceof HTMLTextAreaElement
    ) {
      setFormControlValue(control, value);
      applied += 1;
    }
  }
  return applied > 0;
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

function setupPanelToggle(): void {
  const mobileQuery = window.matchMedia('(max-width: 800px)');
  const syncAria = (): void => {
    toggleBtn.setAttribute('aria-expanded', String(!appBodyEl.classList.contains('panel-collapsed')));
  };
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

function setupDateTimeControls(): void {
  const controls = formEl.querySelectorAll<HTMLElement>('[data-datetime-picker]');
  for (const control of controls) {
    const controller = setupDateTimePicker(control, {
      defaultHour: control.dataset.datetimeDefaultHour,
      placeholder: control.dataset.datetimePlaceholder,
      onChange: () => {
        applyTravelDateDefault(control);
        liveDateTimePreviewHandler?.();
      },
    });
    if (controller) {
      dateTimeControllers.set(control, controller);
      applyTravelDateDefault(control);
    }
  }
}

function setupReturnLocationDefaults(): void {
  for (const sourceName of Object.keys(RETURN_LOCATION_DEFAULTS)) {
    const source = formEl.elements.namedItem(sourceName);
    if (!(source instanceof HTMLInputElement)) continue;
    const apply = (): void => {
      applyReturnLocationDefault(sourceName);
    };
    source.addEventListener('input', apply);
    source.addEventListener('change', apply);
    apply();
  }
}

function syncAllDateTimeControlsToHidden(): void {
  for (const control of formEl.querySelectorAll<HTMLElement>('[data-datetime-picker]')) {
    dateTimeControllers.get(control)?.syncHidden();
  }
}

function syncAllDateTimeControlsFromHidden(): void {
  for (const control of formEl.querySelectorAll<HTMLElement>('[data-datetime-picker]')) {
    const hidden = control.querySelector<HTMLInputElement>('input[type="hidden"]');
    dateTimeControllers.get(control)?.setValue(hidden?.value ?? '');
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
  const target = formEl.elements.namedItem(targetName) as HTMLInputElement | null;
  if (!date || !target) return;
  const previousAutoDate = autoTravelDates.get(targetName);
  if (target.value && target.value !== previousAutoDate) {
    if (target.value === date) autoTravelDates.set(targetName, date);
    return;
  }
  target.value = date;
  autoTravelDates.set(targetName, date);
}

function applyReturnLocationDefault(sourceName: string): boolean {
  const targetName = RETURN_LOCATION_DEFAULTS[sourceName];
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

async function initialize(): Promise<void> {
  setStatus('양식 엔진 초기화 중...');
  registerFontFaces();
  setupPanelToggle();
  const restoredFormState = restoreFormState();
  // URL 쿼리스트링은 localStorage 복원본보다 우선한다 — 공유받은 URL 의 의도를 존중.
  const urlFormApplied = applyUrlFormValuesToInputs();
  setDefaultSubmitDate();
  setupDateTimeControls();
  setupReturnLocationDefaults();
  setupLocalFormPersistence();
  setupApplicantInfoStorage();
  await preloadFonts();

  // 1) HWP 양식 fetch + 로드
  const { wasm, docInfo, templateBytes } = await loadTemplate(TEMPLATE_URL);

  // 1.5) 문서가 실제로 쓰는 폰트들을 적극 프리로드한 뒤 레이아웃 폭 측정값을 갱신
  await preloadFonts(docInfo.fontsUsed ?? []);
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
  function reloadPristineTemplate(): void {
    const storedStamp = signatureStamp.getStoredStamp();
    const hadStamp = signatureStamp.hasStamp();
    signatureStamp.forgetDocumentState();
    wasm.loadDocument(templateBytes);
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
    if (options.clearEmpty && !rangeText && hasFilledRangeField()) {
      reloadPristineTemplate();
    }
    const { applied, missing } = setFieldValues(wasm, fields, values, {
      clearEmpty: options.clearEmpty,
    });
    fillDateTimeRange(wasm, fields, rangeText, { clearEmpty: options.clearEmpty });
    realignSignatureStamp();
    refreshPreview(wasm);
    fields = discoverFields(wasm);
    if (!statusMessage) return;
    const warn = missing.length > 0 ? ` (양식에 없는 라벨: ${missing.join(', ')})` : '';
    setStatus(statusMessage.replace('{applied}', String(applied)) + warn, missing.length > 0);
  }

  function applyTravelDatesToPreview(): void {
    const { 갈때일자, 올때일자 } = collectFormValues();
    setFieldValues(wasm, fields, { 갈때일자, 올때일자 });
  }

  function applyReturnLocationsToPreview(): void {
    const { 올때출발지, 올때도착지 } = collectFormValues();
    setFieldValues(wasm, fields, { 올때출발지, 올때도착지 }, { clearEmpty: true });
  }

  if (urlFormApplied) {
    // 공유 URL 의 의도를 한 번 더 명확히 — 폼에 반영한 값을 그대로 미리보기에 적용한다.
    // 이후 자동 저장 로직이 URL 값을 localStorage 에도 보관하므로 새로고침해도 유지된다.
    applyCollectedValuesToPreview('공유 URL 의 값을 양식에 채웠습니다.');
    saveFormState();
    // 주소창의 ?쿼리는 한 번 적용 후 깨끗이 — 두 번째 새로고침부터는 localStorage 가 권위.
    clearUrlFormValues();
  } else if (restoredFormState) {
    applyCollectedValuesToPreview('저장된 입력 내용을 복원했습니다.');
  }

  const storedSignatureStamp = loadStoredSignatureStamp();
  if (storedSignatureStamp) {
    try {
      signatureStamp.applyStored(storedSignatureStamp);
      refreshPreview(wasm);
      updateSignatureButtons();
      setStatus('브라우저에 저장된 도장/서명 이미지를 복원했습니다.');
    } catch (err) {
      console.warn('[web-form] 저장된 도장/서명 이미지 복원 실패:', err);
      clearStoredSignatureStamp();
      updateSignatureButtons();
      setStatus('저장된 도장/서명 이미지를 불러오지 못해 저장본을 삭제했습니다.', true);
    }
  }

  let livePreviewTimer = 0;
  function scheduleLivePreview(statusMessage = '입력 내용을 미리보기에 반영했습니다.'): void {
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
  });
  formEl.addEventListener('change', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.type === 'file') return;
    scheduleLivePreview();
  });

  // 4) 인라인 편집 핸들러 부착 — 누름틀 + (인)/도장 영역
  attachInlineEditing({
    wasm,
    canvasView,
    container: previewContainer,
    getFields: () => fields,
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
    onAfterEdit: (label, value) => {
      syncFormFromInline(label, value);
      if (label === '시작일시' || label === '종료일시') {
        applyTravelDatesToPreview();
      }
      if (applyReturnLocationDefault(label)) {
        applyReturnLocationsToPreview();
      }
      if (label === '성명' || label === '이름') {
        realignSignatureStamp();
      }
      refreshPreview(wasm);
      fields = discoverFields(wasm);
      saveFormState();
      setStatus(`"${label}" 항목을 반영했습니다.`);
    },
  });

  // 5) 액션 버튼 바인딩
  async function applySignatureFile(file: File, successMessage: string): Promise<void> {
    try {
      await signatureStamp.applyFile(file);
      refreshPreview(wasm);
      updateSignatureButtons();
      setStatus(successMessage);
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
    await applySignatureFile(file, '도장/서명 이미지를 성명 옆 (인)에 넣었습니다. 계속 쓰려면 브라우저 저장을 누르세요.');
  });

  /** 이름 → 막도장 생성기. 사이드패널 버튼과 미리보기 도장 메뉴가 공유한다. */
  function openStampGeneratorWithName(): void {
    const nameControl = formEl.elements.namedItem('성명');
    openStampGenerator({
      initialName: nameControl instanceof HTMLInputElement ? nameControl.value.trim() : '',
      onGenerate: (file) => {
        void applySignatureFile(file, '만든 도장을 성명 옆 (인)에 넣었습니다. 계속 쓰려면 브라우저 저장을 누르세요.');
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
    refreshPreview(wasm);
    updateSignatureButtons();
    setStatus(deg === 0
      ? '도장 회전을 원래대로(0°) 되돌렸습니다.'
      : `도장을 ${deg}° 기울였습니다. 계속 쓰려면 브라우저 저장을 누르세요.`);
    return true;
  }

  function clearSignatureFromDocument(): void {
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
    rotateSignatureTo((signatureStamp.getRotationDeg() + 2) % 12); // 0→2→…→10→0 순환
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

  function realignSignatureStamp(): void {
    if (!signatureStamp.hasStamp()) return;
    try {
      signatureStamp.realign();
    } catch (err) {
      console.warn('[web-form] 도장/서명 위치 재정렬 실패:', err);
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
    signatureCurrentLabel.textContent = savedInBrowser
      ? '브라우저 저장본 사용 중 — 새 이미지를 고르면 교체됩니다'
      : '방금 업로드한 이미지 사용 중 — 다음 방문에도 쓰려면 "브라우저 저장"';
  }

  // 모바일 전용 — 폼을 닫고 미리보기를 보여준다. 입력은 이미 자동 반영되어 있다.
  document.getElementById('btn-show-preview')?.addEventListener('click', () => {
    pushRecentValuesFromForm();
    appBodyEl.classList.add('panel-collapsed');
    toggleBtn.setAttribute('aria-expanded', 'false');
  });

  document.getElementById('btn-download-hwp')!.addEventListener('click', async () => {
    try {
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
    btn.disabled = true;
    try {
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
    const removedStamp = signatureStamp.clear();
    formEl.reset();
    autoTravelDates.clear();
    autoReturnLocations.clear();
    clearSavedFormState();
    // 일시 picker 는 hidden input 의 defaultValue 가 이전 입력값으로 굳어버려 formEl.reset() 만으로는
    // 비워지지 않는다. 명시적으로 controller + attribute 를 함께 초기화한다.
    resetAllDateTimeControls();
    setDefaultSubmitDate();
    if (signatureInput) signatureInput.value = '';
    updateSignatureButtons();
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
      '출장지',
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
