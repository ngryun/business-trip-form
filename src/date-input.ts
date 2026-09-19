import { todayDateValue } from './date-range';
import { attachInputPanel } from './input-panel';

export interface DateInputHandle {
  root: HTMLElement;
  getValue: () => string;
  setValue: (value: string) => void;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const CALENDAR_ICON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>';

/**
 * 연 → 월 → 일 순서로 타이핑하거나 달력 버튼으로 고르는 날짜 입력.
 * - 연도 칸은 올해를 안내문으로 보여 주고, 비워 두고 월·일만 적으면 올해로 본다.
 * - 달력은 늘 오늘이 있는 달을 먼저 펼치고 오늘을 표시한다. 다른 달의 날짜를 이미 골랐으면 그 달로 가는 버튼을 함께 보여 준다.
 * 값이 바뀌면 root 에 `change` 를 올린다(detail.source 가 'panel' 이면 달력에서 고른 것).
 */
export function createDateInput(): DateInputHandle {
  const root = document.createElement('span');
  root.className = 'date-input';
  root.setAttribute('role', 'group');
  const fields = [
    { label: '연도', placeholder: String(new Date().getFullYear()), length: 4 },
    { label: '월', placeholder: 'MM', length: 2 },
    { label: '일', placeholder: 'DD', length: 2 },
  ].map(({ label, placeholder, length }) => {
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.maxLength = length;
    input.placeholder = placeholder;
    input.setAttribute('aria-label', label);
    input.className = `date-input__part date-input__part--${length === 4 ? 'year' : 'short'}`;
    return input;
  });
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'date-input__button';
  button.innerHTML = CALENDAR_ICON;
  button.setAttribute('aria-label', '달력 열기');
  const panel = document.createElement('div');
  panel.className = 'date-input__panel datetime-calendar';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '달력');
  let view = { year: 0, month: 0 };

