/** 이름으로 개인인감 PNG를 생성한다. 기본값: 연성(부드러운 붓글씨), 인 붙이기, 옅은 마모. */
import { drawPersonalStamp as drawStamp, loadStampFont, STAMP_FONTS } from './personal-stamp.js';

export interface StampGeneratorOptions {
  initialName: string;
  onGenerate: (file: File) => void;
}

const STAMP_SIZE = 320;

/**
 * 기본 도장 질감 — 원본 렌더러 기본값(ink 16, rough 14)은 너무 반듯해 보여
 * 잉크 끊김과 테두리 떨림을 조금 더 준다. 이름마다 seed 를 달리해 같은 무늬가 반복되지 않게 한다.
 */
const STAMP_TEXTURE = { ink: 36, rough: 28 } as const;

function stampSeedFromName(name: string): number {
  let hash = 2166136261;
  for (const ch of name) {
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** 이름·끝글자·새김·글씨체에 기본 질감을 더해 그린다. 생성기 미리보기와 자동 도장이 같은 결과를 낸다. */
export function drawDefaultStyledStamp(canvas: HTMLCanvasElement, name: string, suffix = '인', style: 'yang' | 'eum' = 'yang', fontIdx = 0): void {
  drawStamp(canvas, name, suffix, style, { ...STAMP_TEXTURE, seed: stampSeedFromName(name), fontIdx });
}

let currentDialog: HTMLElement | null = null;

export function openStampGenerator(opts: StampGeneratorOptions): void {
  closeStampGenerator();

  const backdrop = document.createElement('div');
  backdrop.className = 'stamp-dialog__backdrop';

  const dialog = document.createElement('div');
  dialog.className = 'stamp-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', '도장 이미지 만들기');

  const title = document.createElement('div');
  title.className = 'stamp-dialog__title';
  title.textContent = '개인인감 만들기';

  // 이름 입력
  const nameLabel = document.createElement('label');
  nameLabel.className = 'stamp-dialog__field';
  nameLabel.textContent = '이름 (한글 또는 한자)';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'stamp-dialog__input';
  nameInput.value = opts.initialName;
  nameInput.placeholder = '예: 홍길동 / 洪吉童';
  nameLabel.appendChild(nameInput);

  // 글씨체 / 끝글자 / 새김 선택
  const fontRow = createRadioRow('글씨체', 'stamp-font', STAMP_FONTS.map((font, index) => ({ value: String(index), label: font.label })), () => {
    void loadStampFont(cleanName(), fontIdx()).then(redraw);
    redraw();
  });
  const suffixRow = createRadioRow('끝글자', 'stamp-suffix', [
    { value: '인', label: '인' },
    { value: '印', label: '印' },
    { value: '', label: '없음' },
  ], redraw);
  const styleRow = createRadioRow('새김', 'stamp-style', [
    { value: 'yang', label: '양각 (빨간 글자)' },
    { value: 'eum', label: '음각 (흰 글자)' },
  ], redraw);

  // 미리보기
  const previewWrap = document.createElement('div');
  previewWrap.className = 'stamp-dialog__preview';
  const canvas = document.createElement('canvas');
  canvas.width = STAMP_SIZE;
  canvas.height = STAMP_SIZE;
  previewWrap.appendChild(canvas);

  // 버튼
  const buttons = document.createElement('div');
  buttons.className = 'field-popover__buttons';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'field-popover__cancel';
  cancelBtn.textContent = '취소';
  const generateBtn = document.createElement('button');
  generateBtn.type = 'button';
  generateBtn.className = 'field-popover__confirm';
  generateBtn.textContent = '문서에 넣기';
  buttons.append(cancelBtn, generateBtn);

  dialog.append(title, nameLabel, fontRow.root, suffixRow.root, styleRow.root, previewWrap, buttons);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  currentDialog = backdrop;

  function cleanName(): string {
    return nameInput.value.replace(/\s+/g, '');
  }
  function fontIdx(): number {
    return Number(fontRow.getValue());
  }

  function redraw(): void {
    const name = cleanName();
    drawDefaultStyledStamp(canvas, name, suffixRow.getValue(), styleRow.getValue() as 'yang' | 'eum', fontIdx());
    generateBtn.disabled = name.length === 0;
  }

  nameInput.addEventListener('input', () => {
    void loadStampFont(cleanName(), fontIdx()).then(redraw);
    redraw();
  });

  cancelBtn.addEventListener('click', closeStampGenerator);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) closeStampGenerator();
  });
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeStampGenerator();
    }
  });

  generateBtn.addEventListener('click', async () => {
    const name = cleanName();
    if (!name) return;
    generateBtn.disabled = true;
    await loadStampFont(name, fontIdx());
    drawDefaultStyledStamp(canvas, name, suffixRow.getValue(), styleRow.getValue() as 'yang' | 'eum', fontIdx());
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `도장_${name}.png`, { type: 'image/png' });
      closeStampGenerator();
      opts.onGenerate(file);
    }, 'image/png');
  });

  redraw();
  void loadStampFont(cleanName(), fontIdx()).then(redraw);

  setTimeout(() => nameInput.focus(), 0);
}

export function closeStampGenerator(): void {
  currentDialog?.remove();
  currentDialog = null;
}

interface RadioRowController {
  root: HTMLElement;
  getValue: () => string;
  setValue: (value: string) => void;
}

function createRadioRow(
  label: string,
  groupName: string,
  options: Array<{ value: string; label: string }>,
  onChange: () => void,
): RadioRowController {
  const root = document.createElement('div');
  root.className = 'stamp-dialog__field stamp-dialog__radios';
  const heading = document.createElement('span');
  heading.textContent = label;
  root.appendChild(heading);

  const inputs: HTMLInputElement[] = [];
  for (const [i, option] of options.entries()) {
    const wrap = document.createElement('label');
    wrap.className = 'stamp-dialog__radio';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = groupName;
    input.value = option.value;
    input.checked = i === 0;
    input.addEventListener('change', onChange);
    wrap.append(input, document.createTextNode(option.label));
    root.appendChild(wrap);
    inputs.push(input);
  }

  return {
    root,
    getValue: () => inputs.find((input) => input.checked)?.value ?? options[0].value,
    setValue: (value) => {
      for (const input of inputs) input.checked = input.value === value;
    },
  };
}

/** 폰트 로딩이 끝난 뒤 기본 도장을 만들어 자동 삽입에도 같은 렌더러를 쓴다. */
export async function createDefaultStamp(name: string): Promise<File> {
  const cleanName = name.replace(/\s+/g, '');
  if (!cleanName) throw new Error('도장을 만들 이름을 입력해 주세요.');
  await loadStampFont(cleanName);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = STAMP_SIZE;
  drawDefaultStyledStamp(canvas, cleanName);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(value => value ? resolve(value) : reject(new Error('도장 이미지 생성에 실패했습니다.')), 'image/png');
  });
  return new File([blob], `도장_${cleanName}.png`, { type: 'image/png' });
}
