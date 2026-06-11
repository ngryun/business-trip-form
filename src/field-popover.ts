/**
 * 미리보기 위에서 누름틀을 클릭했을 때 떠오르는 입력 팝오버.
 *
 * - 라벨에 맞는 위젯(text/date/select/textarea/일시 선택기) 렌더링
 * - Enter 다음/확정 / Esc 취소 / 외부 클릭 취소 / 자동 포커스
 * - 화면 가장자리에서 잘리지 않도록 위치 보정
 */

import {
  createDateTimePicker,
  getDateTimePickerController,
  getDateTimePickerValue,
} from './datetime-picker';
import {
  ATTACHMENT_PRESETS,
  FIELD_CONFIGS,
  formatDateKR,
  formatDateTimeCompactKR,
  hasListItem,
  toggleListItem,
  type WidgetConfig,
} from './field-config';

export interface PopoverArgs {
  label: string;
  initialValue: string;
  /** 클라이언트 좌표계 기준 누름틀 근처 위치 (보통 클릭한 점) */
  anchor: { x: number; y: number };
  /** 최근에 같은 라벨에 입력했던 원시 값 목록 (date 는 `YYYY-MM-DD`). 비우면 표시 안 함. */
  recentValues?: string[];
  onConfirm: (value: string) => void;
  onCancel: () => void;
  onNext?: (value: string) => void;
}

export interface DateTimeRangePopoverArgs {
  anchor: { x: number; y: number };
  endValue: string;
  /** 처음 활성화할 탭 — 누름틀의 종료 쪽을 클릭했으면 'end' 로 열어준다. */
  initialTab?: 'start' | 'end';
  onCancel: () => void;
  onConfirm: (startValue: string, endValue: string) => void;
  onNext?: (startValue: string, endValue: string) => void;
  startValue: string;
}

export interface StampPopoverArgs {
  anchor: { x: number; y: number };
  hasStamp: boolean;
  rotationDeg: number;
  /** 파일 선택 대화상자 열기 (기존 도장이 있으면 교체) */
  onPickImage: () => void;
  /** 이름 → 막도장 생성기 열기 */
  onMakeStamp: () => void;
  /** 기울기 변경 (0~10°). 적용 성공 여부 반환 — 실패 시 슬라이더를 원래 값으로 되돌린다. */
  onRotate: (deg: number) => boolean;
  /** 문서에서 도장 삭제 */
  onClear: () => void;
}

/** 학교 출장에서 흔한 시간 패턴 — 시작 탭에서 고른 날짜(없으면 오늘)에 한 번에 적용한다. */
const RANGE_PRESETS: Array<{ label: string; startTime: string; endTime: string; nextDay?: boolean }> = [
  { label: '하루 09–18', startTime: '09:00', endTime: '18:00' },
  { label: '오전 09–13', startTime: '09:00', endTime: '13:00' },
  { label: '오후 13–18', startTime: '13:00', endTime: '18:00' },
  { label: '1박 2일', startTime: '09:00', endTime: '18:00', nextDay: true },
];

let currentPopover: HTMLElement | null = null;
let currentCleanup: (() => void) | null = null;

