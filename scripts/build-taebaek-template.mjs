/**
 * 태백교육지원청 여비정산신청서(hwpx, 누름틀 없음)에 앱이 쓰는 누름틀을 넣어 HWP 양식으로 만든다.
 *
 *   node scripts/build-taebaek-template.mjs
 *
 * 입력: templates-src/business-trip-taebaek.hwpx  (교육지원청에서 받은 원본 서식)
 * 출력: public/templates/business-trip-taebaek.hwp
 *
 * 앱의 @rhwp/core 0.7.11 은 HWPX 안의 누름틀을 읽지 못해, 누름틀을 읽는 0.8.x 로 HWPX 를 열어
 * HWP 로 저장한다(0.7.11 은 그 HWP 의 누름틀을 읽는다). 0.8.x 는 실행할 때 임시 폴더에 받아 쓴다.
 * 누름틀 이름·안내문구는 기본 양식(business-trip.hwp)과 같게 맞춘다.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '..');
const SOURCE = join(ROOT, 'templates-src/business-trip-taebaek.hwpx');
const OUTPUT = join(ROOT, 'public/templates/business-trip-taebaek.hwp');
const CONVERTER_VERSION = '0.8.7';

/** 칸(행·열) → 넣을 누름틀. paragraph 는 칸 안 문단 번호, prefix/suffix 는 누름틀 앞뒤에 남길 글자. */
const CELL_FIELDS = [
  { row: 0, col: 1, name: '소속' },
  { row: 0, col: 7, name: '직급' },
  { row: 0, col: 11, name: '이름' },
  { row: 1, col: 2, name: '시작일시' },
  { row: 2, col: 2, name: '출장명' },
  { row: 2, col: 9, name: '출장지' },
  ...['갈때', '올때'].flatMap((direction, offset) => [
    { row: 6 + offset, col: 1, name: `${direction}일자` },
    { row: 6 + offset, col: 2, name: `${direction}교통편`, guide: '교통편' },
    { row: 6 + offset, col: 3, name: `${direction}출발지`, guide: '출발지' },
    { row: 6 + offset, col: 4, name: `${direction}도착지`, guide: '도착지' },
  ]),
  { row: 15, col: 0, paragraph: 2, name: '첨부서류', prefix: '첨 부  ' },
  { row: 15, col: 0, paragraph: 6, name: '제출날짜' },
  { row: 15, col: 0, paragraph: 8, name: '성명', prefix: '                     신 청 인   성 명  ', suffix: '  (인) ' },
];

// ---------------------------------------------------------------------------
// 최소 ZIP 읽기/쓰기 (HWPX 는 ZIP 컨테이너, mimetype 은 맨 앞에 무압축)

