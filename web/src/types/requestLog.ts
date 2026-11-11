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
      blocks.push({ kind: 'payload', label: 'JSON', text: line });
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