export function showFieldPopover(args: PopoverArgs): void {
  closeFieldPopover();
  const cfg = FIELD_CONFIGS[args.label];
  if (!cfg) return;

  const root = document.createElement('div');
  root.className = `field-popover${cfg.type === 'select' ? ' field-popover--select' : ''}`;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', `${args.label} 입력`);

  const titleEl = document.createElement('div');
  titleEl.className = 'field-popover__title';
  titleEl.textContent = args.label;
  root.appendChild(titleEl);

  const input = createInput(args.label, cfg, args.initialValue);
  if (cfg.type !== 'select' && !input.classList.contains('field-popover__date')) {
    input.classList.add('field-popover__input');
  }

  // 최근 입력 칩: 같은 라벨에 이전에 넣었던 값을 한 번 클릭으로 채워 넣고 바로 확정한다.
  const recentChips = buildRecentChips(cfg, args.recentValues ?? [], args.initialValue, (raw) => {
    fillInputValue(input, cfg, raw);
    // 칩 클릭은 그 값으로 곧장 반영하기로 설계 — 사용자가 "확인" 한 번 더 누를 필요 없이 종료.
    finish('confirm');
  });
  if (recentChips) root.appendChild(recentChips);

  // 첨부서류 자주 쓰는 항목 — 토글로 조합한 뒤 확인으로 반영 (최근 칩과 달리 즉시 확정하지 않음)
  if (args.label === '첨부서류' && input instanceof HTMLTextAreaElement) {
    root.appendChild(buildAttachmentPresetRow(input));
  }

  root.appendChild(input);

  const buttons = document.createElement('div');
  buttons.className = 'field-popover__buttons';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'field-popover__cancel';
  cancelBtn.textContent = '취소';
  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'field-popover__confirm';
  confirmBtn.textContent = '확인';
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'field-popover__next';
  nextBtn.textContent = '다음';
  if (args.onNext) buttons.append(cancelBtn, nextBtn, confirmBtn);
  else buttons.append(cancelBtn, confirmBtn);
  root.appendChild(buttons);

  document.body.appendChild(root);
  positionNear(root, args.anchor);

  const finish = (action: 'cancel' | 'confirm' | 'next'): void => {
    if (action === 'cancel') {
      args.onCancel();
      closeFieldPopover();
      return;
    }

    const value = getInputValue(input);
    if (action === 'next' && args.onNext) {
      closeFieldPopover();
      args.onNext(value);
      return;
    }
    args.onConfirm(value);
    closeFieldPopover();
  };

  confirmBtn.addEventListener('click', () => finish('confirm'));
  nextBtn.addEventListener('click', () => finish('next'));
  cancelBtn.addEventListener('click', () => finish('cancel'));
  input.addEventListener('field-popover-select', () => finish('confirm'));
  input.addEventListener('field-popover-commit', () => finish('confirm'));

  input.addEventListener('keydown', (e) => {
    const ke = e as KeyboardEvent;
    const target = ke.target as HTMLElement | null;
    if (cfg.type === 'select' && ke.key === 'Enter' && target?.closest('.field-popover__select-option')) {
      return;
    }
    if (ke.key === 'Enter' && target?.closest('.field-popover__today-button')) {
      return;
    }
    if (ke.key === 'Enter') {
      if (target instanceof HTMLTextAreaElement && ke.shiftKey) return;
      ke.preventDefault();
      finish(args.onNext ? 'next' : 'confirm');
    } else if (args.onNext && isNextShortcut(ke)) {
      ke.preventDefault();
      finish('next');
    } else if (ke.key === 'Escape') {
      ke.preventDefault();
      finish('cancel');
    }
  });

  // 외부 클릭 시 취소 — 팝오버 자체를 연 click 이벤트가 곧장 닫지 않도록 다음 틱에 바인딩
  const onOuter = (e: MouseEvent): void => {
    if (!root.contains(e.target as Node)) finish('cancel');
  };
  setTimeout(() => document.addEventListener('mousedown', onOuter, { capture: true }), 0);
  currentCleanup = () => document.removeEventListener('mousedown', onOuter, { capture: true } as any);

  // 자동 포커스 (텍스트 인풋은 전체 선택까지)
  setTimeout(() => {
    focusInput(input);
  }, 0);

  currentPopover = root;
}

