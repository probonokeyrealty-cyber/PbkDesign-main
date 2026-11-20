import { buyerView } from './domain.mjs';
import { readLimitedBody } from './bodyLimit.mjs';

const questions = new Map([
  ['due-diligence', 'What should I verify first before deciding whether to pursue this property?'],
  ['rental', 'What inputs and due diligence would I need to evaluate this as a rental?'],
  ['renovation', 'What should I validate before evaluating a renovation and resale?'],
  ['wholesale', 'What should I verify before evaluating this as a wholesale opportunity?'],
]);

export function consultationInput(state, payload) {
  const { id, version, topic } = payload;
  if (
    typeof id !== 'string' ||
    !Object.hasOwn(state.properties, id) ||
    !Number.isSafeInteger(version) ||
    !questions.has(topic) ||
    Object.keys(payload).some((key) => !['id', 'version', 'topic'].includes(key))
  ) {
    throw Object.assign(Error('Choose a question for an available property packet.'), {
      status: 400,
    });
  }
  const packet = buyerView(state.properties[id]);
  if (packet.version !== version) {
    throw Object.assign(Error('The packet changed. Reopen it before requesting a consultation.'), {
      status: 409,
    });
  }
  const facts = Object.fromEntries(
    ['beds', 'baths', 'sqft', 'lotSqft', 'askingCents', 'rehabCents', 'arvCents'].map((key) => {
      const value = packet[key];
      return [
        key,
        typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null,
      ];
    })
  );
  if (packet.priceOnRequest) facts.askingCents = null;
  return {
    question: questions.get(topic),
    facts: {
      ...facts,
      fictional: packet.fictional === true,
      checkedAt: /^\d{4}-\d{2}-\d{2}$/.test(packet.checkedAt) ? packet.checkedAt : null,
    },
  };
}

export function reserveConsultation(state, uid, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  if (state.consultationUsage?.day !== day) state.consultationUsage = { day, users: {}, total: 0 };
  const usage = state.consultationUsage;
  if (usage.total >= 60 || (usage.users[uid] ?? 0) >= 6) {
    throw Object.assign(Error('Today’s consultation limit has been reached. Try again tomorrow.'), {
      status: 429,
    });
  }
  usage.users[uid] = (usage.users[uid] ?? 0) + 1;
  usage.total += 1;
}

export async function consultProperty({ key, model, input }) {
  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(14000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: 700,
        thinking: { type: 'disabled' },
        messages: [
          {
            role: 'system',
            content:
              'You are a real estate due diligence assistant. Answer with a short takeaway, missing information, and three practical verification steps. Treat supplied facts as a limited property packet. Cents are USD cents. Rehab and ARV are estimates. Null means unknown. Never invent comps, market conditions, financing terms, costs or returns. If fictional, label it a practice scenario. Do not give an offer amount, legal advice, or a buy/sell recommendation. Respond as plain text.',
          },
          { role: 'user', content: JSON.stringify(input) },
        ],
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw Error('Provider unavailable');
    }
    const data = JSON.parse(new TextDecoder().decode(await readLimitedBody(response, 64_000)));
    const answer = data?.choices?.[0]?.message?.content;
    if (typeof answer !== 'string' || !answer.trim() || answer.length > 5000)
      throw Error('Invalid answer');
    return answer.trim();
  } catch {
    throw Object.assign(
      Error('DeepSeek could not complete this consultation. Please try again later.'),
      { status: 502 }
    );
  }
}
