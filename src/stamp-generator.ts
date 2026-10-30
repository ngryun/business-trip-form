/** 이름으로 개인인감 PNG를 생성한다. 기본값: 연성(부드러운 붓글씨), 인 붙이기, 옅은 마모. */
import { drawPersonalStamp as drawStamp, loadStampFont, STAMP_FONTS } from './personal-stamp.js';

export interface StampGeneratorOptions {
  initialName: string;
  onGenerate: (file: File) => void;
}

const STAMP_SIZE = 320;

/** 도장 모양 설정 — 문서에 넣을 때 브라우저에 기억해 두고, 성명으로 만드는 자동 도장에도 쓴다. */
export interface StampSettings {
  fontIdx: number;
  suffix: string;
  style: 'yang' | 'eum';
  /** 잉크 번짐·끊김 (0~100) */
  ink: number;
  /** 얼룩 크기 (0=굵은 얼룩 ~ 100=고운 알갱이) */
  grain: number;
  /** 테두리 울퉁불퉁 (0~100) */
  rough: number;
}

/**
 * 기본 도장 질감 — 원본 렌더러 기본값(ink 16, rough 14)은 너무 반듯해 보여
 * 잉크 끊김과 테두리 떨림을 조금 더 준다. 이름마다 seed 를 달리해 같은 무늬가 반복되지 않게 한다.
 */
const STAMP_TEXTURE = { ink: 36, grain: 62, rough: 28 } as const;

/** 낡은 정도 빠른 설정 (도장만들기 프로그램의 「번짐 적게 / 많이 낡게」와 같은 값) */
const TEXTURE_PRESETS = [
  { label: '번짐 적게', ink: 16, grain: 62, rough: 14 },
  { label: '기본', ...STAMP_TEXTURE },
  { label: '많이 낡게', ink: 62, grain: 34, rough: 58 },
] as const;

export const DEFAULT_STAMP_SETTINGS: Readonly<StampSettings> = Object.freeze({ fontIdx: 0, suffix: '인', style: 'yang', ...STAMP_TEXTURE });

const STAMP_SETTINGS_STORAGE_KEY = 'business-trip-form:stamp-settings:v1';

const clampPercent = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : fallback;

/** 저장된 값이 깨졌거나 예전 형식이면 항목마다 기본값으로 메운다. */
export function normalizeStampSettings(raw: unknown): StampSettings {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof StampSettings, unknown>>;
  const d = DEFAULT_STAMP_SETTINGS;
  const fontIdx = typeof value.fontIdx === 'number' && Number.isInteger(value.fontIdx) && value.fontIdx >= 0 && value.fontIdx < STAMP_FONTS.length ? value.fontIdx : d.fontIdx;
  const suffix = typeof value.suffix === 'string' && ['인', '印', ''].includes(value.suffix) ? value.suffix : d.suffix;
  const style = value.style === 'eum' || value.style === 'yang' ? value.style : d.style;
  return { fontIdx, suffix, style, ink: clampPercent(value.ink, d.ink), grain: clampPercent(value.grain, d.grain), rough: clampPercent(value.rough, d.rough) };
}

export function loadStampSettings(): StampSettings {
  try {
    const raw = localStorage.getItem(STAMP_SETTINGS_STORAGE_KEY);
    return normalizeStampSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_STAMP_SETTINGS };
  }
}