export function showDateTimeRangePopover(args: DateTimeRangePopoverArgs): void {
  closeFieldPopover();

  const root = document.createElement('div');
  root.className = 'field-popover field-popover--range';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', '출장 일시 입력');

  const titleEl = document.createElement('div');
  titleEl.className = 'field-popover__title';
  titleEl.textContent = '출장 일시';
  root.appendChild(titleEl);

  // 시작/종료 탭 — 탭 라벨이 현재 값 요약을 겸한다
  let activeTab: 'start' | 'end' = args.initialTab ?? 'start';
  const tabs = document.createElement('div');
  tabs.className = 'field-popover__tabs';
  tabs.setAttribute('role', 'tablist');
  const startTabBtn = createRangeTabButton();
  const endTabBtn = createRangeTabButton();
  tabs.append(startTabBtn, endTabBtn);
  root.appendChild(tabs);

  // 빠른 선택 칩
  const presets = document.createElement('div');
  presets.className = 'field-popover__presets';
  const presetsLabel = document.createElement('span');
  presetsLabel.className = 'field-popover__recent-label';
  presetsLabel.textContent = '빠른 선택';
  presets.appendChild(presetsLabel);
  root.appendChild(presets);

  // 두 피커를 모두 만들어 두고 표시만 전환 — 탭을 오가도 입력 상태가 유지된다
  const range = document.createElement('div');
  range.className = 'field-popover__range';
  const startPicker = createDateTimePicker(args.startValue, {
    defaultHour: '09',
    inline: true,
    onChange: handleStartChange,
  });
  const endPicker = createDateTimePicker(args.endValue, {
    defaultHour: '18',
    inline: true,
    onChange: updateRangeMeta,
  });
  const startPane = createRangeTabPane(startPicker);
  const endPane = createRangeTabPane(endPicker);
  range.append(startPane, endPane);
  root.appendChild(range);

  const warnEl = document.createElement('div');
  warnEl.className = 'field-popover__range-warning';
  warnEl.textContent = '⚠ 종료 일시가 시작보다 빠릅니다.';
  warnEl.hidden = true;
  root.appendChild(warnEl);

  function rangeValues(): { start: string; end: string } {
    return {
      start: getDateTimePickerValue(startPicker),
      end: getDateTimePickerValue(endPicker),
    };
  }

  /** 시작을 고르면 비어 있는 종료를 같은 날 18:00 으로 제안한다 (탭에서 바로 수정 가능). */
  function handleStartChange(value: string): void {
    if (value && !getDateTimePickerValue(endPicker)) {
      getDateTimePickerController(endPicker)?.setValue(`${value.slice(0, 10)}T18:00`);
    }
    updateRangeMeta();
  }

  function updateRangeMeta(): void {
    const { start, end } = rangeValues();
    startTabBtn.textContent = start ? `시작 · ${formatDateTimeCompactKR(start)}` : '시작 일시';
    endTabBtn.textContent = end ? `종료 · ${formatDateTimeCompactKR(end)}` : '종료 일시';
    startTabBtn.classList.toggle('is-active', activeTab === 'start');
    endTabBtn.classList.toggle('is-active', activeTab === 'end');
    startTabBtn.setAttribute('aria-selected', String(activeTab === 'start'));
    endTabBtn.setAttribute('aria-selected', String(activeTab === 'end'));
    startPane.hidden = activeTab !== 'start';
    endPane.hidden = activeTab !== 'end';
    warnEl.hidden = !(start && end && end < start);
  }

  function setActiveTab(tab: 'start' | 'end'): void {
    activeTab = tab;
    updateRangeMeta();
  }

  startTabBtn.addEventListener('click', () => setActiveTab('start'));
  endTabBtn.addEventListener('click', () => setActiveTab('end'));

  for (const preset of RANGE_PRESETS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'field-popover__recent-chip';
    chip.textContent = preset.label;
    chip.addEventListener('click', () => {
      // 시작 탭에서 고른 날짜 기준, 아직 없으면 오늘
      const date = getDateTimePickerController(startPicker)?.getDate() || todayDateValue();
      const endDate = preset.nextDay ? addDaysToDateValue(date, 1) : date;
      getDateTimePickerController(startPicker)?.setValue(`${date}T${preset.startTime}`);
      getDateTimePickerController(endPicker)?.setValue(`${endDate}T${preset.endTime}`);
      updateRangeMeta();
    });
    presets.appendChild(chip);
  }

  const buttons = document.createElement('div');
  buttons.className = 'field-popover__buttons';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'field-popover__cancel';
  cancelBtn.textContent = '취소';
  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'field-popover__confirm';
  confirmBtn.textContent = '확인';
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'field-popover__next';
  nextBtn.textContent = '다음';
  if (args.onNext) buttons.append(cancelBtn, nextBtn, confirmBtn);
  else buttons.append(cancelBtn, confirmBtn);
  root.appendChild(buttons);

  updateRangeMeta();
  document.body.appendChild(root);
  positionNear(root, args.anchor);

  const finish = (action: 'cancel' | 'confirm' | 'next'): void => {
    if (action === 'cancel') {
      args.onCancel();
      closeFieldPopover();
      return;
    }

    const { start: startValue, end: endValue } = rangeValues();
    if (action === 'next' && args.onNext) {
      closeFieldPopover();
      args.onNext(startValue, endValue);
      return;
    }
    args.onConfirm(startValue, endValue);
    closeFieldPopover();
  };

  confirmBtn.addEventListener('click', () => finish('confirm'));
  nextBtn.addEventListener('click', () => finish('next'));
  cancelBtn.addEventListener('click', () => finish('cancel'));
  root.addEventListener('keydown', (e) => {
    const ke = e as KeyboardEvent;
    const target = ke.target as HTMLElement | null;
    if (ke.key === 'Enter' && !target?.closest('button')) {
      ke.preventDefault();
      finish(args.onNext ? 'next' : 'confirm');
    } else if (args.onNext && isNextShortcut(ke)) {
      ke.preventDefault();
      finish('next');
    } else if (ke.key === 'Escape') {
      ke.preventDefault();
      finish('cancel');
    }
  });

  const onOuter = (e: MouseEvent): void => {
    if (!root.contains(e.target as Node)) finish('cancel');
  };
  setTimeout(() => document.addEventListener('mousedown', onOuter, { capture: true }), 0);
  currentCleanup = () => document.removeEventListener('mousedown', onOuter, { capture: true } as any);

  setTimeout(() => focusInput(activeTab === 'end' ? endPicker : startPicker), 0);
  currentPopover = root;
}

