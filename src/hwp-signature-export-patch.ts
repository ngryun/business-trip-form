const CFB_FREE_SECT = 0xffffffff;
const CFB_END_OF_CHAIN = 0xfffffffe;
const CFB_FAT_SECT = 0xfffffffd;
const HWP_FILE_HEADER_STREAM = 'FileHeader';
const HWP_BODY_SECTION_RE = /^Section\d+$/;
const HWPTAG_CTRL_HEADER = 71;
const CTRL_ID_GSO = 0x67736f20; // " osg"
const SIGNATURE_STAMP_DESCRIPTION = 'signature-stamp';
const TEXT_WRAP_BITS_MASK = 0b111 << 21;
// 본문과의 배치(bit 21~23). 한컴오피스에서 값별 hwp 를 직접 열어 확인한 결과 2 = 글 뒤로.
const TEXT_WRAP_BEHIND_TEXT = 2 << 21;

interface CfbEntry {
  name: string;
  type: number;
  startSector: number;
  size: number;
  dirOffset: number;
}

type CompressionStreamFormat = 'gzip' | 'deflate' | 'deflate-raw';
type CompressionStreamConstructor = new (format: CompressionStreamFormat) => TransformStream<Uint8Array, Uint8Array>;

/**
 * @rhwp/core 0.7.11 updates the in-memory picture layout correctly, so preview renders the stamp
 * behind text. Its HWP exporter, however, serializes newly inserted pictures with Square wrapping.
 * Patch only our stamped picture controls in the exported HWP container.
 */
export async function patchSignatureStampBehindTextInHwp(bytes: Uint8Array): Promise<Uint8Array> {
  const cfb = new CompoundFile(bytes);
  const fileHeader = cfb.readStreamByName(HWP_FILE_HEADER_STREAM);
  const compressed = fileHeader.length >= 40 && (readU32(fileHeader, 36) & 1) !== 0;
  let patchedCount = 0;

  for (const entry of cfb.entriesByName(HWP_BODY_SECTION_RE)) {
    const sectionBytes = cfb.readStream(entry);
    const inflated = compressed ? await inflateRaw(sectionBytes) : sectionBytes;
    const patched = patchSignatureStampControls(inflated);
    if (!patched.patchedCount) continue;

    const nextSectionBytes = compressed ? await deflateRaw(patched.bytes) : patched.bytes;
    cfb.replaceStream(entry, nextSectionBytes);
    patchedCount += patched.patchedCount;
  }

  return patchedCount > 0 ? cfb.bytes : bytes;
}

function patchSignatureStampControls(sectionBytes: Uint8Array): { bytes: Uint8Array; patchedCount: number } {
  const bytes = sectionBytes.slice();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  let patchedCount = 0;

  while (pos + 4 <= bytes.length) {
    const headerPos = pos;
    const header = view.getUint32(pos, true);
    pos += 4;
    const tagId = header & 0x3ff;
    let recordSize = (header >>> 20) & 0xfff;
    if (recordSize === 0xfff) {
      if (pos + 4 > bytes.length) break;
      recordSize = view.getUint32(pos, true);
      pos += 4;
    }

    const payloadPos = pos;
    const nextPos = payloadPos + recordSize;
    if (nextPos > bytes.length || nextPos < payloadPos) break;

    if (
      tagId === HWPTAG_CTRL_HEADER &&
      recordSize >= 46 &&
      view.getUint32(payloadPos, true) === CTRL_ID_GSO &&
      readHwpString(bytes, payloadPos + 44, nextPos) === SIGNATURE_STAMP_DESCRIPTION
    ) {
      const attrOffset = payloadPos + 4;
      const attr = view.getUint32(attrOffset, true);
      const nextAttr = ((attr & ~TEXT_WRAP_BITS_MASK & ~1) | TEXT_WRAP_BEHIND_TEXT) >>> 0;
      if (nextAttr !== attr) {
        view.setUint32(attrOffset, nextAttr, true);
        patchedCount += 1;
      }
    }

    pos = nextPos;
    if (pos <= headerPos) break;
  }

  return { bytes, patchedCount };
}

function readHwpString(bytes: Uint8Array, offset: number, recordEnd: number): string {
  if (offset + 2 > recordEnd) return '';
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint16(offset, true);
  const start = offset + 2;
  const end = start + length * 2;
  if (end > recordEnd) return '';

  let value = '';
  for (let pos = start; pos < end; pos += 2) {
    value += String.fromCharCode(view.getUint16(pos, true));
  }
  return value;
}

class CompoundFile {
  readonly bytes: Uint8Array;
  private readonly view: DataView;
  private readonly sectorSize: number;
  private readonly miniSectorSize: number;
  private readonly miniStreamCutoffSize: number;
  private readonly directoryStartSector: number;
  private readonly miniFatStartSector: number;
  private readonly fat: number[];
  private readonly miniFat: number[];
  private readonly directoryBytes: Uint8Array;
  private readonly rootEntry: CfbEntry;
  private readonly miniStreamBytes: Uint8Array;
  private readonly entries: CfbEntry[];

