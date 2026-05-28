/**
 * 미리보기 위에서 누름틀을 클릭했을 때 떠오르는 입력 팝오버.
 *
 * - 라벨에 맞는 위젯(text/date/select/textarea/일시 선택기) 렌더링
 * - Enter 확정 / Esc 취소 / 외부 클릭 취소 / 자동 포커스
 * - 화면 가장자리에서 잘리지 않도록 위치 보정
 */

import {
  createDateTimePicker,
  getDateTimePickerValue,
} from './datetime-picker';
import {
  FIELD_CONFIGS,
  type WidgetConfig,
} from './field-config';

export interface PopoverArgs {
  label: string;
  initialValue: string;
  /** 클라이언트 좌표계 기준 누름틀 근처 위치 (보통 클릭한 점) */
  anchor: { x: number; y: number };
  onConfirm: (value: string) => void;
  onCancel: () => void;
  onNext?: (value: string) => void;
}

export interface DateTimeRangePopoverArgs {
  anchor: { x: number; y: number };
  endValue: string;
  onCancel: () => void;
  onConfirm: (startValue: string, endValue: string) => void;
  onNext?: (startValue: string, endValue: string) => void;
  startValue: string;
}

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
    if (ke.key === 'Enter' && !(input instanceof HTMLTextAreaElement)) {
      ke.preventDefault();
      finish('confirm');
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

  const range = document.createElement('div');
  range.className = 'field-popover__range';
  const startPicker = createRangeDateTimeField('시작 일시', args.startValue, '09');
  const endPicker = createRangeDateTimeField('종료 일시', args.endValue, '18');
  range.append(startPicker.root, endPicker.root);
  root.appendChild(range);

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

    const startValue = getDateTimePickerValue(startPicker.picker);
    const endValue = getDateTimePickerValue(endPicker.picker);
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
    if (args.onNext && isNextShortcut(ke)) {
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

  setTimeout(() => focusInput(startPicker.picker), 0);
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

function createRangeDateTimeField(label: string, initial: string, defaultHour: string): { root: HTMLElement; picker: HTMLElement } {
  const root = document.createElement('section');
  root.className = 'field-popover__range-field';

  const heading = document.createElement('div');
  heading.className = 'field-popover__range-label';
  heading.textContent = label;

  const picker = createDateTimePicker(initial, { defaultHour, inline: true });
  picker.classList.add('field-popover__range-picker');
  root.append(heading, picker);
  return { root, picker };
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