/**
 * 미리보기에서 (인)/도장 영역을 클릭했을 때 뜨는 도장 메뉴.
 *
 * - 도장이 있으면: 기울기 슬라이더(0~10°, 놓는 순간 적용) + 교체/다시 만들기/삭제
 * - 도장이 없으면: 이미지 선택 / 도장 만들기
 */
export function showStampPopover(args: StampPopoverArgs): void {
  closeFieldPopover();

  const root = document.createElement('div');
  root.className = 'field-popover field-popover--stamp';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', '도장/서명');

  const titleEl = document.createElement('div');
  titleEl.className = 'field-popover__title';
  titleEl.textContent = '도장/서명';
  root.appendChild(titleEl);

  if (args.hasStamp) {
    const rotateRow = document.createElement('div');
    rotateRow.className = 'field-popover__stamp-rotate';

    const rotateLabel = document.createElement('span');
    rotateLabel.className = 'field-popover__recent-label';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '10';
    slider.step = '1';
    slider.value = String(args.rotationDeg);
    slider.setAttribute('aria-label', '도장 기울기 (0~10도)');

    const syncLabel = (): void => {
      rotateLabel.textContent = `기울기 ${slider.value}°`;
    };
    syncLabel();

    let appliedDeg = args.rotationDeg;
    slider.addEventListener('input', syncLabel);
    // 드래그 중 매번 적용하면 미리보기 재파싱이 잦아지므로, 놓는 순간(change)에만 적용한다.
    slider.addEventListener('change', () => {
      const next = Number(slider.value);
      if (next === appliedDeg) return;
      if (args.onRotate(next)) {
        appliedDeg = next;
      } else {
        slider.value = String(appliedDeg);
        syncLabel();
      }
    });

    rotateRow.append(rotateLabel, slider);
    root.appendChild(rotateRow);
  }

  const actions = document.createElement('div');
  actions.className = 'field-popover__stamp-actions';
  const addAction = (label: string, danger: boolean, handler: () => void): void => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `field-popover__stamp-action${danger ? ' field-popover__stamp-action--danger' : ''}`;
    btn.textContent = label;
    btn.addEventListener('click', () => {
      closeFieldPopover();
      handler();
    });
    actions.appendChild(btn);
  };
  addAction(args.hasStamp ? '이미지 교체 (파일 선택)' : '이미지 선택 (파일)', false, args.onPickImage);
  addAction(args.hasStamp ? '도장 다시 만들기 (이름 → 도장)' : '도장 만들기 (이름 → 도장)', false, args.onMakeStamp);
  if (args.hasStamp) addAction('문서에서 삭제', true, args.onClear);
  root.appendChild(actions);

  const buttons = document.createElement('div');
  buttons.className = 'field-popover__buttons';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'field-popover__cancel';
  closeBtn.textContent = '닫기';
  closeBtn.addEventListener('click', () => closeFieldPopover());
  buttons.appendChild(closeBtn);
  root.appendChild(buttons);

  root.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape') {
      e.preventDefault();
      closeFieldPopover();
    }
  });

  document.body.appendChild(root);
  positionNear(root, args.anchor);

  const onOuter = (e: MouseEvent): void => {
    if (!root.contains(e.target as Node)) closeFieldPopover();
  };
  setTimeout(() => document.addEventListener('mousedown', onOuter, { capture: true }), 0);
  currentCleanup = () => document.removeEventListener('mousedown', onOuter, { capture: true } as any);

  setTimeout(() => {
    root.querySelector<HTMLElement>('input, button')?.focus();
  }, 0);

  currentPopover = root;
}

export function closeFieldPopover(): void {
  if (currentCleanup) {
    currentCleanup();
    currentCleanup = null;
  }
  if (currentPopover) {
    currentPopover.remove();
    currentPopover = null;
  }
}

export function isPopoverOpen(): boolean {
  return currentPopover !== null;
}

