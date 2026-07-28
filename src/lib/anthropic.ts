import Anthropic from '@anthropic-ai/sdk';

const apiKey = process.env.ANTHROPIC_API_KEY;

if (!apiKey) {
  throw new Error('Missing ANTHROPIC_API_KEY. Copy .env.example to .env.local and fill it in.');
}

/**
 * Server-side only. Never import this from a client component — the spec
 * (Section 6) is explicit that the Anthropic API must not be called from the
 * browser in production.
 */
export const anthropic = new Anthropic({ apiKey });

export const MODEL = 'claude-sonnet-5';

/** Concatenate every text block in a response. */
export function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

/**
 * Pull a JSON object out of a model response that may be wrapped in prose or
 * a markdown fence. Used for the web-search call, where structured outputs
 * aren't available alongside the server tool.
 */
export function extractJson<T>(text: string): T {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`No JSON object found in model response: ${text.slice(0, 300)}`);
  }
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}
