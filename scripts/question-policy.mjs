import {
  classifyClosingObjection,
  getClosingQuestion,
} from './closing-questions.mjs';

function signature(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export class QuestionPolicy {
  constructor(state = {}) {
    this.askedQuestions = new Map(state.askedQuestions || []);
    this.unanswered = new Set(state.unanswered || []);
    this.lastQuestionAt = Number(state.lastQuestionAt || 0);
  }

  recordAsked(question, turn = 0) {
    const key = signature(question);
    if (!key) return false;
    this.askedQuestions.set(key, Number(turn || 0));
    this.unanswered.add(key);
    this.lastQuestionAt = Date.now();
    return true;
  }

  recordAnswered(question) {
    const key = signature(question);
    return key ? this.unanswered.delete(key) : false;
  }

  wasAsked(question) {
    return this.askedQuestions.has(signature(question));
  }

  isUnanswered(question) {
    return this.unanswered.has(signature(question));
  }

  selectNextQuestion(context = {}) {
    const objectionType =
      context.objectionType || classifyClosingObjection(context.lastSellerResponse || '');
    const category = objectionType
      ? 'reframe'
      : context.rejectionCount >= 3
        ? 'diagnostic'
        : context.phase === 'commitment'
          ? 'trialClose'
          : context.compareAlternatives
            ? 'compareAlternatives'
            : 'amplifyPain';
    const candidate = getClosingQuestion(category, {
      objectionType,
      seed: `${context.leadId || ''}:${context.turn || 0}:${category}`,
    });
    if (!this.wasAsked(candidate)) return candidate;

    const fallback = getClosingQuestion('diagnostic', {
      seed: `${context.leadId || ''}:${context.turn || 0}:fallback`,
    });
    return this.wasAsked(fallback)
      ? 'What is the most important thing I have not understood yet?'
      : fallback;
  }

  toJSON() {
    return {
      askedQuestions: [...this.askedQuestions.entries()],
      unanswered: [...this.unanswered],
      lastQuestionAt: this.lastQuestionAt,
    };
  }

  static fromJSON(value = {}) {
    return new QuestionPolicy(value);
  }
}
