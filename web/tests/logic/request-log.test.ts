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
    { kind: 'field', name: 'model', value: 'm' },
  ]);
  // A stream event folds its name and data into one payload; a bare data line stands alone.
  assert.deepEqual(sections[3].blocks, [
    { kind: 'field', name: 'Status', value: '200' },
    { kind: 'payload', label: 'response.created', text: '{"type":"response.created"}' },
    { kind: 'payload', label: 'data', text: '[DONE]' },
  ]);
});

test('a JSON body splits into its members, one list entry at a time', () => {
  const system = 'You are a coding agent.\nBe brief.';
  const body = {
    model: 'm',
    max_tokens: 1024,
    system,
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    ],
    tools: [{ name: 'Bash' }, { type: 'function', function: { name: 'read' } }, 'bare'],
    thinking: { type: 'enabled' },
    stop_sequences: [],
  };
  const [section] = parseRequestLog(`=== REQUEST BODY ===\n${JSON.stringify(body)}`);
  assert.deepEqual(section.blocks, [
    { kind: 'field', name: 'model', value: 'm' },
    { kind: 'field', name: 'max_tokens', value: '1024' },
    { kind: 'payload', label: 'system', text: system },
    { kind: 'payload', label: 'messages[0] user', text: '{"role":"user","content":"hi"}' },
    { kind: 'payload', label: 'messages[1] assistant', text: JSON.stringify(body.messages[1]) },
    { kind: 'payload', label: 'tools[0] Bash', text: '{"name":"Bash"}' },
    { kind: 'payload', label: 'tools[1] read', text: JSON.stringify(body.tools[1]) },
    { kind: 'payload', label: 'tools[2]', text: '"bare"' },
    { kind: 'payload', label: 'thinking', text: '{"type":"enabled"}' },
    { kind: 'field', name: 'stop_sequences', value: '[]' },
  ]);
  // A top-level list or a truncated body has no members to split.
  assert.deepEqual(parseRequestLog('=== RESPONSE ===\n[1,2]')[0].blocks, [{ kind: 'payload', label: 'JSON', text: '[1,2]' }]);
  assert.deepEqual(parseRequestLog('=== RESPONSE ===\n{"a":')[0].blocks, [{ kind: 'payload', label: 'JSON', text: '{"a":' }]);
});

test('a file without section headings is left for raw display', () => {
  assert.deepEqual(parseRequestLog('plain error text\n=== LATER ===\n'), []);
  assert.deepEqual(parseRequestLog(''), []);
});

test('only JSON payloads are reformatted', () => {
  assert.equal(formatLogPayload('{"a":[1]}'), '{\n  "a": [\n    1\n  ]\n}');
  assert.equal(formatLogPayload('[DONE'), '[DONE');
});
