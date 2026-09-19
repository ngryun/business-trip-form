import { composeDateTimeLocalValue, splitDateTimeLocal } from './field-config';
import { createDateInput } from './date-input';
import { createTimeInput } from './time-input';

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
const pickerControllers = new WeakMap<HTMLElement, DateTimePickerController>();
export function getDateTimePickerController(root: HTMLElement): DateTimePickerController | null {
  return pickerControllers.get(root) ?? null;
}

/** 날짜와 시간을 직접 입력하거나 달력·시간 판에서 고른다. DOM을 다시 만들지 않아 포커스를 유지한다. */
export function setupDateTimePicker(root: HTMLElement, options: DateTimePickerOptions = {}): DateTimePickerController | null {
  const hidden = root.querySelector<HTMLInputElement>('input[type="hidden"]');
  if (!hidden) return null;
  const defaultHour = options.defaultHour ?? '09';
  const defaultMinute = options.defaultMinute ?? '00';
  root.classList.add('datetime-picker', 'datetime-picker--compact');
  const row = document.createElement('div');
  row.className = 'datetime-picker__inputs';
  const date = createDateInput();
  const time = createTimeInput({ defaultHour });
  row.append(group('날짜', date.root), group('시간', time.root));
  root.append(row);

  let lastEmitted = '';
  function syncHidden(): string {
    const [hour = '', minute = ''] = time.getValue().split(':');
    hidden!.value = composeDateTimeLocalValue(date.getValue(), hour, minute);
    return hidden!.value;
  }
  function show(value: string): void {
    const parts = splitDateTimeLocal(value);
    date.setValue(parts.date);
    time.setValue(parts.hour && parts.minute ? `${parts.hour}:${parts.minute}` : '');
  }
  function setValue(value: string): void {
    show(value);
    lastEmitted = syncHidden();
  }
  function commit(): void {
    if (date.getValue() && !time.getValue()) time.setValue(`${defaultHour}:${defaultMinute}`);
    const value = syncHidden();
    // 실제 반영되는 10분 단위 값을 입력창에도 표시한다.
    if (value) show(value);
    // Enter 뒤 blur 처럼 같은 값을 거듭 확정해도 한 번만 알린다.
    if (value === lastEmitted) return;
    lastEmitted = value;
    options.onChange?.(value);
  }
  for (const part of [date, time]) {
    part.root.addEventListener('change', (event) => {
      // 타이핑 중간 값(연도 두 자리 등)으로 종료일을 이동시키지 않도록 칸을 벗어난 뒤 반영하고, 판에서 고른 값은 바로 반영한다.
      const fromPanel = (event as CustomEvent<{ source?: string }>).detail?.source === 'panel';
      const active = document.activeElement as HTMLInputElement | null;
      if (fromPanel || !part.root.contains(active) || active?.type !== 'text') commit();
    });
    part.root.addEventListener('focusout', (event) => {
      if (!part.root.contains(event.relatedTarget as Node | null)) commit();
    });
    part.root.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') commit();
    });
  }
  setValue(hidden.value);
  const controller: DateTimePickerController = { getDate: date.getValue, getValue: () => hidden.value, setValue, syncHidden };
  pickerControllers.set(root, controller);
  return controller;
}
function group(caption: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'datetime-picker__group';
  const label = document.createElement('span');
  label.className = 'datetime-picker__caption';
  label.textContent = caption;
  wrap.append(label, control);
  return wrap;
}
export function createDateTimePicker(value: string, options: DateTimePickerOptions = {}): HTMLElement {
  const root = document.createElement('div');
  const hidden = document.createElement('input');
  hidden.type = 'hidden';
  hidden.value = value;
  root.append(hidden);
  setupDateTimePicker(root, options);
  return root;
}
export function getDateTimePickerValue(root: HTMLElement): string {
  return root.querySelector<HTMLInputElement>('input[type="hidden"]')?.value ?? '';
}
