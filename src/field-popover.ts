/**
 * 미리보기 위에서 누름틀을 클릭했을 때 떠오르는 입력 팝오버.
 *
 * - 라벨에 맞는 위젯(text/datetime-local/date/select/textarea) 렌더링
 * - Enter 확정 / Esc 취소 / 외부 클릭 취소 / 자동 포커스
 * - 화면 가장자리에서 잘리지 않도록 위치 보정
 */

import {
  DATETIME_STEP_SECONDS,
  FIELD_CONFIGS,
  normalizeDateTimeLocalStep,
  type WidgetConfig,
} from './field-config';

export interface PopoverArgs {
  label: string;
  initialValue: string;
  /** 클라이언트 좌표계 기준 누름틀 근처 위치 (보통 클릭한 점) */
  anchor: { x: number; y: number };
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

let currentPopover: HTMLElement | null = null;
let currentCleanup: (() => void) | null = null;

export function showFieldPopover(args: PopoverArgs): void {
  closeFieldPopover();
  const cfg = FIELD_CONFIGS[args.label];
  if (!cfg) return;

  const root = document.createElement('div');
  root.className = 'field-popover';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', `${args.label} 입력`);

  const titleEl = document.createElement('div');
  titleEl.className = 'field-popover__title';
  titleEl.textContent = args.label;
  root.appendChild(titleEl);

  const input = createInput(cfg, args.initialValue);
  input.className = 'field-popover__input';
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
  buttons.append(cancelBtn, confirmBtn);
  root.appendChild(buttons);

  document.body.appendChild(root);
  positionNear(root, args.anchor);

  const finish = (commit: boolean): void => {
    if (commit) {
      args.onConfirm(getInputValue(input));
    } else {
      args.onCancel();
    }
    closeFieldPopover();
  };

  confirmBtn.addEventListener('click', () => finish(true));
  cancelBtn.addEventListener('click', () => finish(false));

  input.addEventListener('keydown', (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Enter' && !(input instanceof HTMLTextAreaElement)) {
      ke.preventDefault();
      finish(true);
    } else if (ke.key === 'Escape') {
      ke.preventDefault();
      finish(false);
    }
  });

  // 외부 클릭 시 취소 — 팝오버 자체를 연 click 이벤트가 곧장 닫지 않도록 다음 틱에 바인딩
  const onOuter = (e: MouseEvent): void => {
    if (!root.contains(e.target as Node)) finish(false);
  };
  setTimeout(() => document.addEventListener('mousedown', onOuter, { capture: true }), 0);
  currentCleanup = () => document.removeEventListener('mousedown', onOuter, { capture: true } as any);

  // 자동 포커스 (텍스트 인풋은 전체 선택까지)
  setTimeout(() => {
    if (input instanceof HTMLInputElement) {
      input.focus();
      if (input.type === 'text') input.select();
    } else if (input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement) {
      input.focus();
    }
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

function createInput(cfg: WidgetConfig, initial: string): HTMLElement {
  if (cfg.type === 'select') {
    const sel = document.createElement('select');
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '선택';
    sel.appendChild(blank);
    for (const opt of cfg.options) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      sel.appendChild(o);
    }
    sel.value = initial;
    return sel;
  }
  if (cfg.type === 'textarea') {
    const ta = document.createElement('textarea');
    ta.rows = cfg.rows ?? 2;
    ta.value = initial;
    return ta;
  }
  const inp = document.createElement('input');
  if (cfg.type === 'datetime') {
    inp.type = 'datetime-local';
    inp.step = String(DATETIME_STEP_SECONDS);
    const normalize = (): void => {
      inp.value = normalizeDateTimeLocalStep(inp.value);
    };
    inp.addEventListener('change', normalize);
    inp.addEventListener('blur', normalize);
  } else if (cfg.type === 'date') {
    inp.type = 'date';
  } else {
    inp.type = 'text';
  }
  inp.value = initial;
  return inp;
}

function getInputValue(el: HTMLElement): string {
  if (el instanceof HTMLInputElement && el.type === 'datetime-local') {
    return normalizeDateTimeLocalStep(el.value);
  }
  if (el instanceof HTMLSelectElement || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value;
  }
  return '';
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