/** 첨부서류 자주 쓰는 항목 토글 칩 줄 — textarea 값의 쉼표 목록에 추가/제거한다. */
function buildAttachmentPresetRow(textarea: HTMLTextAreaElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'field-popover__recent attachment-presets';
  const heading = document.createElement('span');
  heading.className = 'field-popover__recent-label';
  heading.textContent = '자주 씀';
  wrap.appendChild(heading);

  const chips = ATTACHMENT_PRESETS.map((preset) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'attachment-preset-chip';
    chip.textContent = preset;
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      textarea.value = toggleListItem(textarea.value, preset);
      sync();
      textarea.focus();
    });
    wrap.appendChild(chip);
    return { chip, preset };
  });

  const sync = (): void => {
    for (const { chip, preset } of chips) {
      chip.classList.toggle('is-active', hasListItem(textarea.value, preset));
    }
  };
  textarea.addEventListener('input', sync);
  sync();
  return wrap;
}

function buildRecentChips(
  cfg: WidgetConfig,
  values: string[],
  initial: string,
  onPick: (raw: string) => void,
): HTMLElement | null {
  // 칩으로 노출할 가치가 있는 위젯 타입만 처리한다. select 는 이미 옵션 버튼이 있고,
  // datetime 은 매번 다른 일시라 도움이 적다.
  if (!['text', 'textarea', 'date'].includes(cfg.type)) return null;
  if (values.length === 0) return null;

  const list = values.filter((v) => v && v !== initial);
  if (list.length === 0) return null;

  const wrap = document.createElement('div');
  wrap.className = 'field-popover__recent';
  const heading = document.createElement('span');
  heading.className = 'field-popover__recent-label';
  heading.textContent = '최근';
  wrap.appendChild(heading);

  for (const value of list) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'field-popover__recent-chip';
    chip.dataset.value = value;
    chip.textContent = formatChipLabel(cfg, value);
    chip.title = chip.textContent;
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      onPick(value);
    });
    wrap.appendChild(chip);
  }
  return wrap;
}

function formatChipLabel(cfg: WidgetConfig, raw: string): string {
  if (cfg.type === 'date') return formatDateKR(raw) || raw;
  return raw;
}

function fillInputValue(el: HTMLElement, cfg: WidgetConfig, raw: string): void {
  if (cfg.type === 'date') {
    const dateInput = el.classList.contains('field-popover__date')
      ? el.querySelector<HTMLInputElement>('.field-popover__date-input')
      : el instanceof HTMLInputElement ? el : null;
    if (dateInput) dateInput.value = raw;
    return;
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.value = raw;
    return;
  }
}

function createInput(label: string, cfg: WidgetConfig, initial: string): HTMLElement {
  if (cfg.type === 'select') {
    const root = document.createElement('div');
    root.className = 'field-popover__select';
    root.dataset.value = initial;

    const options = document.createElement('div');
    options.className = 'field-popover__select-options';
    options.setAttribute('role', 'listbox');
    options.setAttribute('aria-label', `${label} 선택`);

    const hasInitialOption = cfg.options.includes(initial);
    for (const opt of cfg.options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'field-popover__select-option';
      button.textContent = opt;
      button.dataset.value = opt;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', hasInitialOption && opt === initial ? 'true' : 'false');
      button.classList.toggle('is-selected', hasInitialOption && opt === initial);
      button.addEventListener('click', () => {
        root.dataset.value = opt;
        const customInput = root.querySelector<HTMLInputElement>('.field-popover__select-custom-input');
        if (customInput) customInput.value = '';
        for (const item of options.querySelectorAll<HTMLButtonElement>('.field-popover__select-option')) {
          const selected = item.dataset.value === opt;
          item.classList.toggle('is-selected', selected);
          item.setAttribute('aria-selected', selected ? 'true' : 'false');
        }
        root.dispatchEvent(new CustomEvent('field-popover-select', { bubbles: true }));
      });
      options.appendChild(button);
    }

    const customLabel = document.createElement('label');
    customLabel.className = 'field-popover__select-custom';
    customLabel.textContent = '직접 입력';

    const customInput = document.createElement('input');
    customInput.type = 'text';
    customInput.className = 'field-popover__select-custom-input';
    customInput.value = hasInitialOption ? '' : initial;
    customInput.placeholder = '교통편 입력';
    customLabel.appendChild(customInput);

    customInput.addEventListener('input', () => {
      root.dataset.value = customInput.value.trim();
      for (const item of options.querySelectorAll<HTMLButtonElement>('.field-popover__select-option')) {
        item.classList.remove('is-selected');
        item.setAttribute('aria-selected', 'false');
      }
    });

    root.append(options, customLabel);
    return root;
  }
  if (cfg.type === 'textarea') {
    const ta = document.createElement('textarea');
    ta.rows = cfg.rows ?? 2;
    ta.value = initial;
    return ta;
  }
  if (cfg.type === 'datetime') {
    return createDateTimePicker(initial, {
      defaultHour: label === '종료일시' ? '18' : '09',
      inline: true,
    });
  }
  if (cfg.type === 'date' && label === '제출날짜') {
    return createSubmitDateInput(initial);
  }
  const inp = document.createElement('input');
  if (cfg.type === 'date') inp.type = 'date';
  else inp.type = 'text';
  inp.value = initial;
  return inp;
}

