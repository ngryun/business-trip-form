/**
 * 도장 이미지 생성기 — 이름을 받아 막도장 스타일 PNG 를 캔버스로 그린다.
 *
 * - 양각: 흰 바탕(투명) + 빨간 테두리 + 빨간 글자 / 음각: 빨간 원 + 흰 글자
 * - 끝글자: 인 / 印 / 없음 — 이름에 한자가 섞여 있으면 印 을 자동 선택
 * - 글자 수(이름+끝글자)에 따라 원 안에 1~2줄 격자로 배치
 * - 생성한 PNG 는 File 로 콜백에 넘겨 기존 도장 적용 흐름(applyFile)을 재사용한다
 */

export interface StampGeneratorOptions {
  initialName: string;
  onGenerate: (file: File) => void;
}

const STAMP_SIZE = 320;
const STAMP_RED = '#c43027';
const STAMP_FONT = '"Noto Serif KR", "함초롬바탕", serif';
const HANJA_RE = /[㐀-䶿一-鿿豈-﫿]/;

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
  title.textContent = '도장 이미지 만들기';

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

  // 끝글자 / 새김 선택
  let suffixTouched = false;
  const suffixRow = createRadioRow('끝글자', 'stamp-suffix', [
    { value: '인', label: '인' },
    { value: '印', label: '印' },
    { value: '', label: '없음' },
  ], () => { suffixTouched = true; redraw(); });
  const styleRow = createRadioRow('새김', 'stamp-style', [
    { value: 'yang', label: '양각 (빨간 글자)' },
    { value: 'eum', label: '음각 (흰 글자)' },
  ], redraw);
  // 거친 인주 질감 강도 — 0% 면 깔끔한 벡터, 높일수록 실제 날인처럼 갈라지고 번진다
  const textureRow = createSliderRow('질감', 45, redraw);

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

  dialog.append(title, nameLabel, suffixRow.root, styleRow.root, textureRow.root, previewWrap, buttons);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);
  currentDialog = backdrop;

  function cleanName(): string {
    return nameInput.value.replace(/\s+/g, '');
  }

  /** 이름에 한자가 있으면 印, 없으면 인 — 사용자가 직접 고른 뒤에는 건드리지 않는다. */
  function autoPickSuffix(): void {
    if (suffixTouched) return;
    suffixRow.setValue(HANJA_RE.test(cleanName()) ? '印' : '인');
  }

  function redraw(): void {
    const name = cleanName();
    drawStamp(canvas, name, suffixRow.getValue(), styleRow.getValue() as 'yang' | 'eum', textureRow.getValue());
    generateBtn.disabled = name.length === 0;
  }

  nameInput.addEventListener('input', () => {
    autoPickSuffix();
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

  generateBtn.addEventListener('click', () => {
    const name = cleanName();
    if (!name) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `도장_${name}.png`, { type: 'image/png' });
      closeStampGenerator();
      opts.onGenerate(file);
    }, 'image/png');
  });

  // 폰트(한자 포함)가 로드되면 다시 그려 첫 미리보기가 시스템 폰트로 굳는 것을 막는다
  autoPickSuffix();
  redraw();
  try {
    document.fonts.load(`100px ${STAMP_FONT}`, `${cleanName()}印인`).then(() => redraw());
  } catch { /* font loading API 미지원 시 시스템 폰트로 그린다 */ }

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

interface SliderRowController {
  root: HTMLElement;
  /** 0~1 로 정규화한 현재 값 */
  getValue: () => number;
}

/** 0~100% 슬라이더 한 줄 — 라벨 + 슬라이더 + 현재 % 표시. */
function createSliderRow(label: string, initial: number, onChange: () => void): SliderRowController {
  const root = document.createElement('div');
  root.className = 'stamp-dialog__field stamp-dialog__slider';

  const heading = document.createElement('span');
  heading.className = 'stamp-dialog__slider-label';
  heading.textContent = label;

  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '100';
  input.step = '5';
  input.value = String(initial);
  input.className = 'stamp-dialog__slider-input';
  input.setAttribute('aria-label', `${label} 강도 (0~100%)`);

  const valueEl = document.createElement('span');
  valueEl.className = 'stamp-dialog__slider-value';
  const syncValue = (): void => {
    valueEl.textContent = `${input.value}%`;
  };
  syncValue();

  input.addEventListener('input', () => {
    syncValue();
    onChange();
  });

  root.append(heading, input, valueEl);
  return { root, getValue: () => Number(input.value) / 100 };
}

/** 글자 수에 따른 원 안 배치 — 중심 기준 픽셀 오프셋과 폰트 크기 */
function layoutChars(count: number): { font: number; positions: Array<[number, number]> } {
  switch (count) {
    case 1: return { font: 168, positions: [[0, 0]] };
    case 2: return { font: 116, positions: [[0, -62], [0, 62]] };
    case 3: return { font: 102, positions: [[-57, -58], [57, -58], [0, 58]] };
    case 4: return { font: 102, positions: [[-57, -58], [57, -58], [-57, 58], [57, 58]] };
    default: {
      // 5자 이상 — 2줄로 나누고 줄 길이에 맞춰 축소
      const top = Math.ceil(count / 2);
      const bottom = count - top;
      const font = Math.max(56, Math.floor(210 / top));
      const positions: Array<[number, number]> = [];
      const spread = (len: number, y: number): void => {
        const spacing = Math.min(116, 216 / Math.max(1, len - 1) + 8);
        for (let i = 0; i < len; i += 1) {
          positions.push([(i - (len - 1) / 2) * spacing, y]);
        }
      };
      spread(top, -58);
      spread(bottom, 58);
      return { font, positions };
    }
  }
}

