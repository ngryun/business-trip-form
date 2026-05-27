import { loadTemplate } from './template-loader';
import { discoverFields, setFieldValues, type FieldMap } from './field-filler';
import { downloadHwp } from './download';
import { mountPreview, refreshPreview } from './preview';
import { registerFontFaces, preloadFonts } from './fonts';
import { attachInlineEditing } from './field-interaction';
import {
  composeDateTimeLocalValue,
  DATETIME_HOUR_OPTIONS,
  DATETIME_MINUTE_OPTIONS,
  FIELD_CONFIGS,
  formatDateKR,
  formatDateTimeKR,
  parseDateKR,
  parseDateTimeKR,
  splitDateTimeLocal,
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

const statusEl = document.getElementById('status') as HTMLParagraphElement;
const formEl = document.getElementById('trip-form') as HTMLFormElement;
const previewContainer = document.getElementById('scroll-container') as HTMLDivElement;
const appBodyEl = document.querySelector('.app-body') as HTMLDivElement;
const toggleBtn = document.getElementById('btn-toggle-panel') as HTMLButtonElement;
const TRAVEL_DATE_DEFAULTS: Record<string, string> = {
  시작일시: '갈때일자',
  종료일시: '올때일자',
};

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
  return {
    소속: raw.소속 ?? '',
    직급: raw.직급 ?? '',
    성명: name,
    이름: name,
    시작일시: formatDateTimeKR(raw.시작일시 ?? ''),
    종료일시: formatDateTimeKR(raw.종료일시 ?? ''),
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

/** 인라인 편집으로 누름틀이 바뀌면 같은 라벨의 폼 입력도 동기화한다. */
function syncFormFromInline(label: string, hwpValue: string): void {
  const cfg = FIELD_CONFIGS[label];
  if (!cfg) return;
  const inputName = label === '이름' ? '성명' : label;
  if (cfg.type === 'datetime') {
    setDateTimeControlValue(inputName, parseDateTimeKR(hwpValue));
    return;
  }
  const input = formEl.elements.namedItem(inputName) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
  if (!input) return;
  if (cfg.type === 'date') input.value = parseDateKR(hwpValue);
  else input.value = hwpValue;
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
    const parts = getDateTimeControlParts(control);
    if (!parts) continue;

    fillDateTimeSelect(parts.hourSelect, DATETIME_HOUR_OPTIONS, '시', '시');
    fillDateTimeSelect(parts.minuteSelect, DATETIME_MINUTE_OPTIONS, '분', '분');
    setDateTimeControlVisibleValue(control, parts.hidden.value);

    const handleChange = (): void => {
      syncDateTimeControlToHidden(control);
      applyTravelDateDefault(control);
    };
    parts.dateInput.addEventListener('input', handleChange);
    parts.dateInput.addEventListener('change', handleChange);
    parts.hourSelect.addEventListener('change', handleChange);
    parts.minuteSelect.addEventListener('change', handleChange);
  }
}

function syncAllDateTimeControlsToHidden(): void {
  for (const control of formEl.querySelectorAll<HTMLElement>('[data-datetime-picker]')) {
    syncDateTimeControlToHidden(control);
  }
}

function syncAllDateTimeControlsFromHidden(): void {
  for (const control of formEl.querySelectorAll<HTMLElement>('[data-datetime-picker]')) {
    const parts = getDateTimeControlParts(control);
    if (parts) setDateTimeControlVisibleValue(control, parts.hidden.value);
  }
}

function syncDateTimeControlToHidden(control: HTMLElement): void {
  const parts = getDateTimeControlParts(control);
  if (!parts) return;
  parts.hidden.value = composeDateTimeLocalValue(
    parts.dateInput.value,
    parts.hourSelect.value,
    parts.minuteSelect.value,
  );
}

function setDateTimeControlValue(name: string, value: string): void {
  const hidden = formEl.elements.namedItem(name) as HTMLInputElement | null;
  if (hidden) hidden.value = value;

  for (const control of formEl.querySelectorAll<HTMLElement>('[data-datetime-picker]')) {
    if (control.dataset.datetimePicker === name) {
      setDateTimeControlVisibleValue(control, value);
      syncDateTimeControlToHidden(control);
      applyTravelDateDefault(control);
      return;
    }
  }
}

function setDateTimeControlVisibleValue(control: HTMLElement, value: string): void {
  const parts = getDateTimeControlParts(control);
  if (!parts) return;
  const parsed = splitDateTimeLocal(value);
  parts.dateInput.value = parsed.date;
  parts.hourSelect.value = parsed.hour;
  parts.minuteSelect.value = parsed.minute;
}

function getDateTimeControlParts(control: HTMLElement): {
  hidden: HTMLInputElement;
  dateInput: HTMLInputElement;
  hourSelect: HTMLSelectElement;
  minuteSelect: HTMLSelectElement;
} | null {
  const hidden = control.querySelector<HTMLInputElement>('input[type="hidden"]');
  const dateInput = control.querySelector<HTMLInputElement>('[data-datetime-date]');
  const hourSelect = control.querySelector<HTMLSelectElement>('[data-datetime-hour]');
  const minuteSelect = control.querySelector<HTMLSelectElement>('[data-datetime-minute]');
  if (!hidden || !dateInput || !hourSelect || !minuteSelect) return null;
  return { hidden, dateInput, hourSelect, minuteSelect };
}

function fillDateTimeSelect(select: HTMLSelectElement, values: string[], placeholder: string, suffix: string): void {
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = placeholder;
  select.replaceChildren(blank);
  for (const value of values) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = `${value}${suffix}`;
    select.appendChild(option);
  }
}

