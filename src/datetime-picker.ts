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
    renderTimeWheel(panel, state, { hour: defaultHour, minute: defaultMinute }, (part, value) => {
      if (part === 'hour') {
        if (state.hour === value) return;
        state.hour = value;
      } else {
        if (state.minute === value) return;
        state.minute = value;
      }
      render();
      emit();
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

const WHEEL_SCROLL_DEBOUNCE_MS = 110;

/**
 * 시/분을 iOS 스타일 스크롤 휠로 그린다. 버튼을 매 render 마다 다시 만들면 스크롤 위치가
 * 초기화되므로, 휠 DOM 은 최초 1회만 만들고 이후에는 선택값에 맞춰 스크롤 위치만 동기화한다.
 */
function renderTimeWheel(
  panel: HTMLElement,
  state: PickerState,
  defaults: { hour: string; minute: string },
  onSelect: (part: 'hour' | 'minute', value: string) => void,
): void {
  let time = panel.querySelector<HTMLElement>('[data-datetime-time]');
  if (!time) {
    time = document.createElement('div');
    time.className = 'datetime-time';
    time.dataset.datetimeTime = '';

    const title = document.createElement('div');
    title.className = 'datetime-time__title';
    title.textContent = '시간';

    const wheel = document.createElement('div');
    wheel.className = 'datetime-wheel';

    const colon = document.createElement('span');
    colon.className = 'datetime-wheel__colon';
    colon.textContent = ':';
    colon.setAttribute('aria-hidden', 'true');

    const band = document.createElement('div');
    band.className = 'datetime-wheel__band';
    band.setAttribute('aria-hidden', 'true');

    wheel.append(
      buildWheelColumn('hour', '시', DATETIME_HOUR_OPTIONS),
      colon,
      buildWheelColumn('minute', '분', DATETIME_MINUTE_OPTIONS),
      band,
    );
    time.append(title, wheel);
    panel.appendChild(time);
  }

  syncWheel(time.querySelector<HTMLElement>('[data-wheel="hour"]'), state.hour || defaults.hour, (value) =>
    onSelect('hour', value),
  );
  syncWheel(time.querySelector<HTMLElement>('[data-wheel="minute"]'), state.minute || defaults.minute, (value) =>
    onSelect('minute', value),
  );
}

interface WheelList extends HTMLElement {
  __onPick?: (value: string) => void;
  __suppressScroll?: boolean;
}

function buildWheelColumn(part: 'hour' | 'minute', unitLabel: string, values: string[]): HTMLElement {
  const list = document.createElement('div') as WheelList;
  list.className = 'datetime-wheel__list';
  list.dataset.wheel = part;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', `${unitLabel} 선택`);

  for (const value of values) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'datetime-wheel__item';
    item.dataset.value = value;
    item.textContent = value;
    item.setAttribute('role', 'option');
    list.appendChild(item);
  }

  let debounce: number | undefined;
  list.addEventListener('scroll', () => {
    if (list.__suppressScroll) return;
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => {
      const itemHeight = list.firstElementChild ? (list.firstElementChild as HTMLElement).offsetHeight : 0;
      if (!itemHeight) return;
      const index = Math.max(0, Math.min(values.length - 1, Math.round(list.scrollTop / itemHeight)));
      list.__onPick?.(values[index]);
    }, WHEEL_SCROLL_DEBOUNCE_MS);
  });
  list.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('[data-value]');
    if (item?.dataset.value) list.__onPick?.(item.dataset.value);
  });

  return list;
}

function syncWheel(list: WheelList | null, value: string, onPick: (value: string) => void): void {
  if (!list) return;
  list.__onPick = onPick;
  const items = Array.from(list.children) as HTMLElement[];
  const index = Math.max(0, items.findIndex((item) => item.dataset.value === value));
  items.forEach((item, i) => item.classList.toggle('is-selected', i === index));

  const itemHeight = items[0]?.offsetHeight ?? 0;
  if (!itemHeight) return; // 패널이 아직 숨겨져 layout 이 없으면 (offsetHeight 0) 열릴 때 다시 동기화된다.
  const target = index * itemHeight;
  if (Math.abs(list.scrollTop - target) > 1) {
    // 프로그램적 스크롤이 scroll 이벤트를 다시 발생시켜 onPick 이 도는 것을 막는다.
    list.__suppressScroll = true;
    list.scrollTop = target;
    window.setTimeout(() => {
      list.__suppressScroll = false;
    }, 80);
  }
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
