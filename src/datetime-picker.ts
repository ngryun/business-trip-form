import {
  composeDateTimeLocalValue,
  DATETIME_HOUR_OPTIONS,
  DATETIME_MINUTE_OPTIONS,
  formatDateTimeKR,
  splitDateTimeLocal,
} from './field-config';

export interface DateTimePickerController {
  getDate: () => string;
  getValue: () => string;
  setValue: (value: string) => void;
  syncHidden: () => void;
}

interface DateTimePickerOptions {
  defaultHour?: string;
  defaultMinute?: string;
  inline?: boolean;
  onChange?: (value: string) => void;
  placeholder?: string;
}

interface PickerState {
  date: string;
  hour: string;
  minute: string;
  viewYear: number;
  viewMonth: number;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function setupDateTimePicker(root: HTMLElement, options: DateTimePickerOptions = {}): DateTimePickerController | null {
  const hidden = root.querySelector<HTMLInputElement>('input[type="hidden"]');
  if (!hidden) return null;
  const hiddenInput = hidden;

  root.classList.add('datetime-picker');
  if (options.inline) root.classList.add('datetime-picker--inline');

  const state = createState(hiddenInput.value);
  const defaultHour = options.defaultHour ?? '09';
  const defaultMinute = options.defaultMinute ?? '00';
  const trigger = options.inline ? null : createTrigger(options.placeholder ?? '일시 선택');
  const panel = createPanel();
  let isOpen = Boolean(options.inline);

  root.append(panel);
  if (trigger) root.insertBefore(trigger, panel);

  function emit(): void {
    const value = syncHidden();
    options.onChange?.(value);
  }

  function syncHidden(): string {
    hiddenInput.value = composeDateTimeLocalValue(state.date, state.hour, state.minute);
    updateTrigger(trigger, hiddenInput.value, options.placeholder ?? '일시 선택');
    return hiddenInput.value;
  }

  function setValue(value: string): void {
    const parsed = splitDateTimeLocal(value);
    state.date = parsed.date;
    state.hour = parsed.hour;
    state.minute = parsed.minute;
    const viewDate = parseLocalDate(state.date) ?? new Date();
    state.viewYear = viewDate.getFullYear();
    state.viewMonth = viewDate.getMonth();
    render();
    syncHidden();
  }

  function open(): void {
    isOpen = true;
    root.classList.add('is-open');
    panel.hidden = false;
    render();
  }

  function close(): void {
    if (options.inline) return;
    isOpen = false;
    root.classList.remove('is-open');
    panel.hidden = true;
  }

  function render(): void {
    renderCalendar(panel, state, (date) => {
      state.date = date;
      if (!state.hour) state.hour = defaultHour;
      if (!state.minute) state.minute = defaultMinute;
      render();
      emit();
    });
    renderTimeButtons(panel, state, (part, value) => {
      if (part === 'hour') state.hour = value;
      else state.minute = value;
      render();
      emit();
      if (!options.inline && part === 'minute' && state.date && state.hour && state.minute) close();
    });
  }

  trigger?.addEventListener('click', () => {
    if (isOpen) close();
    else open();
  });

  panel.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    const action = target?.closest<HTMLElement>('[data-datetime-action]');
    if (!action) return;
    const actionName = action.dataset.datetimeAction;
    if (actionName === 'prev-month') {
      moveMonth(state, -1);
      render();
    } else if (actionName === 'next-month') {
      moveMonth(state, 1);
      render();
    }
  });

  document.addEventListener('click', (e) => {
    if (!isOpen || options.inline || root.contains(e.target as Node)) return;
    close();
  });

  render();
  syncHidden();
  close();
  if (options.inline) open();

  return {
    getDate: () => state.date,
    getValue: () => hiddenInput.value,
    setValue,
    syncHidden,
  };
}

export function createDateTimePicker(value: string, options: DateTimePickerOptions = {}): HTMLElement {
  const root = document.createElement('div');
  root.className = 'datetime-picker';
  const hidden = document.createElement('input');
  hidden.type = 'hidden';
  hidden.value = value;
  root.appendChild(hidden);
  setupDateTimePicker(root, options);
  return root;
}

export function getDateTimePickerValue(root: HTMLElement): string {
  return root.querySelector<HTMLInputElement>('input[type="hidden"]')?.value ?? '';
}

function createState(value: string): PickerState {
  const parsed = splitDateTimeLocal(value);
  const viewDate = parseLocalDate(parsed.date) ?? new Date();
  return {
    date: parsed.date,
    hour: parsed.hour,
    minute: parsed.minute,
    viewYear: viewDate.getFullYear(),
    viewMonth: viewDate.getMonth(),
  };
}

function createTrigger(placeholder: string): HTMLButtonElement {
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'datetime-picker__trigger';
  trigger.setAttribute('aria-haspopup', 'dialog');
  const display = document.createElement('span');
  display.className = 'datetime-picker__display';
  display.dataset.datetimeDisplay = '';
  display.textContent = placeholder;
  const icon = document.createElement('span');
  icon.className = 'datetime-picker__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '▦';
  trigger.append(display, icon);
  return trigger;
}