  function getValue(): string {
    const [year, month, day] = fields.map(input => input.value);
    const resolvedYear = year || String(new Date().getFullYear());
    if (resolvedYear.length !== 4 || !month || !day) return '';
    const value = `${resolvedYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number(resolvedYear) > 0 && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : '';
  }
  function setValue(value: string): void {
    const parts = value.split('-');
    fields.forEach((input, i) => { if (input.value !== (parts[i] ?? '')) input.value = parts[i] ?? ''; });
  }
  function changed(source: 'typing' | 'panel' = 'typing'): void {
    root.dispatchEvent(new CustomEvent('change', { bubbles: true, detail: { source } }));
  }
  fields.forEach((input, i) => {
    input.addEventListener('focus', () => input.select());
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, input.maxLength);
      // 다음 구간을 먼저 선택해야 blur 시 값 보정이 현재 편집을 건드리지 않는다.
      if (input.value.length === input.maxLength && i < 2) fields[i + 1].focus();
      changed();
    });
    input.addEventListener('keydown', (event) => {
      if ((event.key === '-' || event.key === '/' || event.key === '.') && i < 2) {
        event.preventDefault();
        fields[i + 1].focus();
      } else if (event.key === 'Backspace' && !input.value && i > 0) {
        event.preventDefault();
        fields[i - 1].focus();
      }
    });
    input.addEventListener('paste', (event) => {
      const text = event.clipboardData?.getData('text').trim() ?? '';
      const match = text.match(/^(\d{4})[-./]?(\d{2})[-./]?(\d{2})$/);
      if (!match) return;
      event.preventDefault();
      setValue(match.slice(1).join('-'));
      fields[2].focus();
      changed();
    });
    if (i) {
      const separator = document.createElement('span');
      separator.textContent = '.';
      separator.setAttribute('aria-hidden', 'true');
      root.append(separator);
    }
    root.append(input);
  });

  const handle = attachInputPanel(panel, {
    button,
    anchor: root,
    onOpen: () => {
      const now = new Date();
      view = { year: now.getFullYear(), month: now.getMonth() };
      renderCalendar();
    },
  });
  function pick(value: string): void {
    setValue(value);
    changed('panel');
    handle.close();
  }
  function renderCalendar(): void {
    const selected = getValue();
    const today = todayDateValue();
    const header = element('div', 'datetime-calendar__header');
    const title = element('div', 'datetime-calendar__month');
    title.textContent = `${view.year}년 ${view.month + 1}월`;
    title.setAttribute('aria-live', 'polite');
    header.append(navButton('‹', '이전 달', -1), title, navButton('›', '다음 달', 1));
    const weekdays = element('div', 'datetime-calendar__weekdays');
    WEEKDAYS.forEach((name, i) => {
      const cell = element('span', i === 0 ? 'is-sun' : i === 6 ? 'is-sat' : '');
      cell.textContent = name;
      weekdays.append(cell);
    });
    const grid = element('div', 'datetime-calendar__grid');
    const firstWeekday = localDate(view.year, view.month, 1).getDay();
    const total = localDate(view.year, view.month + 1, 0).getDate();
    for (let i = 0; i < firstWeekday; i++) grid.append(element('span'));
    for (let day = 1; day <= total; day++) {
      const value = `${String(view.year).padStart(4, '0')}-${pad2(view.month + 1)}-${pad2(day)}`;
      const weekday = (firstWeekday + day - 1) % 7;
      const cell = element('button', 'datetime-calendar__day') as HTMLButtonElement;
      cell.type = 'button';
      cell.textContent = String(day);
      cell.dataset.value = value;
      cell.setAttribute('aria-label', `${view.month + 1}월 ${day}일 (${WEEKDAYS[weekday]})`);
      cell.setAttribute('aria-pressed', String(value === selected));
      if (weekday === 0) cell.classList.add('is-sun');
      if (weekday === 6) cell.classList.add('is-sat');
      if (value === today) cell.classList.add('is-today');
      if (value === selected) cell.classList.add('is-selected');
      cell.addEventListener('click', () => pick(value));
      grid.append(cell);
    }
    const footer = element('div', 'datetime-calendar__footer');
    const todayButton = element('button', 'datetime-calendar__today-btn') as HTMLButtonElement;
    todayButton.type = 'button';
    todayButton.textContent = `오늘 ${Number(today.slice(5, 7))}.${Number(today.slice(8, 10))}`;
    todayButton.addEventListener('click', () => pick(today));
    footer.append(todayButton);
    // 이미 고른 날짜가 보이는 달 밖에 있으면 그 달로 가는 버튼을 곁에 둔다 (값은 바꾸지 않는다).
    const selectedDate = parseLocalDate(selected);
    if (selectedDate && (selectedDate.getFullYear() !== view.year || selectedDate.getMonth() !== view.month)) {
      const jumpButton = element('button', 'datetime-calendar__jump-btn') as HTMLButtonElement;
      jumpButton.type = 'button';
      jumpButton.textContent = `${selectedDate.getMonth() + 1}.${selectedDate.getDate()}(${WEEKDAYS[selectedDate.getDay()]})로 이동`;
      jumpButton.setAttribute('aria-label', `고른 날짜 ${selected} 가 있는 달 보기`);
      jumpButton.addEventListener('click', () => {
        view = { year: selectedDate.getFullYear(), month: selectedDate.getMonth() };
        renderCalendar();
      });
      footer.append(jumpButton);
    }
    panel.replaceChildren(header, weekdays, grid, footer);
  }
  function navButton(symbol: string, label: string, delta: number): HTMLButtonElement {
    const nav = element('button', 'datetime-calendar__nav') as HTMLButtonElement;
    nav.type = 'button';
    nav.textContent = symbol;
    nav.setAttribute('aria-label', label);
    nav.addEventListener('click', () => {
      const moved = localDate(view.year, view.month + delta, 1);
      view = { year: moved.getFullYear(), month: moved.getMonth() };
      renderCalendar();
    });
    return nav;
  }
  root.append(button, panel);
  return { root, getValue, setValue };
}

function element(tag: string, className = ''): HTMLElement {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}
/** 100년 미만 연도가 1900년대로 해석되지 않도록 setFullYear 로 만든다. */
function localDate(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setFullYear(year, month, day);
  date.setHours(0, 0, 0, 0);
  return date;
}
function parseLocalDate(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? localDate(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