  constructor(source: Uint8Array) {
    this.bytes = source.slice();
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.assertHeader();

    this.sectorSize = 1 << this.view.getUint16(30, true);
    this.miniSectorSize = 1 << this.view.getUint16(32, true);
    this.directoryStartSector = this.view.getUint32(48, true);
    this.miniStreamCutoffSize = this.view.getUint32(56, true);
    this.miniFatStartSector = this.view.getUint32(60, true);
    this.fat = this.readFat();
    this.directoryBytes = this.readRegularStream(this.directoryStartSector);
    this.entries = this.readDirectoryEntries();
    const rootEntry = this.entries.find((entry) => entry.type === 5);
    if (!rootEntry) throw new Error('CFB root entry를 찾지 못했습니다.');
    this.rootEntry = rootEntry;
    this.miniFat = this.readMiniFat();
    this.miniStreamBytes = this.readRegularStream(this.rootEntry.startSector, this.rootEntry.size);
  }

  entriesByName(pattern: RegExp): CfbEntry[] {
    return this.entries.filter((entry) => entry.type === 2 && pattern.test(entry.name));
  }

  readStreamByName(name: string): Uint8Array {
    const entry = this.entries.find((item) => item.type === 2 && item.name === name);
    if (!entry) throw new Error(`CFB stream not found: ${name}`);
    return this.readStream(entry);
  }

  readStream(entry: CfbEntry): Uint8Array {
    if (entry.size < this.miniStreamCutoffSize) {
      return this.readMiniStream(entry.startSector, entry.size);
    }
    return this.readRegularStream(entry.startSector, entry.size);
  }

  replaceStream(entry: CfbEntry, data: Uint8Array): void {
    if (entry.size < this.miniStreamCutoffSize) {
      if (data.length >= this.miniStreamCutoffSize) {
        throw new Error(`Patched stream is too large for mini stream: ${entry.name}`);
      }
      this.writeMiniStream(entry.startSector, data);
      this.writeRegularStream(this.rootEntry.startSector, this.miniStreamBytes);
    } else {
      this.writeRegularStream(entry.startSector, data);
    }

    entry.size = data.length;
    writeU32(this.directoryBytes, entry.dirOffset + 120, data.length);
    writeU32(this.directoryBytes, entry.dirOffset + 124, 0);
    this.writeRegularStream(this.directoryStartSector, this.directoryBytes);
  }

  private assertHeader(): void {
    const expected = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    for (let i = 0; i < expected.length; i += 1) {
      if (this.bytes[i] !== expected[i]) {
        throw new Error('HWP OLE/CFB header가 아닙니다.');
      }
    }
  }

  private readFat(): number[] {
    const fatSectorCount = this.view.getUint32(44, true);
    const firstDifatSector = this.view.getUint32(68, true);
    const difatSectorCount = this.view.getUint32(72, true);
    const difat: number[] = [];

    for (let i = 0; i < 109; i += 1) {
      const sector = this.view.getUint32(76 + i * 4, true);
      if (sector !== CFB_FREE_SECT) difat.push(sector);
    }

    let difatSector = firstDifatSector;
    for (let i = 0; i < difatSectorCount && isRealSector(difatSector); i += 1) {
      const offset = this.sectorOffset(difatSector);
      const entriesPerDifatSector = this.sectorSize / 4 - 1;
      for (let j = 0; j < entriesPerDifatSector; j += 1) {
        const sector = this.view.getUint32(offset + j * 4, true);
        if (sector !== CFB_FREE_SECT) difat.push(sector);
      }
      difatSector = this.view.getUint32(offset + entriesPerDifatSector * 4, true);
    }

    const fat: number[] = [];
    for (const sector of difat.slice(0, fatSectorCount)) {
      if (!isRealSector(sector)) continue;
      const offset = this.sectorOffset(sector);
      for (let pos = 0; pos < this.sectorSize; pos += 4) {
        fat.push(this.view.getUint32(offset + pos, true));
      }
    }
    return fat;
  }

  private readMiniFat(): number[] {
    if (!isRealSector(this.miniFatStartSector)) return [];
    const miniFatSectorCount = this.view.getUint32(64, true);
    const bytes = this.readRegularStream(this.miniFatStartSector, miniFatSectorCount * this.sectorSize);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const miniFat: number[] = [];
    for (let pos = 0; pos + 4 <= bytes.length; pos += 4) {
      miniFat.push(view.getUint32(pos, true));
    }
    return miniFat;
  }

  private readDirectoryEntries(): CfbEntry[] {
    const entries: CfbEntry[] = [];
    for (let offset = 0; offset + 128 <= this.directoryBytes.length; offset += 128) {
      const type = this.directoryBytes[offset + 66];
      if (type === 0) continue;
      const nameLength = readU16(this.directoryBytes, offset + 64);
      const nameEnd = offset + Math.max(0, nameLength - 2);
      const name = readUtf16Le(this.directoryBytes, offset, nameEnd);
      entries.push({
        name,
        type,
        startSector: readU32(this.directoryBytes, offset + 116),
        size: readU32(this.directoryBytes, offset + 120),
        dirOffset: offset,
      });
    }
    return entries;
  }