function createPanel(): HTMLDivElement {
  const panel = document.createElement('div');
  panel.className = 'datetime-picker__panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  return panel;
}

function renderCalendar(panel: HTMLElement, state: PickerState, onSelect: (date: string) => void): void {
  let calendar = panel.querySelector<HTMLElement>('[data-datetime-calendar]');
  if (!calendar) {
    calendar = document.createElement('div');
    calendar.className = 'datetime-calendar';
    calendar.dataset.datetimeCalendar = '';
    panel.appendChild(calendar);
  }

  const days = getCalendarDays(state.viewYear, state.viewMonth);
  calendar.replaceChildren();

  const header = document.createElement('div');
  header.className = 'datetime-calendar__header';
  header.append(
    iconButton('‹', '이전 달', 'prev-month'),
    monthLabel(state.viewYear, state.viewMonth),
    iconButton('›', '다음 달', 'next-month'),
  );
  calendar.appendChild(header);

  const weekRow = document.createElement('div');
  weekRow.className = 'datetime-calendar__weekdays';
  for (const day of WEEKDAYS) {
    const el = document.createElement('span');
    el.textContent = day;
    weekRow.appendChild(el);
  }
  calendar.appendChild(weekRow);

  const grid = document.createElement('div');
  grid.className = 'datetime-calendar__grid';
  for (const day of days) {
    if (!day) {
      grid.appendChild(document.createElement('span'));
      continue;
    }
    const dateValue = toDateValue(state.viewYear, state.viewMonth, day);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'datetime-calendar__day';
    btn.textContent = String(day);
    btn.setAttribute('aria-label', dateValue);
    btn.classList.toggle('is-selected', state.date === dateValue);
    btn.classList.toggle('is-today', dateValue === todayValue());
    btn.addEventListener('click', () => onSelect(dateValue));
    grid.appendChild(btn);
  }
  calendar.appendChild(grid);
}

function renderTimeButtons(panel: HTMLElement, state: PickerState, onSelect: (part: 'hour' | 'minute', value: string) => void): void {
  let time = panel.querySelector<HTMLElement>('[data-datetime-time]');
  if (!time) {
    time = document.createElement('div');
    time.className = 'datetime-time';
    time.dataset.datetimeTime = '';
    panel.appendChild(time);
  }
  time.replaceChildren(
    buttonGroup('시간', DATETIME_HOUR_OPTIONS, state.hour, (value) => onSelect('hour', value)),
    buttonGroup('분', DATETIME_MINUTE_OPTIONS, state.minute, (value) => onSelect('minute', value)),
  );
}

function buttonGroup(title: string, values: string[], selected: string, onClick: (value: string) => void): HTMLElement {
  const group = document.createElement('section');
  group.className = 'datetime-time__group';
  const heading = document.createElement('div');
  heading.className = 'datetime-time__title';
  heading.textContent = title;
  const buttons = document.createElement('div');
  buttons.className = 'datetime-time__buttons';
  for (const value of values) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = value;
    btn.className = 'datetime-time__button';
    btn.classList.toggle('is-selected', value === selected);
    btn.addEventListener('click', () => onClick(value));
    buttons.appendChild(btn);
  }
  group.append(heading, buttons);
  return group;
}

function iconButton(label: string, ariaLabel: string, action: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'datetime-calendar__nav';
  btn.textContent = label;
  btn.setAttribute('aria-label', ariaLabel);
  btn.dataset.datetimeAction = action;
  return btn;
}

function monthLabel(year: number, month: number): HTMLElement {
  const label = document.createElement('div');
  label.className = 'datetime-calendar__month';
  label.textContent = `${year}. ${pad2(month + 1)}`;
  return label;
}

function updateTrigger(trigger: HTMLButtonElement | null, value: string, placeholder: string): void {
  if (!trigger) return;
  const display = trigger.querySelector<HTMLElement>('[data-datetime-display]');
  if (!display) return;
  display.textContent = value ? formatDateTimeKR(value) : placeholder;
  trigger.classList.toggle('has-value', Boolean(value));
}

function getCalendarDays(year: number, month: number): Array<number | null> {
  const first = new Date(year, month, 1).getDay();
  const total = new Date(year, month + 1, 0).getDate();
  return [
    ...Array.from({ length: first }, () => null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ];
}

function moveMonth(state: PickerState, amount: number): void {
  const date = new Date(state.viewYear, state.viewMonth + amount, 1);
  state.viewYear = date.getFullYear();
  state.viewMonth = date.getMonth();
}

function parseLocalDate(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function toDateValue(year: number, month: number, day: number): string {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

function todayValue(): string {
  const today = new Date();
  return toDateValue(today.getFullYear(), today.getMonth(), today.getDate());
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
