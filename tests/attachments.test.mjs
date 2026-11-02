import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyAttachmentLines,
  attachmentIndent,
  attachmentLines,
  hasAttachmentItem,
  parseAttachmentItems,
  toggleAttachmentItem,
} from '../src/attachments.ts';

test('첨부서류는 줄바꿈·쉼표로 나누고 금액의 천 단위 쉼표는 나누지 않는다', () => {
  assert.deepEqual(parseAttachmentItems('주유영수증 1부\n하이패스영수증 1부'), ['주유영수증 1부', '하이패스영수증 1부']);
  assert.deepEqual(parseAttachmentItems('주유영수증 1매, 하이패스영수증 1매'), ['주유영수증 1매', '하이패스영수증 1매']);
  assert.deepEqual(parseAttachmentItems('통행료 영수증 3,500원 1부'), ['통행료 영수증 3,500원 1부']);
  assert.deepEqual(parseAttachmentItems('  \n\n'), []);
});

test('마지막 줄 끝에 두 칸 띄우고 끝. 을 붙인다', () => {
  assert.deepEqual(attachmentLines('출장신청서 1부'), ['출장신청서 1부  끝.']);
  assert.deepEqual(attachmentLines('주유영수증 1부\n출장신청서 1부'), ['주유영수증 1부', '출장신청서 1부  끝.']);
  assert.deepEqual(attachmentLines(''), []);
});

test('직접 적은 끝. 은 두 번 붙지 않는다', () => {
  assert.deepEqual(attachmentLines('주유영수증 1부\n출장신청서 1부  끝.'), ['주유영수증 1부', '출장신청서 1부  끝.']);
  assert.deepEqual(attachmentLines('주유영수증 1부\n끝.'), ['주유영수증 1부  끝.']);
});

test('칩 토글은 한 줄에 하나씩 더하고 뺀다', () => {
  let value = toggleAttachmentItem('', '주유영수증 1부');
  value = toggleAttachmentItem(value, '출장신청서 1부');
  assert.equal(value, '주유영수증 1부\n출장신청서 1부');
  assert.equal(hasAttachmentItem(value, '출장신청서 1부'), true);
  assert.equal(toggleAttachmentItem(value, '주유영수증 1부'), '출장신청서 1부');
});

test('들여쓰기는 누름틀 앞 글자 너비만큼 — 한글은 공백 두 칸', () => {
  assert.equal(attachmentIndent('첨부: '), ' '.repeat(6));
  assert.equal(attachmentIndent('첨 부  '), ' '.repeat(7));
});

/** 셀 하나를 문단 배열로 흉내 낸 가짜 브리지. 첨부서류 누름틀은 fieldPara 문단의 prefix 뒤 전체. */
function fakeCell(paragraphs, fieldPara, value) {
  const paras = [...paragraphs];
  return {
    paras,
    getFieldList: () => [{ fieldId: 3, value, location: { sectionIndex: 0, paraIndex: 6, path: [{ paraIndex: fieldPara, controlIndex: 0, cellIndex: 70 }] } }],
    getCellParagraphCount: () => paras.length,
    getCellParagraphLength: (s, p, c, i, cp) => paras[cp].length,
    getTextInCell: (s, p, c, i, cp, off, n) => paras[cp].slice(off, off + n),
    deleteTextInCell: (s, p, c, i, cp, off, n) => { paras[cp] = paras[cp].slice(0, off) + paras[cp].slice(off + n); },
    mergeParagraphInCell: (s, p, c, i, cp) => { paras[cp - 1] += paras[cp]; paras.splice(cp, 1); },
    splitParagraphInCell: (s, p, c, i, cp, off) => { paras.splice(cp + 1, 0, paras[cp].slice(off)); paras[cp] = paras[cp].slice(0, off); },
    insertTextInCell: (s, p, c, i, cp, off, text) => { paras[cp] = paras[cp].slice(0, off) + text + paras[cp].slice(off); },
  };
}

const FORM = ['정산을 신청합니다.', '', '첨부: 주유영수증 1부', '', '2026. 11. 02.', '', '                     신 청 인   성 명    (인)'];

test('둘째 줄부터 누름틀 아래에 첫 문서와 줄을 맞춰 넣는다', () => {
  const w = fakeCell(FORM, 2, '주유영수증 1부');
  const lines = attachmentLines('주유영수증 1부\n하이패스영수증 1부\n출장신청서 1부');
  assert.equal(applyAttachmentLines(w, 3, lines), true);
  assert.deepEqual(w.paras.slice(2, 6), [
    '첨부: 주유영수증 1부',
    '      하이패스영수증 1부',
    '      출장신청서 1부  끝.',
    '',
  ]);
  assert.deepEqual(w.paras.slice(-3), FORM.slice(-3));
});

test('다시 적용하면 이전 줄을 지우고 새 줄만 남긴다 — 양식의 빈 문단·신청인 줄은 그대로', () => {
  const w = fakeCell(FORM, 2, '주유영수증 1부');
  applyAttachmentLines(w, 3, ['주유영수증 1부', '하이패스영수증 1부', '출장신청서 1부  끝.']);
  applyAttachmentLines(w, 3, ['주유영수증 1부', '출장신청서 1부  끝.']);
  assert.deepEqual(w.paras, ['정산을 신청합니다.', '', '첨부: 주유영수증 1부', '      출장신청서 1부  끝.', '', '2026. 11. 02.', '', FORM[6]]);
  applyAttachmentLines(w, 3, []);
  assert.deepEqual(w.paras, FORM);
});

test('첨부서류 누름틀을 찾지 못하면 아무것도 하지 않는다', () => {
  const w = fakeCell(FORM, 2, '');
  assert.equal(applyAttachmentLines(w, undefined, ['a', 'b']), false);
  assert.deepEqual(w.paras, FORM);
});
