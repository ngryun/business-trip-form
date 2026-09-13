import { composeDateTimeLocalValue, DATETIME_STEP_SECONDS, splitDateTimeLocal } from './field-config';
import { createDateInput } from './date-input';

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

/** 날짜와 시간을 직접 입력하거나 기기의 기본 선택기로 고른다. DOM을 다시 만들지 않아 포커스를 유지한다. */
export function setupDateTimePicker(root: HTMLElement, options: DateTimePickerOptions = {}): DateTimePickerController | null {
  const hidden = root.querySelector<HTMLInputElement>('input[type="hidden"]');
  if (!hidden) return null;
  root.classList.add('datetime-picker', 'datetime-picker--compact');
  const row = document.createElement('div');
  row.className = 'datetime-picker__inputs';
  const dateLabel = document.createElement('div');
  dateLabel.className = 'datetime-picker__date-group';
  const caption = document.createElement('span');
  caption.textContent = '날짜';
  const date = createDateInput();
  dateLabel.append(caption, date.root);
  const timeLabel = document.createElement('label');
  timeLabel.textContent = '시간';
  const time = document.createElement('input');
  time.type = 'time';
  time.step = String(DATETIME_STEP_SECONDS);
  time.className = 'datetime-picker__time';
  timeLabel.append(time);
  row.append(dateLabel, timeLabel);
  root.append(row);

  function syncHidden(): string {
    const [hour = '', minute = ''] = time.value.split(':');
    hidden!.value = composeDateTimeLocalValue(date.getValue(), hour, minute);
    return hidden!.value;
  }
  function setValue(value: string): void {
    const parts = splitDateTimeLocal(value);
    date.setValue(parts.date);
    const timeValue = parts.hour && parts.minute ? `${parts.hour}:${parts.minute}` : '';
    if (time.value !== timeValue) time.value = timeValue;
    syncHidden();
  }
  function commit(): void {
    if (date.getValue() && !time.value) time.value = `${options.defaultHour ?? '09'}:${options.defaultMinute ?? '00'}`;
    const value = syncHidden();
    // 실제 반영되는 10분 단위 값을 입력창에도 표시한다.
    if (value) setValue(value);
    options.onChange?.(value);
  }
  date.root.addEventListener('change', () => {
    // 연도를 바꾸는 중간 값으로 종료일을 이동시키지 않는다.
    if (!date.root.contains(document.activeElement) || (document.activeElement as HTMLInputElement | null)?.type !== 'text') commit();
  });
  date.root.addEventListener('focusout', (event) => {
    if (!date.root.contains(event.relatedTarget as Node | null)) commit();
  });
  date.root.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') commit();
  });
  for (const input of [time]) {
    let keyboardEditing = false;
    let pendingChange = false;
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && pendingChange) {
        pendingChange = false;
        keyboardEditing = false;
        commit();
      }
      if (event.key !== 'Tab' && event.key !== 'Escape' && event.key !== 'Enter') keyboardEditing = true;
    });
    input.addEventListener('pointerdown', () => { keyboardEditing = false; });
    input.addEventListener('change', () => {
      // 네이티브 날짜 입력은 연·월·일의 각 키 입력에도 change를 발생시킨다.
      // 편집 중 값을 대입하면 연도가 잘리거나 선택 중인 날짜 구간이 초기화된다.
      if (keyboardEditing && document.activeElement === input) {
        pendingChange = true;
        return;
      }
      pendingChange = false;
      commit();
    });
    input.addEventListener('blur', () => {
      keyboardEditing = false;
      if (pendingChange) {
        pendingChange = false;
        commit();
      }
    });
  }
  setValue(hidden.value);
  const controller: DateTimePickerController = { getDate: date.getValue, getValue: () => hidden.value, setValue, syncHidden };
  pickerControllers.set(root, controller);
  return controller;
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
