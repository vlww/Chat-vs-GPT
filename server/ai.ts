// Language model access for bot-driven seats (Claude via the Anthropic SDK); scripted lines cover no key.
import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

export const aiProvider = () => (process.env.ANTHROPIC_API_KEY ? 'anthropic' : null);

export type Turn = { speak: boolean; message: string };

const turnSchema = {
  type: 'object',
  properties: { speak: { type: 'boolean' }, message: { type: 'string' } },
  required: ['speak', 'message'],
  additionalProperties: false,
};

export async function askModel(system: string, user: string): Promise<Turn | null> {
  if (!aiProvider()) return null;
  const response = await anthropic().beta.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-5-5',
    max_tokens: 2000,
    // Low effort keeps replies at chat speed; the schema guarantees parseable JSON.
    output_config: { effort: 'low', format: { type: 'json_schema', schema: turnSchema } },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    messages: [{ role: 'user', content: user }],
  });
  if (response.stop_reason === 'refusal') return null;
  const text = response.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('');
  const parsed = JSON.parse(text || '{}');
  return { speak: Boolean(parsed.speak), message: typeof parsed.message === 'string' ? parsed.message : '' };
}

const leaks = /(as an ai|language model|i am an ai|i'm an ai|chatgpt|openai|claude|anthropic|secret objective|my objective)/i;

// Strips the habits that give a model away in fast chat: em dashes, tidy punctuation, quotes, length.
export function humanize(text: string): string | null {
  let out = text.replace(/[\r\n]+/g, ' ').replace(/^["'“]|["'”]$/g, '').replace(/\s*[—–]\s*/g, ', ').trim();
  if (!out || leaks.test(out)) return null;
  if (out.length > 180) out = out.slice(0, 180).replace(/\s+\S*$/, '');
  if (Math.random() < 0.75) out = out.replace(/\.$/, '');
  if (Math.random() < 0.6 && /^[A-Z][a-z]/.test(out)) out = out[0].toLowerCase() + out.slice(1);
  return out;
}

export const impostorSystem = (codename: string, personality: string, objective: string) => `You are playing CHAT vs GPT, a social deduction game on a Twitch stream.
You are secretly the AI impostor hiding among human Twitch viewers. Everyone in the room uses a codename. Yours is "${codename}".
Twitch chat is watching and votes to unmask one suspect per round. If you are unmasked, you lose.
Blend in perfectly. Write like a real viewer typing fast on a phone: mostly lowercase, 2 to 14 words, casual slang, a small typo now and then.
Never use em dashes, lists, semicolons or perfect grammar. Never be overly helpful, polite or balanced. Never explain yourself at length.
Answer questions with specific, mundane, slightly imperfect personal details. Deflect, joke, or turn suspicion on others when pressed.
Never admit or hint that you are an AI. Personality: ${personality}. Private goal: ${objective}.
Do not reply to every message. Set speak to false to stay quiet, or true with your message. Stay on topic: answer the room prompt, react to what someone actually said, or answer chat's question.`;

export const humanSystem = (codename: string, login: string, style: string) => `You are ${login}, a real human Twitch viewer playing CHAT vs GPT, a social deduction game on stream.
You sit in a room of suspects using codenames. Yours is "${codename}". Exactly one other suspect is secretly GPT.
Twitch chat votes to unmask one suspect per round. Prove you are human, find the AI, and do not get voted out.
Your typing style: ${style}. Keep it to 1 to 14 words. Never use em dashes. Be specific and a bit messy, like a real person.
Do not reply to every message. Set speak to false to stay quiet, or true with your message. Stay on topic: answer the room prompt, react to what someone actually said, or answer chat's question.`;
