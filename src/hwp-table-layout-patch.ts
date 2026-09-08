import { deflateRaw, inflateRaw } from 'pako';
import { CompoundFile } from './hwp-signature-export-patch';

/**
 * rhwp 0.7.11의 행 삭제는 tbl CTRL_HEADER의 width/height를 4바이트 앞에 기록한다.
 * payload +12는 가로 오프셋, +16은 너비, +20은 높이다 (앞의 4바이트는 ctrl ID).
 * 가로 오프셋과 너비는 삭제 전 값으로 복원하고 새 높이만 올바른 자리에 옮긴다.
 * 본문/셀/문단 정렬은 건드리지 않는다. 화면용 이동이 아니라 잘못된 직렬화를 교정한다.
 */
export function repairDeletedTableLayout(
  original: Uint8Array, resized: Uint8Array,
  section: number, paragraph: number, control: number,
): Uint8Array {
  const before = new CompoundFile(original);
  const after = new CompoundFile(resized);
  const name = `Section${section}`;
  const compressed = (bytes: Uint8Array): boolean => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(36, true) % 2 === 1;
  const wasCompressed = compressed(before.readStreamByName('FileHeader'));
  const isCompressed = compressed(after.readStreamByName('FileHeader'));
  const beforeStream = before.readStreamByName(name);
  const oldSection = wasCompressed ? inflateRaw(beforeStream) : beforeStream;
  const entry = after.entriesByName(new RegExp(`^${name}$`))[0];
  if (!entry) throw new Error('표 위치 보정 대상 구역이 없습니다.');
  const afterStream = after.readStream(entry);
  const newSection = isCompressed ? inflateRaw(afterStream) : afterStream.slice();
  const oldHeader = tableHeader(oldSection, paragraph, control);
  const newHeader = tableHeader(newSection, paragraph, control);
  if (oldHeader.getUint32(12, true) === newHeader.getUint32(12, true)
    && oldHeader.getUint32(16, true) === newHeader.getUint32(16, true)) return resized;
  if (oldHeader.getUint32(20, true) !== newHeader.getUint32(20, true)) {
    throw new Error('예상하지 못한 표 크기 변경입니다.');
  }
  const height = newHeader.getUint32(16, true);
  newHeader.setUint32(12, oldHeader.getUint32(12, true), true);
  newHeader.setUint32(16, oldHeader.getUint32(16, true), true);
  newHeader.setUint32(20, height, true);
  after.replaceStream(entry, isCompressed ? deflateRaw(newSection, { level: 9 }) : newSection);
  return after.bytes;
}

function tableHeader(bytes: Uint8Array, paragraph: number, control: number): DataView {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let para = -1;
  let ctrl = -1;
  for (let offset = 0; offset + 4 <= bytes.length;) {
    const header = view.getUint32(offset, true);
    offset += 4;
    const tag = header & 1023;
    const level = (header >>> 10) & 1023;
    let size = header >>> 20;
    if (size === 4095) {
      if (offset + 4 > bytes.length) break;
      size = view.getUint32(offset, true);
      offset += 4;
    }
    if (offset + size > bytes.length) break;
    if (tag === 66 && level === 0) { para++; ctrl = -1; }
    if (tag === 71 && level === 1) {
      ctrl++;
      if (para === paragraph && ctrl === control && size >= 24 && view.getUint32(offset, true) === 0x74626c20) {
        return new DataView(bytes.buffer, bytes.byteOffset + offset, size);
      }
    }
    offset += size;
  }
  throw new Error('표 위치 보정 대상 컨트롤이 없습니다.');
}