  private readRegularStream(startSector: number, size?: number): Uint8Array {
    const chain = this.sectorChain(startSector, this.fat);
    const capacity = chain.length * this.sectorSize;
    const streamSize = size ?? capacity;
    const result = new Uint8Array(Math.min(streamSize, capacity));
    let writeOffset = 0;
    for (const sector of chain) {
      const sourceOffset = this.sectorOffset(sector);
      const length = Math.min(this.sectorSize, result.length - writeOffset);
      if (length <= 0) break;
      result.set(this.bytes.subarray(sourceOffset, sourceOffset + length), writeOffset);
      writeOffset += length;
    }
    return result;
  }

  private writeRegularStream(startSector: number, data: Uint8Array): void {
    const chain = this.sectorChain(startSector, this.fat);
    const capacity = chain.length * this.sectorSize;
    if (data.length > capacity) {
      throw new Error(`Patched stream exceeds allocated CFB sectors (${data.length} > ${capacity}).`);
    }

    let readOffset = 0;
    for (const sector of chain) {
      const targetOffset = this.sectorOffset(sector);
      const length = Math.min(this.sectorSize, data.length - readOffset);
      if (length > 0) {
        this.bytes.set(data.subarray(readOffset, readOffset + length), targetOffset);
        readOffset += length;
      }
      if (length < this.sectorSize) {
        this.bytes.fill(0, targetOffset + Math.max(length, 0), targetOffset + this.sectorSize);
      }
    }
  }

  private readMiniStream(startSector: number, size: number): Uint8Array {
    const chain = this.sectorChain(startSector, this.miniFat);
    const capacity = chain.length * this.miniSectorSize;
    const result = new Uint8Array(Math.min(size, capacity));
    let writeOffset = 0;
    for (const sector of chain) {
      const sourceOffset = sector * this.miniSectorSize;
      const length = Math.min(this.miniSectorSize, result.length - writeOffset);
      if (length <= 0) break;
      result.set(this.miniStreamBytes.subarray(sourceOffset, sourceOffset + length), writeOffset);
      writeOffset += length;
    }
    return result;
  }

  private writeMiniStream(startSector: number, data: Uint8Array): void {
    const chain = this.sectorChain(startSector, this.miniFat);
    const capacity = chain.length * this.miniSectorSize;
    if (data.length > capacity) {
      throw new Error(`Patched mini stream exceeds allocated CFB mini sectors (${data.length} > ${capacity}).`);
    }

    let readOffset = 0;
    for (const sector of chain) {
      const targetOffset = sector * this.miniSectorSize;
      const length = Math.min(this.miniSectorSize, data.length - readOffset);
      if (length > 0) {
        this.miniStreamBytes.set(data.subarray(readOffset, readOffset + length), targetOffset);
        readOffset += length;
      }
      if (length < this.miniSectorSize) {
        this.miniStreamBytes.fill(0, targetOffset + Math.max(length, 0), targetOffset + this.miniSectorSize);
      }
    }
  }

  private sectorChain(startSector: number, table: number[]): number[] {
    const chain: number[] = [];
    const seen = new Set<number>();
    let sector = startSector;
    while (isRealSector(sector)) {
      if (seen.has(sector)) throw new Error('CFB sector chain cycle detected.');
      if (sector >= table.length) throw new Error('CFB sector chain points outside the FAT.');
      seen.add(sector);
      chain.push(sector);
      sector = table[sector];
    }
    return chain;
  }

  private sectorOffset(sector: number): number {
    return (sector + 1) * this.sectorSize;
  }
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const Decompression = globalThis.DecompressionStream as unknown as CompressionStreamConstructor | undefined;
  if (!Decompression) throw new Error('이 브라우저는 HWP 압축 해제 API를 지원하지 않습니다.');
  const stream = new Blob([toArrayBuffer(bytes)]).stream().pipeThrough(new Decompression('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const Compression = globalThis.CompressionStream as unknown as CompressionStreamConstructor | undefined;
  if (!Compression) throw new Error('이 브라우저는 HWP 압축 API를 지원하지 않습니다.');
  const stream = new Blob([toArrayBuffer(bytes)]).stream().pipeThrough(new Compression('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function isRealSector(sector: number): boolean {
  return sector !== CFB_FREE_SECT && sector !== CFB_END_OF_CHAIN && sector !== CFB_FAT_SECT && sector !== 0xfffffffc;
}

function readU16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function writeU32(bytes: Uint8Array, offset: number, value: number): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(offset, value >>> 0, true);
}

function readUtf16Le(bytes: Uint8Array, start: number, end: number): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let value = '';
  for (let pos = start; pos + 1 < end; pos += 2) {
    value += String.fromCharCode(view.getUint16(pos, true));
  }
  return value;
}