function saveStampSettings(settings: StampSettings): void {
  try {
    localStorage.setItem(STAMP_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch { /* 저장 못 해도 도장은 넣는다 */ }
}

function stampSeedFromName(name: string): number {
  let hash = 2166136261;
  for (const ch of name) {
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * 이름과 설정(글씨체·끝글자·새김·질감)으로 그린다. 생성기 미리보기와 자동 도장이 같은 결과를 낸다.
 * reroll 은 「다시 찍기」로 바꾼 잉크 얼룩 무늬 — 0 이면 이름에서 정한 무늬.
 */
export function drawDefaultStyledStamp(canvas: HTMLCanvasElement, name: string, settings: StampSettings = DEFAULT_STAMP_SETTINGS, reroll = 0): void {
  const { fontIdx, suffix, style, ink, grain, rough } = settings;
  drawStamp(canvas, name, suffix, style, { ink, grain, rough, seed: (stampSeedFromName(name) ^ reroll) >>> 0, fontIdx });
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

  // 글씨체 / 끝글자 / 새김 선택 — 지난번 문서에 넣은 설정으로 시작한다.
  const saved = loadStampSettings();
  let reroll = 0;
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
  fontRow.setValue(String(saved.fontIdx));
  suffixRow.setValue(saved.suffix);
  styleRow.setValue(saved.style);

  // 낡은 느낌 — 빠른 설정과 슬라이더, 같은 설정으로 다시 찍기
  const texture = document.createElement('div');
  texture.className = 'stamp-dialog__texture';
  const textureHeading = document.createElement('span');
  textureHeading.className = 'stamp-dialog__field';
  textureHeading.textContent = '낡은 느낌';
  const presetRow = document.createElement('div');
  presetRow.className = 'stamp-dialog__presets';
  const inkSlider = createSlider('잉크 번짐·끊김', saved.ink, redraw);
  const grainSlider = createSlider('얼룩 크기', saved.grain, redraw, '왼쪽 굵은 얼룩 · 오른쪽 고운 알갱이');
  const roughSlider = createSlider('테두리 울퉁불퉁', saved.rough, redraw);
  for (const preset of TEXTURE_PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'attachment-preset-chip';
    btn.textContent = preset.label;
    btn.addEventListener('click', () => {
      inkSlider.setValue(preset.ink);
      grainSlider.setValue(preset.grain);
      roughSlider.setValue(preset.rough);
      redraw();
    });
    presetRow.appendChild(btn);
  }
  const rerollBtn = document.createElement('button');
  rerollBtn.type = 'button';
  rerollBtn.className = 'attachment-preset-chip';
  rerollBtn.textContent = '🎲 다시 찍기';
  rerollBtn.title = '설정은 그대로 두고 잉크 얼룩 무늬만 새로 찍습니다.';
  rerollBtn.addEventListener('click', () => {
    reroll = (Math.random() * 0x100000000) >>> 0;
    redraw();
  });
  presetRow.appendChild(rerollBtn);
  texture.append(textureHeading, presetRow, inkSlider.root, grainSlider.root, roughSlider.root);

  const note = document.createElement('p');
  note.className = 'stamp-dialog__note';
  note.textContent = '문서에 넣은 설정은 이 브라우저에 기억해, 다음에 성명으로 만드는 기본 도장에도 씁니다.';

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

  dialog.append(title, nameLabel, fontRow.root, suffixRow.root, styleRow.root, texture, previewWrap, note, buttons);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  currentDialog = backdrop;

  function cleanName(): string {
    return nameInput.value.replace(/\s+/g, '');
  }
  function fontIdx(): number {
    return Number(fontRow.getValue());
  }
  function settings(): StampSettings {
    return normalizeStampSettings({
      fontIdx: fontIdx(),
      suffix: suffixRow.getValue(),
      style: styleRow.getValue(),
      ink: inkSlider.getValue(),
      grain: grainSlider.getValue(),
      rough: roughSlider.getValue(),
    });
  }

  function redraw(): void {
    const name = cleanName();
    drawDefaultStyledStamp(canvas, name, settings(), reroll);
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
    const chosen = settings();
    drawDefaultStyledStamp(canvas, name, chosen, reroll);
    saveStampSettings(chosen);
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

interface SliderController {
  root: HTMLElement;
  getValue: () => number;
  setValue: (value: number) => void;
}

/** 0~100 슬라이더 한 줄 (라벨 · 막대 · 숫자) */
function createSlider(label: string, initial: number, onInput: () => void, hint = ''): SliderController {
  const root = document.createElement('label');
  root.className = 'stamp-dialog__slider';
  const text = document.createElement('span');
  text.textContent = label;
  if (hint) text.title = hint;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '100';
  input.value = String(initial);
  const output = document.createElement('output');
  output.textContent = input.value;
  input.addEventListener('input', () => {
    output.textContent = input.value;
    onInput();
  });
  root.append(text, input, output);
  return {
    root,
    getValue: () => Number(input.value),
    setValue: (value) => {
      input.value = String(value);
      output.textContent = input.value;
    },
  };
}

/** 폰트 로딩이 끝난 뒤 기본 도장을 만들어 자동 삽입에도 같은 렌더러를 쓴다. 지난번 생성기에서 넣은 설정을 따른다. */
export async function createDefaultStamp(name: string): Promise<File> {
  const cleanName = name.replace(/\s+/g, '');
  if (!cleanName) throw new Error('도장을 만들 이름을 입력해 주세요.');
  const settings = loadStampSettings();
  await loadStampFont(cleanName, settings.fontIdx);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = STAMP_SIZE;
  drawDefaultStyledStamp(canvas, cleanName, settings);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(value => value ? resolve(value) : reject(new Error('도장 이미지 생성에 실패했습니다.')), 'image/png');
  });
  return new File([blob], `도장_${cleanName}.png`, { type: 'image/png' });
}