const RING_WIDTH = 14;

/**
 * 도장을 그린다. texture(0~1) 가 0 보다 크면 실제 날인처럼 보이도록 거친 질감을 입힌다.
 *
 * 순서: ① 깨끗한 도장을 오프스크린 캔버스(잉크 레이어)에 그린다 → ② destination-out 으로
 * 무작위 잡음을 덧칠해 잉크 일부를 "지워" 갈라짐/번짐을 만든다 → ③ 미세하게 회전시켜 본 캔버스에 합성.
 * 잡음은 입력값(이름·끝글자·새김·강도)으로 시드한 PRNG 라, 같은 입력이면 같은 모양이 나와 미리보기가 떨리지 않는다.
 */
function drawStamp(
  canvas: HTMLCanvasElement,
  name: string,
  suffix: string,
  style: 'yang' | 'eum',
  texture: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const S = STAMP_SIZE;
  const center = S / 2;
  ctx.clearRect(0, 0, S, S);

  const chars = [...name];
  if (suffix) chars.push(suffix);

  const ink = document.createElement('canvas');
  ink.width = S;
  ink.height = S;
  const ictx = ink.getContext('2d');
  if (!ictx) return;

  drawInkLayer(ictx, center, chars, style);

  const rng = makeRng(`${name}|${suffix}|${style}|${Math.round(texture * 100)}`);
  if (texture > 0) applyDistress(ictx, S, center, texture, rng);

  // 손으로 찍은 듯한 미세 기울기 — 질감이 0 이면 회전도 없다
  const rot = (rng() * 2 - 1) * 0.06 * texture;
  ctx.save();
  ctx.translate(center, center);
  ctx.rotate(rot);
  ctx.drawImage(ink, -center, -center);
  ctx.restore();
}

/** 깨끗한 도장(테두리 + 글자)을 그린다 — 질감 처리 전 단계. */
function drawInkLayer(
  ctx: CanvasRenderingContext2D,
  center: number,
  chars: string[],
  style: 'yang' | 'eum',
): void {
  const radius = center - RING_WIDTH / 2 - 4;

  if (style === 'eum') {
    ctx.fillStyle = STAMP_RED;
    ctx.beginPath();
    ctx.arc(center, center, radius + RING_WIDTH / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = STAMP_RED;
    ctx.lineWidth = RING_WIDTH;
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (chars.length === 0) return;

  const { font, positions } = layoutChars(chars.length);
  ctx.fillStyle = style === 'eum' ? '#ffffff' : STAMP_RED;
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = Math.max(1.5, font * 0.04); // fill+stroke 로 굵은 새김 느낌
  ctx.font = `700 ${font}px ${STAMP_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  chars.forEach((ch, i) => {
    const [dx, dy] = positions[i] ?? [0, 0];
    ctx.fillText(ch, center + dx, center + dy);
    ctx.strokeText(ch, center + dx, center + dy);
  });
}

/**
 * 잉크 레이어에 거친 인주 질감을 입힌다 (destination-out 으로 잉크를 부분적으로 지운다).
 * ① 전면 미세 갈라짐 ② 테두리 집중 침식(거친 원주) ③ 큰 농담 얼룩(압력 불균일).
 * amount(0~1) 가 클수록 강하게 침식된다.
 */
function applyDistress(
  ctx: CanvasRenderingContext2D,
  S: number,
  center: number,
  amount: number,
  rng: () => number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';

  // ① 전면에 흩뿌린 미세 갈라짐 — 잉크가 고르게 안 묻은 느낌
  const speckles = Math.floor(S * S * 0.02 * amount);
  for (let i = 0; i < speckles; i += 1) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 0.4 + rng() * (1.2 + amount * 1.6);
    ctx.globalAlpha = 0.12 + rng() * 0.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // ② 테두리(원주) 집중 침식 — 매끈한 원이 끊기고 번진 거친 테두리가 된다
  const edgeHits = Math.floor(160 * amount);
  const radius = center - RING_WIDTH / 2 - 4;
  for (let i = 0; i < edgeHits; i += 1) {
    const a = rng() * Math.PI * 2;
    const rr = radius + (rng() * 2 - 1) * (RING_WIDTH * 0.9);
    const x = center + Math.cos(a) * rr;
    const y = center + Math.sin(a) * rr;
    const r = 1 + rng() * 4;
    ctx.globalAlpha = 0.25 + rng() * 0.6;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // ③ 큰 농담 얼룩 — 손으로 누른 압력 차이로 한쪽이 연해지는 느낌
  ctx.globalAlpha = 1;
  const blobs = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < blobs; i += 1) {
    const x = center + (rng() * 2 - 1) * center * 0.7;
    const y = center + (rng() * 2 - 1) * center * 0.7;
    const r = 30 + rng() * 70;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(0,0,0,${0.18 * amount})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }

  ctx.restore();
}

/** 입력 문자열로 시드한 결정적 PRNG (mulberry32) — 같은 입력이면 같은 질감이 재현된다. */
function makeRng(seed: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
