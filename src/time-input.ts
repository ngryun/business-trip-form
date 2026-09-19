import { DATETIME_MINUTE_OPTIONS, DATETIME_MINUTE_STEP } from './field-config';
import { attachInputPanel } from './input-panel';

export interface TimeInputHandle {
  root: HTMLElement;
  /** `HH:MM`. 시만 있으면 분은 00 으로, 시가 없거나 범위를 벗어나면 빈 문자열. */
  getValue: () => string;
  setValue: (value: string) => void;
}
interface TimeInputOptions {
  /** 판에서 분만 골랐을 때 채울 시 */
  defaultHour?: string;
}

const CLOCK_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const HOURS = Array.from({ length: 24 }, (_, i) => pad2(i));

/**
 * 시 → 분 순서로 타이핑하거나 시계 버튼으로 고르는 시간 입력.
 * 출장 시간은 대개 정시라서, 판에서 시를 누르면 분은 00 으로 바로 정해지고 분(10분 단위)은 필요할 때만 고른다.
 * 값이 바뀌면 root 에 `change` 를 올린다(detail.source 가 'panel' 이면 판에서 고른 것).
 */
export function createTimeInput(options: TimeInputOptions = {}): TimeInputHandle {
  const root = document.createElement('span');
  root.className = 'time-input';
  root.setAttribute('role', 'group');
  const hour = createPart('시', '시');
  const minute = createPart('분', '분');
  const separator = document.createElement('span');
  separator.textContent = ':';
  separator.setAttribute('aria-hidden', 'true');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'time-input__button';
  button.innerHTML = CLOCK_ICON;
  button.setAttribute('aria-label', '시간 선택 열기');
  const panel = document.createElement('div');
  panel.className = 'time-input__panel time-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '시간 선택');

  function getValue(): string {
    if (!hour.value) return '';
    const hours = Number(hour.value);
    const minutes = minute.value ? Number(minute.value) : 0;
    if (hours > 23 || minutes > 59) return '';
    return `${pad2(hours)}:${pad2(minutes)}`;
  }
  function setValue(value: string): void {
    const match = value.match(/^(\d{2}):(\d{2})$/);
    const [nextHour, nextMinute] = match ? [match[1], match[2]] : ['', ''];
    if (hour.value !== nextHour) hour.value = nextHour;
    if (minute.value !== nextMinute) minute.value = nextMinute;
    syncPanel();
  }
  function changed(source: 'typing' | 'panel' = 'typing'): void {
    syncPanel();
    root.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: { source } }));
  }

  hour.addEventListener('input', () => {
    hour.value = hour.value.replace(/\D/g, '').slice(0, 2);
    // 두 자리 시는 23까지라 첫 자리가 3 이상이면 한 자리 시(03~09)로 본다.
    if (hour.value.length === 1 && Number(hour.value) > 2) hour.value = `0${hour.value}`;
    if (Number(hour.value) > 23) hour.value = hour.value[0];
    if (hour.value.length === 2) minute.focus();
    changed();
  });
  minute.addEventListener('input', () => {
    minute.value = minute.value.replace(/\D/g, '').slice(0, 2);
    if (Number(minute.value) > 59) minute.value = minute.value[0];
    changed();
  });
  hour.addEventListener('keydown', (event) => {
    if (event.key === ':' || event.key === '.') {
      event.preventDefault();
      minute.focus();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const current = hour.value ? Number(hour.value) : Number(options.defaultHour ?? '09');
      hour.value = pad2((current + (event.key === 'ArrowUp' ? 1 : 23)) % 24);
      if (!minute.value) minute.value = '00';
      hour.select();
      changed();
    }
  });
  minute.addEventListener('keydown', (event) => {
    if (event.key === 'Backspace' && !minute.value) {
      event.preventDefault();
      hour.focus();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const snapped = Math.round(Number(minute.value || 0) / DATETIME_MINUTE_STEP) * DATETIME_MINUTE_STEP;
      minute.value = pad2((snapped + (event.key === 'ArrowUp' ? DATETIME_MINUTE_STEP : 60 - DATETIME_MINUTE_STEP)) % 60);
      if (!hour.value) hour.value = options.defaultHour ?? '09';
      minute.select();
      changed();
    }
  });
  for (const input of [hour, minute]) {
    input.addEventListener('focus', () => input.select());
    input.addEventListener('paste', (event) => {
      const text = event.clipboardData?.getData('text').trim() ?? '';
      const match = text.match(/^(\d{1,2}):?(\d{2})$/);
      if (!match) return;
      event.preventDefault();
      setValue(`${pad2(Number(match[1]))}:${match[2]}`);
      minute.focus();
      changed();
    });
  }

  // 판: 오전·오후 두 묶음의 시 + 10분 단위 분
  const hourButtons: HTMLButtonElement[] = [];
  const minuteButtons: HTMLButtonElement[] = [];
  const hoursGrid = document.createElement('div');
  hoursGrid.className = 'time-panel__grid';
  for (const [label, hours] of [['오전', HOURS.slice(0, 12)], ['오후', HOURS.slice(12)]] as const) {
    hoursGrid.append(panelLabel(label));
    for (const value of hours) {
      const option = panelOption(value, `${label} ${Number(value) % 12 || 12}시`, () => {
        hour.value = value;
        if (!minute.value) minute.value = '00';
        changed('panel');
      });
      hourButtons.push(option);
      hoursGrid.append(option);
    }
  }
  const minutesGrid = document.createElement('div');
  minutesGrid.className = 'time-panel__grid time-panel__grid--minutes';
  minutesGrid.append(panelLabel('분'));
  for (const value of DATETIME_MINUTE_OPTIONS) {
    const option = panelOption(value, `${Number(value)}분`, () => {
      if (!hour.value) hour.value = options.defaultHour ?? '09';
      minute.value = value;
      changed('panel');
      handle.close();
    });
    minuteButtons.push(option);
    minutesGrid.append(option);
  }
  panel.append(hoursGrid, minutesGrid);
  function syncPanel(): void {
    const [selectedHour = '', selectedMinute = ''] = getValue().split(':');
    for (const option of hourButtons) option.setAttribute('aria-pressed', String(option.dataset.value === selectedHour));
    for (const option of minuteButtons) option.setAttribute('aria-pressed', String(option.dataset.value === selectedMinute));
  }
  const handle = attachInputPanel(panel, { button, anchor: root, onOpen: syncPanel });

  root.append(hour, separator, minute, button, panel);
  syncPanel();
  return { root, getValue, setValue };
}

function createPart(label: string, placeholder: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.maxLength = 2;
  input.placeholder = placeholder;
  input.setAttribute('aria-label', label);
  input.className = 'time-input__part';
  return input;
}
function panelLabel(text: string): HTMLElement {
  const label = document.createElement('span');
  label.className = 'time-panel__label';
  label.textContent = text;
  return label;
}
function panelOption(value: string, label: string, onPick: () => void): HTMLButtonElement {
  const option = document.createElement('button');
  option.type = 'button';
  option.className = 'time-panel__option';
  option.textContent = value;
  option.dataset.value = value;
  option.setAttribute('aria-label', label);
  option.setAttribute('aria-pressed', 'false');
  option.addEventListener('click', onPick);
  return option;
}
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
