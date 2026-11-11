import assert from 'node:assert/strict';
import { test } from 'vitest';

import { formatLogPayload, parseRequestLog } from '../../src/types/requestLog.ts';

const LOG = [
  '=== REQUEST INFO ===',
  'URL: /v1/responses',
  'Downstream Transport: http',
  '',
  '=== REQUEST BODY ===',
  '{"model":"m","stream":true}',
  '',
  '=== API REQUEST 1 ===',
  'Headers:',
  'Accept: text/event-stream',
  'Body:',
  '{"model":"m"}',
  '=== API RESPONSE 1 ===',
  'Status: 200',
  'event: response.created',
  'data: {"type":"response.created"}',
  '',
  'data: [DONE]',
  '=== RESPONSE ===',
  'Status: 200',
].join('\n');

test('a request log splits into request and response sections', () => {
  const sections = parseRequestLog(LOG);
  assert.deepEqual(
    sections.map((section) => [section.title, section.side]),
    [
      ['REQUEST INFO', 'request'],
      ['REQUEST BODY', 'request'],
      ['API REQUEST 1', 'request'],
      ['API RESPONSE 1', 'response'],
      ['RESPONSE', 'response'],
    ],
  );
  assert.deepEqual(sections[0].blocks, [
    { kind: 'field', name: 'URL', value: '/v1/responses' },
    { kind: 'field', name: 'Downstream Transport', value: 'http' },
  ]);
  assert.deepEqual(sections[2].blocks, [
    { kind: 'label', text: 'Headers' },
    { kind: 'field', name: 'Accept', value: 'text/event-stream' },
    { kind: 'label', text: 'Body' },
    { kind: 'payload', label: 'JSON', text: '{"model":"m"}' },
  ]);
  // A stream event folds its name and data into one payload; a bare data line stands alone.
  assert.deepEqual(sections[3].blocks, [
    { kind: 'field', name: 'Status', value: '200' },
    { kind: 'payload', label: 'response.created', text: '{"type":"response.created"}' },
    { kind: 'payload', label: 'data', text: '[DONE]' },
  ]);
});

test('a file without section headings is left for raw display', () => {
  assert.deepEqual(parseRequestLog('plain error text\n=== LATER ===\n'), []);
  assert.deepEqual(parseRequestLog(''), []);
});

test('only JSON payloads are reformatted', () => {
  assert.equal(formatLogPayload('{"a":[1]}'), '{\n  "a": [\n    1\n  ]\n}');
  assert.equal(formatLogPayload('[DONE'), '[DONE');
});
