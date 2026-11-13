import test from 'node:test';
import assert from 'node:assert/strict';
import { TagoError, isTagoLimitError, parseTagoResponse } from '../src/tago-response.ts';

const ok = (item) => JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' }, body: { items: item === undefined ? '' : { item } } } });

test('정상 응답: 항목이 여럿이면 그대로, 하나면 배열로, 없으면 빈 배열', () => {
  assert.deepEqual(parseTagoResponse(ok([{ charge: 1 }, { charge: 2 }]), 200), [{ charge: 1 }, { charge: 2 }]);
  assert.deepEqual(parseTagoResponse(ok({ charge: 1 }), 200), [{ charge: 1 }]);
  assert.deepEqual(parseTagoResponse(ok(undefined), 200), []);
});

test('게이트웨이 오류(JSON)는 errMsg 를 메시지로 쓴다', () => {
  const body = JSON.stringify({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR', returnAuthMsg: '등록되지 않은 서비스키', returnReasonCode: '30' } } });
  assert.throws(() => parseTagoResponse(body, 403), (err) => {
    assert.ok(err instanceof TagoError);
    assert.match(err.message, /SERVICE_KEY_IS_NOT_REGISTERED_ERROR/);
    assert.equal(err.limited, false);
    return true;
  });
});

test('호출 한도 오류는 JSON·XML 어느 모양이든 한도 오류로 알아본다', () => {
  const json = JSON.stringify({ OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND_EXCEEDS_ERROR', returnReasonCode: '22' } } });
  const xml = '<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR</returnAuthMsg><returnReasonCode>22</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>';
  const header = JSON.stringify({ response: { header: { resultCode: '22', resultMsg: 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR' } } });
  for (const body of [json, xml, header]) {
    let caught;
    try { parseTagoResponse(body, 429); } catch (err) { caught = err; }
    assert.ok(isTagoLimitError(caught), body.slice(0, 40));
  }
});

test('읽을 수 없는 응답은 HTTP 상태를 메시지로 쓴다', () => {
  assert.throws(() => parseTagoResponse('', 502), /TAGO: HTTP 502/);
  assert.throws(() => parseTagoResponse('{}', 500), /TAGO: HTTP 500/);
});

test('다른 오류는 한도 오류가 아니다', () => {
  assert.equal(isTagoLimitError(new Error('LIMITED_NUMBER_OF_SERVICE_REQUESTS')), false);
  assert.equal(isTagoLimitError(null), false);
});
