// @ts-nocheck
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createBobStreamHandler } from '../src/bob-stream.js';

function parseLines(lines) {
  const events = [];
  const handler = createBobStreamHandler((event) => events.push(event));
  for (const line of lines) {
    handler.feed(`${line}\n`);
  }
  handler.flush();
  return events;
}

test('bob stream parser maps init event to status', () => {
  const events = parseLines([
    JSON.stringify({
      type: 'init',
      model: 'claude-3-5-sonnet-20241022',
      session_id: 'session-abc123',
    }),
  ]);

  assert.deepEqual(events, [
    {
      type: 'status',
      label: 'initializing',
      model: 'claude-3-5-sonnet-20241022',
      sessionId: 'session-abc123',
    },
  ]);
});

test('bob stream parser handles init event without model or session_id', () => {
  const events = parseLines([
    JSON.stringify({
      type: 'init',
    }),
  ]);

  assert.deepEqual(events, [
    {
      type: 'status',
      label: 'initializing',
      model: null,
      sessionId: null,
    },
  ]);
});

test('bob stream parser maps assistant message to text_delta', () => {
  const events = parseLines([
    JSON.stringify({
      type: 'message',
      role: 'assistant',
      content: 'Hello, how can I help you?',
    }),
  ]);

  assert.deepEqual(events, [
    {
      type: 'text_delta',
      delta: 'Hello, how can I help you?',
    },
  ]);
});

test('bob stream parser ignores message events without assistant role', () => {
  const events = parseLines([
    JSON.stringify({
      type: 'message',
      role: 'user',
      content: 'Hello',
    }),
  ]);

  assert.deepEqual(events, []);
});

test('bob stream parser ignores message events without content', () => {
  const events = parseLines([
    JSON.stringify({
      type: 'message',
      role: 'assistant',
    }),
  ]);

  assert.deepEqual(events, []);
});

test('bob stream parser maps tool_use event correctly', () => {
  const events = parseLines([
    JSON.stringify({
      type: 'tool_use',
      tool_id: 'tool-123',
      tool_name: 'read_file',
      parameters: {
        path: 'src/app.ts',
      },
    }),
  ]);

  assert.deepEqual(events, [
    {
      type: 'tool_use',
      id: 'tool-123',
      name: 'read_file',
      input: {
        path: 'src/app.ts',
      },
    },
  ]);
});

test('bob stream parser handles tool_use without parameters', () => {
  const events = parseLines([
    JSON.stringify({
      type: 'tool_use',
      tool_id: 'tool-456',
      tool_name: 'list_files',
    }),
  ]);

  assert.deepEqual(events, [
    {
      type: 'tool_use',
      id: 'tool-456',
      name: 'list_files',
      input: {},
    },
  ]);
});

test('bob stream parser maps successful tool_result event', () => {
  const events = parseLines([
    JSON.stringify({
      type: 'tool_result',
      tool_id: 'tool-123',
      status: 'success',
      output: 'File contents here',
    }),
  ]);

  assert.deepEqual(events, [
    {
      type: 'tool_result',
      toolUseId: 'tool-123',
      content: 'File contents here',
      isError: false,
    },
  ]);
});

test('bob stream parser maps failed tool_result event', () => {
  const events = parseLines([
    JSON.stringify({
      type: 'tool_result',
      tool_id: 'tool-456',
      status: 'error',
      output: 'File not found',
    }),
  ]);

  assert.deepEqual(events, [
    {
      type: 'tool_result',
      toolUseId: 'tool-456',
      content: 'File not found',
      isError: true,
    },
  ]);
});

test('bob stream parser handles tool_result without output', () => {
  const events = parseLines([
    JSON.stringify({
      type: 'tool_result',
      tool_id: 'tool-789',
      status: 'success',
    }),
  ]);

  assert.deepEqual(events, [
    {
      type: 'tool_result',
      toolUseId: 'tool-789',
      content: '',
      isError: false,
    },
  ]);
});

test('bob stream parser maps result event with stats to usage', () => {
  const events = parseLines([
    JSON.stringify({
      type: 'result',
      status: 'success',
      stats: {
        input_tokens: 150,
        output_tokens: 75,
        total_tokens: 225,
        duration_ms: 1234,
      },
    }),
  ]);

  assert.deepEqual(events, [
    {
      type: 'usage',
      usage: {
        input_tokens: 150,
        output_tokens: 75,
        total_tokens: 225,
      },
      durationMs: 1234,
    },
  ]);
});

test('bob stream parser handles result with partial stats', () => {
  const events = parseLines([
    JSON.stringify({
      type: 'result',
      status: 'success',
      stats: {
        input_tokens: 100,
        output_tokens: 50,
      },
    }),
  ]);

  assert.deepEqual(events, [
    {
      type: 'usage',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
      },
      durationMs: undefined,
    },
  ]);
});

test('bob stream parser ignores result without stats', () => {
  const events = parseLines([
    JSON.stringify({
      type: 'result',
      status: 'success',
    }),
  ]);

  assert.deepEqual(events, []);
});

test('bob stream parser ignores result with non-success status', () => {
  const events = parseLines([
    JSON.stringify({
      type: 'result',
      status: 'error',
      stats: {
        input_tokens: 100,
        output_tokens: 50,
      },
    }),
  ]);

  assert.deepEqual(events, []);
});

test('bob stream parser handles incomplete JSON lines in buffer', () => {
  const events = [];
  const handler = createBobStreamHandler((event) => events.push(event));
  
  // Feed partial JSON
  handler.feed('{"type":"message","role":"assi');
  assert.deepEqual(events, []);
  
  // Complete the JSON
  handler.feed('stant","content":"Hello"}\n');
  assert.deepEqual(events, [
    {
      type: 'text_delta',
      delta: 'Hello',
    },
  ]);
});

