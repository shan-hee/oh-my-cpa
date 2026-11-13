/**
 * The shape of one CPA request log file, read for display.
 *
 * CPA writes the file as `=== TITLE ===` sections: what the client sent, each attempt against the
 * upstream, and what went back. The layout is CPA's own and carries no contract, so a file that
 * does not open with a section heading parses to nothing and is shown as written.
 */

export type RequestLogSide = 'request' | 'response';

export type RequestLogBlock =
  | { kind: 'field'; name: string; value: string }
  | { kind: 'label'; text: string }
  /** A body or one stream event: the only lines long enough to need folding. */
  | { kind: 'payload'; label: string; text: string }
  | { kind: 'text'; text: string };

export interface RequestLogSection {
  title: string;
  side: RequestLogSide;
  blocks: RequestLogBlock[];
}

const SECTION_HEADING = /^=== (.+) ===$/;
const FIELD = /^([A-Za-z][A-Za-z0-9_-]*(?: [A-Za-z][A-Za-z0-9_-]*)*): (.*)$/;
const LABEL = /^([A-Za-z][A-Za-z ]*):$/;
const SSE_EVENT = 'event: ';
const SSE_DATA = 'data: ';

/** A string value this short and on one line reads as a field; anything longer is folded. */
const MAX_FIELD_STRING_CHARS = 200;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Names one entry of a body's list by what the protocols put there: a message's role, a tool's
 * name, or an item's type.
 */
function describeEntry(entry: unknown): string {
  if (!isPlainObject(entry)) return '';
  const fn = isPlainObject(entry.function) ? entry.function.name : undefined;
  const hint = [entry.role, entry.name, fn, entry.type].find((value) => typeof value === 'string' && value !== '');
  return typeof hint === 'string' ? ` ${hint}` : '';
}

/**
 * Splits a JSON body into its top-level members, so a long conversation reads one message at a
 * time: short scalars become fields, each list entry and each nested object its own payload.
 * Anything that is not an object, or does not parse, stays one payload.
 */
function splitJsonBody(line: string): RequestLogBlock[] {
  let body: unknown;
  try {
    body = JSON.parse(line);
  } catch {
    body = undefined;
  }
  if (!isPlainObject(body)) return [{ kind: 'payload', label: 'JSON', text: line }];

  const blocks: RequestLogBlock[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (Array.isArray(value) && value.length > 0) {
      value.forEach((entry, index) => {
        blocks.push({ kind: 'payload', label: `${key}[${index}]${describeEntry(entry)}`, text: JSON.stringify(entry) });
      });
    } else if (isPlainObject(value)) {
      blocks.push({ kind: 'payload', label: key, text: JSON.stringify(value) });
    } else if (typeof value === 'string' && (value.length > MAX_FIELD_STRING_CHARS || value.includes('\n'))) {
      blocks.push({ kind: 'payload', label: key, text: value });
    } else {
      blocks.push({ kind: 'field', name: key, value: typeof value === 'string' ? value : JSON.stringify(value) });
    }
  }
  return blocks;
}

function parseBlocks(lines: string[]): RequestLogBlock[] {
  const blocks: RequestLogBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    if (line.startsWith(SSE_EVENT) && lines[i + 1]?.startsWith(SSE_DATA)) {
      blocks.push({ kind: 'payload', label: line.slice(SSE_EVENT.length), text: lines[i + 1].slice(SSE_DATA.length) });
      i++;
      continue;
    }
    if (line.startsWith(SSE_DATA)) {
      blocks.push({ kind: 'payload', label: 'data', text: line.slice(SSE_DATA.length) });
      continue;
    }
    if (line.startsWith('{') || line.startsWith('[')) {
      blocks.push(...splitJsonBody(line));
      continue;
    }
    const label = LABEL.exec(line);
    if (label) {
      blocks.push({ kind: 'label', text: label[1] });
      continue;
    }
    const field = FIELD.exec(line);
    blocks.push(field ? { kind: 'field', name: field[1], value: field[2] } : { kind: 'text', text: line });
  }
  return blocks;
}

export function parseRequestLog(text: string): RequestLogSection[] {
  const lines = text.split(/\r?\n/);
  const first = lines.findIndex((line) => line.trim() !== '');
  if (first < 0 || !SECTION_HEADING.test(lines[first])) return [];

  const sections: RequestLogSection[] = [];
  let title = '';
  let body: string[] = [];
  const close = () => {
    if (title) sections.push({ title, side: title.includes('RESPONSE') ? 'response' : 'request', blocks: parseBlocks(body) });
  };
  for (const line of lines.slice(first)) {
    const heading = SECTION_HEADING.exec(line);
    if (heading) {
      close();
      title = heading[1];
      body = [];
    } else {
      body.push(line);
    }
  }
  close();
  return sections;
}

/** Indents a JSON payload; anything else, such as a stream's `[DONE]`, stays as written. */
export function formatLogPayload(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