function applyTravelDateDefault(control: HTMLElement): void {
  const sourceName = control.dataset.datetimePicker;
  if (!sourceName) return;
  const targetName = TRAVEL_DATE_DEFAULTS[sourceName];
  if (!targetName) return;

  const parts = getDateTimeControlParts(control);
  const target = formEl.elements.namedItem(targetName) as HTMLInputElement | null;
  if (!parts || !target || target.value || !parts.dateInput.value) return;
  target.value = parts.dateInput.value;
}

async function initialize(): Promise<void> {
  setStatus('양식 엔진 초기화 중...');
  registerFontFaces();
  setupPanelToggle();
  setupDateTimeControls();

  // 1) HWP 양식 fetch + 로드
  const { wasm, docInfo } = await loadTemplate(TEMPLATE_URL);

  // 1.5) 문서가 실제로 쓰는 폰트들을 적극 프리로드
  await preloadFonts(docInfo.fontsUsed ?? []);

  setStatus(`양식 로드 완료 (${docInfo.pageCount}쪽). 폼에서 입력하거나 미리보기에서 누름틀을 클릭하세요.`);

  // 2) 누름틀 매핑 구성
  let fields: FieldMap = discoverFields(wasm);
  if (fields.size === 0) {
    setStatus('경고: 양식에서 누름틀을 찾지 못했습니다. 양식 파일을 확인해 주세요.', true);
  } else {
    console.info('[web-form] 발견한 누름틀 라벨:', [...fields.keys()]);
  }

  // 3) 미리보기 캔버스 마운트
  const canvasView = mountPreview(previewContainer, wasm);

  // 4) 인라인 편집 핸들러 부착
  attachInlineEditing({
    wasm,
    canvasView,
    container: previewContainer,
    getFields: () => fields,
    onAfterEdit: (label, value) => {
      refreshPreview(wasm);
      fields = discoverFields(wasm);
      syncFormFromInline(label, value);
      setStatus(`"${label}" 항목을 반영했습니다.`);
    },
  });

  // 5) 액션 버튼 바인딩
  document.getElementById('btn-apply')!.addEventListener('click', () => {
    try {
      const values = collectFormValues();
      const { applied, missing } = setFieldValues(wasm, fields, values);
      refreshPreview(wasm);
      fields = discoverFields(wasm);
      const warn = missing.length > 0 ? ` (양식에 없는 라벨: ${missing.join(', ')})` : '';
      setStatus(`${applied}개 필드에 반영했습니다.${warn}`, missing.length > 0);
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

  document.getElementById('btn-print')!.addEventListener('click', () => {
    window.print();
  });

  document.getElementById('btn-reset')!.addEventListener('click', () => {
    formEl.reset();
    syncAllDateTimeControlsFromHidden();
    setStatus('초기화했습니다.');
  });
}

function suggestFileName(values: Record<string, string>): string {
  const date = values.제출날짜.replace(/[. ]/g, '').slice(0, 8) || 'undated';
  const who = (values.성명 || 'anonymous').replace(/\s/g, '');
  return `출장신청서_${who}_${date}.hwp`;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || String(err);
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  try { return JSON.stringify(err); } catch { return String(err); }
}

initialize().catch((err) => {
  console.error('[web-form] 초기화 실패:', err);
  setStatus(`초기화 실패: ${describeError(err)}`, true);
});
