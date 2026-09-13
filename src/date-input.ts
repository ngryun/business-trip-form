/** 키보드는 연 → 월 → 일로 이동하고, 달력은 브라우저 기본 선택기를 사용한다. */
export function createDateInput(): {
  root: HTMLElement;
  calendar: HTMLInputElement;
  getValue: () => string;
  setValue: (value: string) => void;
} {
  const root = document.createElement('span');
  root.className = 'date-input';
  const fields = [
    { label: '연도', placeholder: 'YYYY', length: 4 },
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
  const calendar = document.createElement('input');
  calendar.type = 'date';
  calendar.className = 'date-input__calendar';
  calendar.setAttribute('aria-label', '달력에서 날짜 선택');
  calendar.tabIndex = -1;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'date-input__button';
  button.textContent = '▦';
  button.setAttribute('aria-label', '달력 열기');
  button.addEventListener('click', () => {
    if (typeof calendar.showPicker === 'function') calendar.showPicker();
    else calendar.focus();
  });

  function getValue(): string {
    const [year, month, day] = fields.map(input => input.value);
    if (year.length !== 4 || !month || !day) return '';
    const value = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number(year) > 0 && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : '';
  }
  function setValue(value: string): void {
    const parts = value.split('-');
    fields.forEach((input, i) => { if (input.value !== (parts[i] ?? '')) input.value = parts[i] ?? ''; });
    calendar.value = value;
  }
  function changed(): void {
    calendar.value = getValue();
    root.dispatchEvent(new Event('change', { bubbles: true }));
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
  calendar.addEventListener('change', (event) => {
    event.stopPropagation();
    setValue(calendar.value);
    changed();
  });
  root.append(button, calendar);
  return { root, calendar, getValue, setValue };
}
