import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tripNameLine, isTripNameLine, applyTripNameLine } from '../src/trip-name.ts';

test('출장명 줄 문구', () => {
  assert.equal(tripNameLine('제31회 체육대회 지원'), '[출장명 : 제31회 체육대회 지원]');
  assert.equal(tripNameLine('  연수  '), '[출장명 : 연수]');
  assert.equal(tripNameLine(''), '');
  assert.equal(tripNameLine('   '), '');
});

test('이 도구가 넣은 줄(출장명 줄·빈 줄)만 지울 대상으로 본다', () => {
  assert.equal(isTripNameLine('[출장명 : 연수]'), true);
  assert.equal(isTripNameLine(''), true);
  assert.equal(isTripNameLine('  '), true);
  assert.equal(isTripNameLine('양식에 원래 있던 문단'), false);
});

/** 셀 하나를 문단 배열로 흉내 낸 가짜 브리지. 출장지 누름틀은 0번 문단 전체. */
function fakeCell(paragraphs) {
  const paras = [...paragraphs];
  const key = (sec, pp, ctrl, cell) => `${sec}/${pp}/${ctrl}/${cell}`;
  const calls = [];
  return {
    paras,
    calls,
    getFieldList: () => [{ fieldId: 7, location: { sectionIndex: 0, paraIndex: 7, path: [{ paraIndex: 0, controlIndex: 0, cellIndex: 10 }] } }],
    getCellParagraphCount: (...a) => { assert.equal(key(...a), '0/7/0/10'); return paras.length; },
    getCellParagraphLength: (s, p, c, i, cp) => paras[cp].length,
    getTextInCell: (s, p, c, i, cp, off, n) => paras[cp].slice(off, off + n),
    deleteTextInCell: (s, p, c, i, cp, off, n) => { calls.push(['delete', cp]); paras[cp] = paras[cp].slice(0, off) + paras[cp].slice(off + n); },
    mergeParagraphInCell: (s, p, c, i, cp) => { calls.push(['merge', cp]); paras[cp - 1] += paras[cp]; paras.splice(cp, 1); },
    splitParagraphInCell: (s, p, c, i, cp, off) => { calls.push(['split', cp, off]); paras.splice(cp + 1, 0, paras[cp].slice(off)); paras[cp] = paras[cp].slice(0, off); },
    insertTextInCell: (s, p, c, i, cp, off, text) => { calls.push(['insert', cp]); paras[cp] = paras[cp].slice(0, off) + text + paras[cp].slice(off); },
  };
}

test('출장명이 있으면 누름틀 문단 뒤 새 문단에 [출장명 : …] 을 넣는다', () => {
  const w = fakeCell(['강원대학교 삼척캠퍼스']);
  assert.equal(applyTripNameLine(w, 7, '체육대회 지원'), true);
  assert.deepEqual(w.paras, ['강원대학교 삼척캠퍼스', '[출장명 : 체육대회 지원]']);
});

test('다시 적용하면 이전 출장명 줄을 지우고 새 줄 하나만 남긴다', () => {
  const w = fakeCell(['강원대학교 삼척캠퍼스', '[출장명 : 이전 출장명]']);
  applyTripNameLine(w, 7, '새 출장명');
  assert.deepEqual(w.paras, ['강원대학교 삼척캠퍼스', '[출장명 : 새 출장명]']);
  applyTripNameLine(w, 7, '');
  assert.deepEqual(w.paras, ['강원대학교 삼척캠퍼스']);
});

test('양식에 원래 있던 다른 문단은 지우지 않는다', () => {
  const w = fakeCell(['장소', '양식 고정 문단', '[출장명 : 이전]']);
  applyTripNameLine(w, 7, '새 출장명');
  assert.deepEqual(w.paras, ['장소', '[출장명 : 새 출장명]', '양식 고정 문단']);
});

test('출장지 누름틀을 찾지 못하면 아무것도 하지 않는다', () => {
  const w = fakeCell(['장소']);
  assert.equal(applyTripNameLine(w, undefined, '출장명'), false);
  assert.equal(applyTripNameLine(w, 99, '출장명'), false);
  assert.deepEqual(w.paras, ['장소']);
});