test('bob stream parser handles multiple events in single chunk', () => {
  const events = [];
  const handler = createBobStreamHandler((event) => events.push(event));
  
  const chunk = [
    JSON.stringify({ type: 'init', model: 'claude-3', session_id: 's1' }),
    JSON.stringify({ type: 'message', role: 'assistant', content: 'Hi' }),
    JSON.stringify({ type: 'message', role: 'assistant', content: ' there' }),
  ].join('\n') + '\n';
  
  handler.feed(chunk);
  
  assert.deepEqual(events, [
    {
      type: 'status',
      label: 'initializing',
      model: 'claude-3',
      sessionId: 's1',
    },
    {
      type: 'text_delta',
      delta: 'Hi',
    },
    {
      type: 'text_delta',
      delta: ' there',
    },
  ]);
});

test('bob stream parser flushes remaining buffer on flush', () => {
  const events = [];
  const handler = createBobStreamHandler((event) => events.push(event));
  
  // Feed without newline
  handler.feed(JSON.stringify({
    type: 'message',
    role: 'assistant',
    content: 'Final message',
  }));
  
  assert.deepEqual(events, []);
  
  // Flush should process the remaining buffer
  handler.flush();
  
  assert.deepEqual(events, [
    {
      type: 'text_delta',
      delta: 'Final message',
    },
  ]);
});

test('bob stream parser handles empty lines gracefully', () => {
  const events = parseLines([
    '',
    JSON.stringify({ type: 'message', role: 'assistant', content: 'Hello' }),
    '',
    '',
    JSON.stringify({ type: 'message', role: 'assistant', content: 'World' }),
    '',
  ]);

  assert.deepEqual(events, [
    { type: 'text_delta', delta: 'Hello' },
    { type: 'text_delta', delta: 'World' },
  ]);
});

test('bob stream parser forwards malformed JSON as raw events', () => {
  const events = parseLines([
    'not valid json',
    '{"incomplete": ',
  ]);

  assert.deepEqual(events, [
    { type: 'raw', line: 'not valid json' },
    { type: 'raw', line: '{"incomplete":' },
  ]);
});

test('bob stream parser forwards unknown event types as raw events', () => {
  const events = parseLines([
    JSON.stringify({
      type: 'unknown_event',
      data: 'some data',
    }),
  ]);

  assert.deepEqual(events, [
    {
      type: 'raw',
      line: JSON.stringify({
        type: 'unknown_event',
        data: 'some data',
      }),
    },
  ]);
});

test('bob stream parser handles null or non-object events', () => {
  const events = [];
  const handler = createBobStreamHandler((event) => events.push(event));
  
  handler.feed('null\n');
  handler.feed('"string"\n');
  handler.feed('123\n');
  
  // null, strings, and numbers should be silently ignored (handleEvent returns early)
  assert.deepEqual(events, []);
});

test('bob stream parser forwards array events as raw', () => {
  const events = [];
  const handler = createBobStreamHandler((event) => events.push(event));
  
  handler.feed('[]\n');
  handler.feed('[1, 2, 3]\n');
  
  // Arrays are objects in JavaScript, so they go to the default case
  assert.deepEqual(events, [
    { type: 'raw', line: '[]' },
    { type: 'raw', line: '[1,2,3]' },
  ]);
});

test('bob stream parser handles complex streaming scenario', () => {
  const events = [];
  const handler = createBobStreamHandler((event) => events.push(event));
  
  // Simulate a realistic Bob CLI session
  handler.feed(JSON.stringify({ type: 'init', model: 'claude-3-5-sonnet', session_id: 'sess-1' }) + '\n');
  handler.feed(JSON.stringify({ type: 'message', role: 'assistant', content: 'I will help you' }) + '\n');
  handler.feed(JSON.stringify({ type: 'tool_use', tool_id: 't1', tool_name: 'read_file', parameters: { path: 'test.ts' } }) + '\n');
  handler.feed(JSON.stringify({ type: 'tool_result', tool_id: 't1', status: 'success', output: 'file content' }) + '\n');
  handler.feed(JSON.stringify({ type: 'message', role: 'assistant', content: 'Here is the analysis' }) + '\n');
  handler.feed(JSON.stringify({ type: 'result', status: 'success', stats: { input_tokens: 200, output_tokens: 100, total_tokens: 300, duration_ms: 5000 } }) + '\n');
  
  assert.deepEqual(events, [
    { type: 'status', label: 'initializing', model: 'claude-3-5-sonnet', sessionId: 'sess-1' },
    { type: 'text_delta', delta: 'I will help you' },
    { type: 'tool_use', id: 't1', name: 'read_file', input: { path: 'test.ts' } },
    { type: 'tool_result', toolUseId: 't1', content: 'file content', isError: false },
    { type: 'text_delta', delta: 'Here is the analysis' },
    { type: 'usage', usage: { input_tokens: 200, output_tokens: 100, total_tokens: 300 }, durationMs: 5000 },
  ]);
});

test('bob stream parser handles flush with malformed JSON in buffer', () => {
  const events = [];
  const handler = createBobStreamHandler((event) => events.push(event));
  
  handler.feed('{"incomplete": ');
  handler.flush();
  
  assert.deepEqual(events, [
    { type: 'raw', line: '{"incomplete":' },
  ]);
});

test('bob stream parser handles flush with empty buffer', () => {
  const events = [];
  const handler = createBobStreamHandler((event) => events.push(event));
  
  handler.flush();
  assert.deepEqual(events, []);
  
  handler.feed('   \n');
  handler.flush();
  assert.deepEqual(events, []);
});