function readZip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  if (eocd < 0) throw new Error('ZIP 끝 레코드를 찾지 못했습니다.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataStart, dataStart + size);
    entries.push({ name, data: method === 0 ? Buffer.from(raw) : inflateRawSync(raw) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function writeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const stored = name === 'mimetype';
    const body = stored ? data : deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(stored ? 0 : 8, 8);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(header, nameBuf, body);
    centrals.push(central, nameBuf);
    offset += header.length + nameBuf.length + body.length;
  }
  const centralSize = centrals.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

// ---------------------------------------------------------------------------
// section0.xml 편집

const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function clickHereXml(id, name, guide) {
  const command = `Direction:wstring:${guide.length}:${guide} HelpState:wstring:0: `;
  return `<hp:ctrl><hp:fieldBegin id="${id}" type="CLICK_HERE" name="${escapeXml(name)}" editable="1" dirty="0" fieldid="${id}">`
    + '<hp:parameters cnt="3" name=""><hp:integerParam name="Prop">9</hp:integerParam>'
    + `<hp:stringParam name="Command">Clickhere:set:${command.length}:${escapeXml(command)}</hp:stringParam>`
    + '<hp:stringParam name="Help"></hp:stringParam></hp:parameters></hp:fieldBegin></hp:ctrl>'
    + `<hp:t></hp:t><hp:ctrl><hp:fieldEnd beginIDRef="${id}" fieldid="${id}"/></hp:ctrl>`;
}

function insertFields(xml) {
  let nextId = 1_900_000_001;
  return xml.replace(/<hp:tc [\s\S]*?<\/hp:tc>/g, (cell) => {
    const addr = cell.match(/<hp:cellAddr colAddr="(\d+)" rowAddr="(\d+)"\/>/);
    if (!addr) return cell;
    const [col, row] = [Number(addr[1]), Number(addr[2])];
    const targets = CELL_FIELDS.filter((f) => f.row === row && f.col === col);
    if (targets.length === 0) return cell;
    let paragraphIndex = -1;
    return cell.replace(/<hp:p [\s\S]*?<\/hp:p>/g, (paragraph) => {
      paragraphIndex += 1;
      const target = targets.find((f) => (f.paragraph ?? 0) === paragraphIndex);
      if (!target) return paragraph;
      target.done = true;
      const charPr = paragraph.match(/<hp:run charPrIDRef="(\d+)"/)?.[1] ?? '0';
      const open = paragraph.match(/^<hp:p [^>]*>/)[0];
      const lines = paragraph.match(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/)?.[0] ?? '';
      const text = (s) => (s ? `<hp:t>${escapeXml(s)}</hp:t>` : '');
      const run = `<hp:run charPrIDRef="${charPr}">${text(target.prefix ?? '')}${clickHereXml(nextId++, target.name, target.guide ?? target.name)}${text(target.suffix ?? '')}</hp:run>`;
      return `${open}${run}${lines}</hp:p>`;
    });
  });
}

// ---------------------------------------------------------------------------

async function loadConverter() {
  const dir = join(tmpdir(), `rhwp-core-${CONVERTER_VERSION}`);
  const pkg = join(dir, 'package');
  if (!existsSync(join(pkg, 'rhwp.js'))) {
    mkdirSync(dir, { recursive: true });
    execSync(`npm pack @rhwp/core@${CONVERTER_VERSION} --silent`, { cwd: dir, stdio: 'ignore' });
    execSync(`tar xzf rhwp-core-${CONVERTER_VERSION}.tgz`, { cwd: dir });
  }
  const mod = await import(pathToFileURL(join(pkg, 'rhwp.js')).href);
  await mod.default({ module_or_path: readFileSync(join(pkg, 'rhwp_bg.wasm')) });
  return mod;
}

async function loadAppEngine() {
  const pkg = join(ROOT, 'node_modules/@rhwp/core');
  const mod = await import(pathToFileURL(join(pkg, 'rhwp.js')).href);
  await mod.default({ module_or_path: readFileSync(join(pkg, 'rhwp_bg.wasm')) });
  return mod;
}

globalThis.measureTextWidth ??= () => 10;

const entries = readZip(readFileSync(SOURCE));
const section = entries.find((e) => e.name === 'Contents/section0.xml');
section.data = Buffer.from(insertFields(section.data.toString('utf8')), 'utf8');
const missed = CELL_FIELDS.filter((f) => !f.done).map((f) => f.name);
if (missed.length > 0) throw new Error(`누름틀을 넣을 칸을 찾지 못했습니다: ${missed.join(', ')}`);

const converter = await loadConverter();
const hwp = new converter.HwpDocument(writeZip(entries)).exportHwp();

// 앱 엔진으로 다시 열어 누름틀이 모두 살아 있는지 확인한다.
const app = await loadAppEngine();
const names = JSON.parse(new app.HwpDocument(hwp).getFieldList()).map((f) => f.name);
const lost = CELL_FIELDS.map((f) => f.name).filter((name) => !names.includes(name));
if (lost.length > 0) throw new Error(`변환 후 앱 엔진에서 사라진 누름틀: ${lost.join(', ')}`);

writeFileSync(OUTPUT, hwp);
console.log(`${OUTPUT} (${hwp.length} bytes, 누름틀 ${names.length}개: ${names.join(', ')})`);