function createSubmitDateInput(initial: string): HTMLElement {
  const root = document.createElement('div');
  root.className = 'field-popover__date';

  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'field-popover__date-input';
  input.value = initial;

  const todayBtn = document.createElement('button');
  todayBtn.type = 'button';
  todayBtn.className = 'field-popover__today-button';
  todayBtn.textContent = '오늘';
  todayBtn.addEventListener('click', () => {
    input.value = todayDateValue();
    root.dispatchEvent(new CustomEvent('field-popover-commit', { bubbles: true }));
  });

  root.append(input, todayBtn);
  return root;
}

function createRangeTabButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'field-popover__tab';
  btn.setAttribute('role', 'tab');
  return btn;
}

function createRangeTabPane(picker: HTMLElement): HTMLElement {
  const pane = document.createElement('section');
  pane.className = 'field-popover__range-field';
  pane.setAttribute('role', 'tabpanel');
  picker.classList.add('field-popover__range-picker');
  pane.appendChild(picker);
  return pane;
}

/** `YYYY-MM-DD` 에 일수를 더한다 (월/년 경계는 Date 가 처리). */
function addDaysToDateValue(date: string, days: number): string {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return date;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days);
  const pad = (v: number): string => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function getInputValue(el: HTMLElement): string {
  if (el.classList.contains('datetime-picker')) {
    return getDateTimePickerValue(el);
  }
  if (el.classList.contains('field-popover__select')) {
    const custom = el.querySelector<HTMLInputElement>('.field-popover__select-custom-input')?.value.trim();
    if (custom) return custom;
    return el.dataset.value ?? '';
  }
  if (el.classList.contains('field-popover__date')) {
    return el.querySelector<HTMLInputElement>('.field-popover__date-input')?.value ?? '';
  }
  if (el instanceof HTMLSelectElement || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value;
  }
  return '';
}

function focusInput(input: HTMLElement): void {
  if (input.classList.contains('field-popover__date')) {
    input.querySelector<HTMLInputElement>('.field-popover__date-input')?.focus();
    return;
  }
  const target = input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement
    ? input
    : input.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement>('button, input, textarea, select');
  if (!target) return;
  target.focus();
  if (target instanceof HTMLInputElement && target.type === 'text') target.select();
}

function isNextShortcut(e: KeyboardEvent): boolean {
  if (e.key !== 'ArrowRight' || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
  const target = e.target as HTMLElement | null;
  if (target instanceof HTMLTextAreaElement) {
    return isCaretAtEnd(target);
  }
  if (target instanceof HTMLInputElement && ['text', 'search', 'tel', 'url', 'email', 'password'].includes(target.type)) {
    return isCaretAtEnd(target);
  }
  return true;
}

function isCaretAtEnd(input: HTMLInputElement | HTMLTextAreaElement): boolean {
  const start = input.selectionStart;
  const end = input.selectionEnd;
  const length = input.value.length;
  return (start === length && end === length) || (start === 0 && end === length);
}

function positionNear(el: HTMLElement, anchor: { x: number; y: number }): void {
  const padding = 8;
  el.style.position = 'fixed';
  el.style.visibility = 'hidden';
  // 사이즈를 알기 위해 일단 배치
  const box = el.getBoundingClientRect();
  const viewW = window.innerWidth;
  const viewH = window.innerHeight;

  let left = anchor.x;
  let top = anchor.y + 12; // 클릭한 점 약간 아래
  if (left + box.width > viewW - padding) left = viewW - box.width - padding;
  if (left < padding) left = padding;
  if (top + box.height > viewH - padding) {
    // 아래 공간 부족 → 위로
    top = anchor.y - box.height - 12;
    if (top < padding) top = padding;
  }
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.visibility = '';
}

function todayDateValue(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
