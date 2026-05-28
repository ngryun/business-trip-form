import { loadTemplate } from './template-loader';
import { discoverFields, fillDateTimeRange, removeDateTimeRangeSeparator, setFieldValues, type FieldMap } from './field-filler';
import { downloadHwp } from './download';
import { mountPreview, refreshPreview } from './preview';
import { registerFontFaces, preloadFonts } from './fonts';
import { attachInlineEditing } from './field-interaction';
import { setupDateTimePicker, type DateTimePickerController } from './datetime-picker';
import { SignatureStampManager, type StoredSignatureStamp } from './signature-stamp';
import { printPdf, type PdfSaveResult } from './print-pdf';
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

const statusEl = document.getElementById('status') as HTMLParagraphElement;
const formEl = document.getElementById('trip-form') as HTMLFormElement;
const previewContainer = document.getElementById('scroll-container') as HTMLDivElement;
const appBodyEl = document.querySelector('.app-body') as HTMLDivElement;
const toggleBtn = document.getElementById('btn-toggle-panel') as HTMLButtonElement;
const applicantSaveBtn = document.getElementById('btn-save-applicant') as HTMLButtonElement | null;
const applicantClearBtn = document.getElementById('btn-clear-applicants') as HTMLButtonElement | null;
const signatureInput = document.getElementById('signature-image') as HTMLInputElement | null;
const signatureClearBtn = document.getElementById('btn-clear-signature') as HTMLButtonElement | null;
const signatureSaveBtn = document.getElementById('btn-save-signature') as HTMLButtonElement | null;
const signatureClearSavedBtn = document.getElementById('btn-clear-saved-signature') as HTMLButtonElement | null;
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

function setStatus(message: string, isError = false): void {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
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

function saveStoredSignatureStamp(stamp: StoredSignatureStamp): boolean {
  try {
    localStorage.setItem(SIGNATURE_STORAGE_KEY, JSON.stringify({
      ...stamp,
      updatedAt: new Date().toISOString(),
    } satisfies StoredSignatureStamp));
    return true;
  } catch {
    return false;
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
  return {
    mime: 'image/png',
    dataUrl: item.dataUrl,
    widthPx: Math.max(1, Math.round(item.widthPx)),
    heightPx: Math.max(1, Math.round(item.heightPx)),
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
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
  const isMobile = (): boolean => window.matchMedia('(max-width: 800px)').matches;
  // 모바일은 기본 접힘 (미리보기 우선), 데스크톱은 기본 펼침
  if (isMobile()) appBodyEl.classList.add('panel-collapsed');
  toggleBtn.addEventListener('click', () => {
    appBodyEl.classList.toggle('panel-collapsed');
  });
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
  setDefaultSubmitDate();
  setupDateTimeControls();
  setupReturnLocationDefaults();
  setupLocalFormPersistence();
  setupApplicantInfoStorage();
  await preloadFonts();

  // 1) HWP 양식 fetch + 로드
  const { wasm, docInfo } = await loadTemplate(TEMPLATE_URL);

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
  function applyCollectedValuesToPreview(
    statusMessage?: string,
    options: PreviewApplyOptions = {},
  ): void {
    const { 시작일시: rangeText, ...values } = collectFormValues();
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

  if (restoredFormState) {
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

  // 4) 인라인 편집 핸들러 부착
  attachInlineEditing({
    wasm,
    canvasView,
    container: previewContainer,
    getFields: () => fields,
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
  signatureInput?.addEventListener('change', async () => {
    const file = signatureInput.files?.[0];
    if (!file) return;
    try {
      await signatureStamp.applyFile(file);
      refreshPreview(wasm);
      updateSignatureButtons();
      setStatus('도장/서명 이미지를 성명 옆 (인)에 넣었습니다. 계속 쓰려면 브라우저 저장을 누르세요.');
    } catch (err) {
      console.error(err);
      signatureInput.value = '';
      updateSignatureButtons();
      setStatus(`도장/서명 이미지 적용 실패: ${describeError(err)}`, true);
    }
  });

  signatureClearBtn?.addEventListener('click', () => {
    const removed = signatureStamp.clear();
    if (signatureInput) signatureInput.value = '';
    updateSignatureButtons();
    if (removed) {
      refreshPreview(wasm);
      setStatus('문서에서 도장/서명 이미지를 삭제했습니다. 브라우저 저장본은 유지됩니다.');
    } else {
      setStatus('삭제할 도장/서명 이미지가 없습니다.');
    }
  });

  signatureSaveBtn?.addEventListener('click', () => {
    const stored = signatureStamp.getStoredStamp();
    if (!stored) {
      setStatus('먼저 도장/서명 이미지를 선택하세요.', true);
      return;
    }
    if (!saveStoredSignatureStamp(stored)) {
      setStatus('브라우저 저장소를 사용할 수 없어 도장/서명 이미지를 저장하지 못했습니다.', true);
      return;
    }
    updateSignatureButtons();
    setStatus('도장/서명 이미지를 브라우저에 저장했습니다.');
  });

  signatureClearSavedBtn?.addEventListener('click', () => {
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
    if (signatureClearBtn) signatureClearBtn.disabled = !signatureStamp.hasStamp();
    if (signatureSaveBtn) signatureSaveBtn.disabled = !signatureStamp.getStoredStamp();
    if (signatureClearSavedBtn) signatureClearSavedBtn.disabled = !hasStoredSignatureStamp();
  }

  document.getElementById('btn-apply')!.addEventListener('click', () => {
    try {
      saveFormState();
      applyCollectedValuesToPreview('{applied}개 필드에 반영했습니다.', { clearEmpty: true });
    } catch (err) {
      console.error(err);
      setStatus(`반영 실패: ${(err as Error).message}`, true);
    }
  });

  document.getElementById('btn-download-hwp')!.addEventListener('click', () => {
    try {
      const fileName = suggestFileName(collectFormValues());
      downloadHwp(wasm, fileName);
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

  document.getElementById('btn-reset')!.addEventListener('click', () => {
    const removedStamp = signatureStamp.clear();
    formEl.reset();
    autoTravelDates.clear();
    autoReturnLocations.clear();
    clearSavedFormState();
    syncAllDateTimeControlsFromHidden();
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
}

function suggestFileName(values: Record<string, string>): string {
  const date = values.제출날짜.replace(/[. ]/g, '').slice(0, 8) || 'undated';
  const who = (values.성명 || 'anonymous').replace(/\s/g, '');
  return `출장신청서_${who}_${date}.hwp`;
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
