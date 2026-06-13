export const AVA_LIVE_TURN_CONTRACT_REVISION = '2026-06-13-a-plus-turn-contract-v1';

function clean(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function lower(value = '') {
  return clean(value).toLowerCase();
}

function unique(values = []) {
  return [...new Set(values.map((value) => clean(value)).filter(Boolean))];
}

function normalizeQuestionCategory(value = '') {
  const normalized = lower(value).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const aliases = {
    address: 'full_address',
    property_address: 'full_address',
    role: 'authority',
    owner: 'authority',
    number: 'target_price',
    price: 'target_price',
    net: 'target_price',
    repair: 'condition',
    repairs: 'condition',
  };
  return aliases[normalized] || normalized;
}

function questionCategoryFromText(text = '') {
  const value = lower(text);
  if (!value) return '';
  if (/\b(full )?(street )?address|what property|where is (?:it|the property)|pull (?:it|this) up\b/.test(value)) {
    return 'full_address';
  }
  if (/\b(owner|agent|decision|authority|authorized|sign|executor|spouse|partner)\b/.test(value)) {
    return 'authority';
  }
  if (/\b(number|price|net|walk away|pay|offer|target|asking)\b/.test(value)) {
    return 'target_price';
  }
  if (/\b(condition|repair|roof|hvac|foundation|tenant|vacant|occupied|cleanout)\b/.test(value)) {
    return 'condition';
  }
  if (/\b(timeline|close|days|weeks|months|asap|quick|fast|soon)\b/.test(value)) {
    return 'timeline';
  }
  if (/\b(why|reason|motivat|selling|considering)\b/.test(value)) {
    return 'pain';
  }
  if (/\b(proof|trust|comfortable|legit|verify)\b/.test(value)) {
    return 'trust_proof';
  }
  return '';
}

function extractMoney(text = '') {
  const value = String(text || '');
  const moneyContext =
    /\b(asking|ask|price|offer|pay|paid|cash|net|walk away|need|want|looking for|hoping for|take|accept|worth|owed|payoff|mortgage|loan balance|bottom line|target|number)\b/i.test(
      value
    );
  if (!moneyContext && !/\b\d{2,3}\s*(?:k|thousand|grand|m|million)\b/i.test(value)) return '';
  if (/\b(street|st|drive|dr|road|rd|avenue|ave|lane|ln|boulevard|blvd|court|ct|circle|cir|way|zip|postal|phone|number is)\b/i.test(value)) {
    return '';
  }
  const match = value.match(/\$?\s?(\d{2,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k|thousand|grand|m|million)?\b/i);
  if (!match) return '';
  const suffix = lower(match[2] || '');
  const number = String(match[1] || '').replace(/\s+/g, '');
  if (['k', 'm'].includes(suffix)) return `${number}${suffix}`;
  return `${number}${suffix ? ` ${suffix}` : ''}`.trim();
}

function extractFullAddress(text = '') {
  const value = clean(text);
  const match = value.match(/\b(\d{2,6}\s+[A-Za-z0-9 .'-]{2,60}\s+(?:street|st|drive|dr|road|rd|avenue|ave|lane|ln|boulevard|blvd|court|ct|circle|cir|way|place|pl))\b/i);
  return match?.[1] ? clean(match[1]) : '';
}

function extractPartialAddress(text = '') {
  const value = lower(text);
  const propertyIn = value.match(/\bproperty\s+(?:is\s+)?in\s+([a-z][a-z\s]{2,40}?)(?:\s+\b(?:and|but|with|near|around)\b|[.?!]|$)/i);
  if (propertyIn?.[1]) return `Property in ${clean(propertyIn[1]).toLowerCase()}`;
  const regionOnly = value.match(/\b(?:in|around|near)\s+([a-z][a-z\s]{2,28}?)(?:\s+\b(?:and|but|with)\b|[.?!]|$)/i);
  if (regionOnly?.[1] && /\b(property|house|home|land|lot)\b/i.test(value)) {
    return `Property in ${clean(regionOnly[1]).toLowerCase()}`;
  }
  return '';
}

function extractCondition(text = '') {
  const value = clean(text);
  const patterns = [
    /\b(roof[^.?!,;]{0,60})/i,
    /\b(hvac[^.?!,;]{0,60})/i,
    /\b(foundation[^.?!,;]{0,60})/i,
    /\b(tenant[^.?!,;]{0,60})/i,
    /\b(vacant[^.?!,;]{0,60})/i,
    /\b(occupied[^.?!,;]{0,60})/i,
    /\b(needs? (?:work|repairs?)[^.?!,;]{0,60})/i,
    /\b(as[-\s]?is[^.?!,;]{0,60})/i,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return clean(match[1]);
  }
  return '';
}

function extractTimeline(text = '') {
  const value = clean(text);
  const match = value.match(
    /\b(asap|soon|quickly|fast|this week|next week|\d+\s*(?:days?|weeks?|months?)|by\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|by\s+[A-Za-z]+\s+\d{1,2})\b/i
  );
  return match?.[0] ? clean(match[0]) : '';
}

function extractPain(text = '') {
  const value = clean(text);
  const match = value.match(/\b(?:because|reason is|main reason|trying to|need to|want to)\s+([^.!?]{4,100})/i);
  if (match?.[1]) return clean(match[1]);
  if (/\b(probate|inherited|foreclosure|behind|tenant|repairs?|tired landlord|divorce|vacant)\b/i.test(value)) {
    return clean(value.slice(0, 120));
  }
  return '';
}

function inferAuthority(text = '') {
  const value = lower(text);
  if (/\b(i am|i'm|im|i own|my house|my property|owner|seller)\b/.test(value)) return 'owner';
  if (/\b(agent|realtor|broker|representing|my client)\b/.test(value)) return 'agent';
  if (/\b(spouse|wife|husband|partner|executor|attorney|lawyer|trustee|heir)\b/.test(value)) return 'helper_or_stakeholder';
  return '';
}

function inferPreferredPath(text = '', ledger = {}) {
  const value = lower(text);
  if (/\b(max(?:imum)? net|top dollar|highest net|most money|retail buyer|retail buying)\b/.test(value)) return 'rbp';
  if (/\b(subject to|take over payments|mortgage takeover|low rate)\b/.test(value)) return 'subject_to';
  if (/\b(seller finance|owner finance|monthly payment|carry a note)\b/.test(value)) return 'creative';
  if (/\b(land|lot|acre|acres)\b/.test(value)) return 'land';
  return ledger.preferredPath || '';
}

export function updateAvaLiveFactLedger(ledger = {}, transcript = '', context = {}) {
  const next = {
    ...(ledger && typeof ledger === 'object' ? ledger : {}),
  };
  const text = clean(transcript);
  const contextCall = context.contextCall || {};
  const fullAddress = clean(contextCall.address || context.address || extractFullAddress(text));
  if (fullAddress) next.fullAddress = fullAddress;
  const partialAddress = extractPartialAddress(text);
  if (partialAddress && !next.fullAddress) next.partialAddress = partialAddress;
  const money = extractMoney(text);
  if (money) next.sellerTargetPrice = money;
  const authority = inferAuthority(text);
  if (authority) next.authority = authority;
  const condition = extractCondition(text);
  if (condition) next.condition = condition;
  const timeline = extractTimeline(text);
  if (timeline) next.timeline = timeline;
  const pain = extractPain(text);
  if (pain) next.pain = pain;
  const preferredPath = inferPreferredPath(text, next);
  if (preferredPath) next.preferredPath = preferredPath;
  if (text) {
    next.lastSellerTurn = text;
    next.updatedAt = new Date().toISOString();
  }
  return next;
}

export function classifyAvaLiveObjectionV2(transcript = '', context = {}) {
  const text = lower(transcript);
  const signals = [];
  let objection = '';
  let intent = 'unknown';

  if (!text) intent = 'empty';
  else if (/\b(stop calling|do not call|don't call|remove me|unsubscribe)\b/.test(text)) {
    intent = 'stop_contact';
    objection = 'stop_contact';
  } else if (/\b(send|email|prepare|write|draft)\b.{0,24}\b(contract|agreement|paperwork|docusign|docu sign)\b|\b(i will|i'll|ready to)\b.{0,24}\b(sign|move forward|do it)\b/.test(text)) {
    intent = 'contract_request';
    objection = '';
  } else if (/\b(i already told you (?:the )?price|i told you (?:the )?price|gave you (?:the )?price|you have (?:the )?price)\b/.test(text)) {
    intent = 'already_gave_price';
    objection = 'already_gave_price';
  } else if (/\b(i already told you|already told you|you asked that already|you keep asking|keep asking|asked that|repeating|stop repeating|same thing)\b/.test(text)) {
    intent = 'repeat_complaint';
    objection = 'repeat_complaint';
  } else if (/\b(how much|what'?s the offer|what is the offer|what can you pay|give me (?:a )?number|make (?:me )?(?:an? )?offer)\b/.test(text)) {
    intent = 'make_offer';
    objection = 'offer_request';
  } else if (/\b(too low|lowball|not enough|more money|higher|another investor|other offer|offered more)\b/.test(text)) {
    intent = /\b(another investor|other offer|offered more|higher offer)\b/.test(text)
      ? 'competing_offer'
      : 'price_too_low';
    objection = intent;
  } else if (/\b(think about it|need to think|not sure|maybe|sleep on it)\b/.test(text)) {
    intent = 'need_to_think';
    objection = 'need_to_think';
  } else if (/\b(scam|legit|real company|proof|trust|how do i know|who are you)\b/.test(text)) {
    intent = 'trust_scam';
    objection = 'trust_scam';
  } else if (/\b(probate|estate|inherited|passed away|executor)\b/.test(text)) {
    intent = 'probate_legal';
    objection = 'probate_legal';
  } else if (/\b(spouse|wife|husband|partner|attorney|lawyer|heir|co-owner|co owner)\b/.test(text)) {
    intent = 'spouse_partner';
    objection = 'decision_maker';
  } else if (/\b(agent|realtor|broker|my client|listing)\b/.test(text)) {
    intent = 'caller_is_agent';
  } else if (/\b(max(?:imum)? net|highest net|top dollar|most money)\b/.test(text)) {
    intent = 'seller_wants_max_net';
  } else if (/\b(speed|fast|quick|asap|soon|timeline|close quickly|close by|by (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/.test(text)) {
    intent = 'seller_wants_speed';
  }

  const money = extractMoney(transcript);
  if (money) signals.push(`money:${money}`);
  if (context?.ledger?.sellerTargetPrice) signals.push('target_price_known');
  if (context?.ledger?.fullAddress) signals.push('full_address_known');
  if (context?.ledger?.partialAddress) signals.push('partial_address_known');
  return { intent, objection, signals, money, normalized: text };
}

function buildKnownFacts(ledger = {}, contextCall = {}) {
  return {
    sellerTargetPrice: clean(ledger.sellerTargetPrice || contextCall.sellerTargetPrice || contextCall.askingPrice || ''),
    fullAddress: clean(ledger.fullAddress || contextCall.address || ''),
    partialAddress: clean(ledger.partialAddress || ''),
    condition: clean(ledger.condition || contextCall.condition || ''),
    timeline: clean(ledger.timeline || contextCall.timeline || ''),
    authority: clean(ledger.authority || contextCall.authority || ''),
    pain: clean(ledger.pain || contextCall.motivation || ''),
    preferredPath: clean(ledger.preferredPath || contextCall.selectedPath || contextCall.selected_path || ''),
  };
}

function missingFactsFor(knownFacts = {}) {
  const missing = [];
  if (!knownFacts.fullAddress) missing.push('full_address');
  if (!knownFacts.authority) missing.push('authority');
  if (!knownFacts.condition) missing.push('condition');
  if (!knownFacts.sellerTargetPrice) missing.push('target_price');
  if (!knownFacts.timeline) missing.push('timeline');
  if (!knownFacts.pain) missing.push('pain');
  return missing;
}

function collectForbiddenRepeats(session = {}, knownFacts = {}) {
  const categories = [
    ...(Array.isArray(session.askedQuestionCategories) ? session.askedQuestionCategories : []),
    ...(Array.isArray(session.recentQuestionCategories) ? session.recentQuestionCategories : []),
  ].map(normalizeQuestionCategory);
  const lastCategory = questionCategoryFromText(session.lastAvaReplySpoken || session.lastAvaSpokenPreview || '');
  if (lastCategory) categories.push(lastCategory);
  if (knownFacts.sellerTargetPrice) categories.push('target_price');
  if (knownFacts.fullAddress) categories.push('full_address');
  if (knownFacts.authority) categories.push('authority');
  if (knownFacts.condition) categories.push('condition');
  if (knownFacts.timeline) categories.push('timeline');
  if (knownFacts.pain) categories.push('pain');
  if (knownFacts.preferredPath) categories.push('deal_path');
  return unique(categories);
}

function chooseNextQuestionCategory({ intent = '', missingFacts = [], forbiddenRepeats = [] } = {}) {
  const forbidden = new Set((forbiddenRepeats || []).map(normalizeQuestionCategory));
  const firstAvailable = (categories = []) =>
    categories.find((category) => !forbidden.has(category) && missingFacts.includes(category)) ||
    categories.find((category) => !forbidden.has(category)) ||
    categories[0] ||
    'seller_priority';
  if (intent === 'trust_scam') return 'trust_proof';
  if (intent === 'contract_request') return 'approval_confirmation';
  if (intent === 'repeat_complaint') return firstAvailable(['condition', 'pain', 'authority', 'seller_priority']);
  if (intent === 'need_to_think') return 'specific_hesitation';
  if (intent === 'spouse_partner') return 'decision_maker';
  if (intent === 'competing_offer') return 'competing_offer_terms';
  if (intent === 'seller_wants_speed') return firstAvailable(['timeline', 'target_price', 'condition', 'pain', 'authority']);
  if (intent === 'seller_wants_max_net') return 'net_comparison';
  const priority = ['full_address', 'condition', 'target_price', 'timeline', 'authority', 'pain'];
  return (
    priority.find((category) => missingFacts.includes(category) && !forbidden.has(category)) ||
    priority.find((category) => missingFacts.includes(category)) ||
    'seller_priority'
  );
}

function buildQuestion(category = '', knownFacts = {}) {
  switch (normalizeQuestionCategory(category)) {
    case 'full_address':
      return knownFacts.partialAddress
        ? `I have ${knownFacts.partialAddress}. What is the full street address so I price the right property?`
        : 'What is the full street address so I price the right property?';
    case 'condition':
      return 'Walk me through condition: roof, HVAC, foundation, tenants, and anything a buyer would complain about.';
    case 'target_price':
      return 'What number would make this worth saying yes today?';
    case 'timeline':
      return 'Are you trying to close in days, a few weeks, or are you flexible if the number is right?';
    case 'authority':
      return 'Are you the owner or the person helping make the decision on this property?';
    case 'pain':
      return 'What is making you consider selling now?';
    case 'trust_proof':
      return 'What proof would make you comfortable enough to keep talking?';
    case 'specific_hesitation':
      return 'What specifically do you need to think through: the number, timing, or confidence in the process?';
    case 'decision_maker':
      return 'What would that decision maker need to hear for this to feel like a yes?';
    case 'competing_offer_terms':
      return 'Does the other offer include repairs, fees, and a guaranteed closing date, or is it just a headline number?';
    case 'net_comparison':
      return 'Is the highest net more important than speed, or do you need both to work?';
    case 'approval_confirmation':
      return 'Before I send contract paperwork, let me confirm: are you comfortable with the price, property, and closing timeline we just discussed?';
    default:
      return 'What is the one thing I need to solve for you first: price, timing, repairs, or certainty?';
  }
}

function inferPhase(knownFacts = {}, objection = '', intent = '') {
  if (intent === 'contract_request') return 'commitment';
  if (objection) return 'objection_resolution';
  if (!knownFacts.authority || !knownFacts.fullAddress) return 'participant_verification';
  if (!knownFacts.condition || !knownFacts.pain) return 'discovery';
  if (!knownFacts.sellerTargetPrice || !knownFacts.timeline) return 'economics';
  return 'path_selection';
}

function normalizeActiveSkill(params = {}) {
  const skill = params.activeSkill || params.governedSkillSelection?.selectedSkill || null;
  if (!skill) return { id: '', name: '', action: 'none', instructions: '', reasonCodes: [], matchedTriggers: [], toolAllowlist: [] };
  return {
    id: clean(skill.id || skill.versionId || ''),
    name: clean(skill.name || ''),
    action: clean(params.governedSkillSelection?.action || skill.action || 'cue') || 'cue',
    instructions: clean(skill.instructions || skill.evidence || ''),
    reasonCodes: Array.isArray(params.governedSkillSelection?.reasonCodes)
      ? params.governedSkillSelection.reasonCodes
      : [],
    matchedTriggers: Array.isArray(params.governedSkillSelection?.matchedTriggers)
      ? params.governedSkillSelection.matchedTriggers
      : [],
    toolAllowlist: Array.isArray(skill.toolAllowlist) ? skill.toolAllowlist : [],
  };
}

export function buildAvaLiveTurnContract(params = {}) {
  const session = params.session || {};
  const contextCall = params.contextCall || {};
  const baseLedger = session.avaLiveFactLedger || params.ledger || {};
  const ledger = updateAvaLiveFactLedger(baseLedger, params.transcript || params.query || '', {
    contextCall,
    address: params.address,
  });
  const classification = classifyAvaLiveObjectionV2(params.transcript || params.query || '', { ledger });
  const knownFacts = buildKnownFacts(ledger, contextCall);
  const missingFacts = missingFactsFor(knownFacts);
  const activeSkill = normalizeActiveSkill(params);
  const forbiddenRepeats = collectForbiddenRepeats(session, knownFacts);
  const nextBestQuestionCategory = normalizeQuestionCategory(
    chooseNextQuestionCategory({
      intent: classification.intent,
      missingFacts,
      forbiddenRepeats,
    })
  );
  const nextBestQuestion = buildQuestion(nextBestQuestionCategory, knownFacts);
  const phase = params.phase || inferPhase(knownFacts, classification.objection, classification.intent);
  const allowedTools = unique([
    ...(activeSkill.toolAllowlist || []),
    ...(Array.isArray(params.allowedTools) ? params.allowedTools : []),
    'retrieveClosingIntelligence',
    'selectContextAwareScript',
  ]);
  return {
    revision: AVA_LIVE_TURN_CONTRACT_REVISION,
    ok: true,
    intent: classification.intent,
    objection: classification.objection || '',
    signals: classification.signals,
    phase,
    knownFacts,
    missingFacts,
    factLedger: ledger,
    activeSkill,
    nextBestQuestion,
    nextBestQuestionCategory,
    forbiddenRepeats,
    handoffNeeded: ['stop_contact', 'probate_legal', 'contract_request'].includes(classification.intent),
    allowedTools,
    responseRules: {
      acknowledgeSellerWords: true,
      askOneQuestion: true,
      neverRepeatKnownFacts: true,
      deepSeekMayPhraseOnly: true,
    },
    generatedAt: new Date().toISOString(),
  };
}

function buildAcknowledgement(contract = {}) {
  const facts = contract.knownFacts || {};
  switch (contract.intent) {
    case 'already_gave_price':
      return facts.sellerTargetPrice
        ? `You are right, I have your target around ${facts.sellerTargetPrice}.`
        : 'You are right, I heard price matters and I am not going to make you repeat the whole story.';
    case 'repeat_complaint':
      return facts.sellerTargetPrice
        ? `You are right, I repeated myself. I have your target around ${facts.sellerTargetPrice}.`
        : 'You are right, I repeated myself. Let us move forward.';
    case 'make_offer':
      return facts.sellerTargetPrice
        ? `I have your target around ${facts.sellerTargetPrice}, and I am not ignoring it.`
        : 'I can get to a real number, but I will not fake one without the facts.';
    case 'contract_request':
      return 'Good, that sounds like you are ready to move.';
    case 'price_too_low':
      return 'I hear you on the number.';
    case 'competing_offer':
      return 'I hear that another offer may look stronger.';
    case 'need_to_think':
      return 'Of course.';
    case 'spouse_partner':
      return 'That makes sense.';
    case 'trust_scam':
      return 'That is a fair concern. I would be careful too.';
    case 'probate_legal':
      return 'I am sorry you are having to sort through that.';
    case 'seller_wants_speed':
      return 'Timeline matters. Got it.';
    case 'seller_wants_max_net':
      return 'Highest net matters. Got it.';
    default:
      return 'I hear you.';
  }
}

export function compileAvaLiveSkillAction(contract = {}) {
  const activeSkill = contract.activeSkill || {};
  const acknowledgement = buildAcknowledgement(contract);
  const question = clean(contract.nextBestQuestion);
  const action = activeSkill.id ? activeSkill.action || 'cue' : 'none';
  return {
    ok: true,
    action,
    skillId: activeSkill.id || '',
    skillName: activeSkill.name || '',
    acknowledgement,
    question,
    category: contract.nextBestQuestionCategory || '',
    reason: activeSkill.reasonCodes?.[0] || contract.intent || 'contract_next_move',
    text: renderAvaLiveContractReply(contract),
  };
}

export function renderAvaLiveContractReply(contract = {}) {
  const acknowledgement = buildAcknowledgement(contract);
  const question = clean(contract.nextBestQuestion);
  const text = [acknowledgement, question].filter(Boolean).join(' ');
  return text.replace(/\s+/g, ' ').trim();
}

function textAsksQuestionCategory(text = '', category = '') {
  const value = lower(text);
  const questions = (value.match(/[^.?!]*[?]/g) || []).join(' ');
  const imperatives = (value.match(/\b(?:tell me|give me|walk me through|send me|share|confirm|clarify|explain)\b[^.?!]*(?:[.?!]|$)/g) || []).join(' ');
  const askText = [questions, imperatives].filter(Boolean).join(' ');
  if (!askText) return false;
  switch (normalizeQuestionCategory(category)) {
    case 'full_address':
      return /\b(full )?(street )?address|what property|where is (?:it|the property)|pull (?:it|this) up\b/.test(askText);
    case 'authority':
      return /\b(are you|who is|person|owner|agent|decision|authority|authorized|sign|executor|spouse|partner)\b/.test(askText);
    case 'target_price':
      return /\b(what number|number (?:do|would|are)|net number|walk away|what price|asking price|what can you take|worth saying yes)\b/.test(askText);
    case 'condition':
      return /\b(condition|repair|roof|hvac|foundation|tenant|vacant|occupied|buyer would complain)\b/.test(askText);
    case 'timeline':
      return /\b(timeline|close|days|weeks|months|asap|quick|fast|soon|flexible|speed)\b/.test(askText);
    case 'pain':
      return /\b(why|reason|motivated|selling|considering|making you)\b/.test(askText);
    case 'trust_proof':
      return /\b(proof|trust|comfortable|legit|verify)\b/.test(askText);
    case 'decision_maker':
      return /\b(decision maker|need to hear|spouse|partner|wife|husband|co-owner|co owner)\b/.test(askText);
    case 'competing_offer_terms':
      return /\b(other offer|headline number|repairs|fees|closing date|guaranteed)\b/.test(askText);
    case 'net_comparison':
      return /\b(highest net|speed|both|net more important)\b/.test(askText);
    default:
      return false;
  }
}

export function isAvaLiveReplyAlignedWithContract(reply = '', contract = {}) {
  if (!contract?.ok) return true;
  const text = clean(reply);
  if (!text) return false;
  const category = normalizeQuestionCategory(contract.nextBestQuestionCategory || '');
  if (category && !textAsksQuestionCategory(text, category)) return false;
  for (const forbidden of contract.forbiddenRepeats || []) {
    const forbiddenCategory = normalizeQuestionCategory(forbidden);
    if (!forbiddenCategory || forbiddenCategory === category) continue;
    if (textAsksQuestionCategory(text, forbiddenCategory)) return false;
  }
  if (contract.intent === 'already_gave_price' && contract.knownFacts?.sellerTargetPrice) {
    return lower(text).includes(lower(contract.knownFacts.sellerTargetPrice));
  }
  return true;
}

export function applyAvaLiveTurnContractToSession(session = {}, contract = {}, options = {}) {
  if (!session || typeof session !== 'object' || !contract?.ok) return session;
  session.avaLiveFactLedger = {
    ...(session.avaLiveFactLedger && typeof session.avaLiveFactLedger === 'object'
      ? session.avaLiveFactLedger
      : {}),
    ...(contract.factLedger || {}),
  };
  session.avaLiveTurnContract = contract;
  const historyEntry = {
    revision: contract.revision || AVA_LIVE_TURN_CONTRACT_REVISION,
    intent: contract.intent || 'unknown',
    objection: contract.objection || '',
    phase: contract.phase || '',
    activeSkill: contract.activeSkill || {},
    knownFacts: contract.knownFacts || {},
    missingFacts: Array.isArray(contract.missingFacts) ? contract.missingFacts : [],
    nextBestQuestionCategory: contract.nextBestQuestionCategory || '',
    nextBestQuestion: contract.nextBestQuestion || '',
    handoffNeeded: Boolean(contract.handoffNeeded),
    generatedAt: contract.generatedAt || new Date().toISOString(),
  };
  const currentHistory = Array.isArray(session.avaLiveTurnHistory) ? session.avaLiveTurnHistory : [];
  const last = currentHistory[0] || {};
  const sameTurn =
    last.generatedAt === historyEntry.generatedAt &&
    last.intent === historyEntry.intent &&
    last.nextBestQuestionCategory === historyEntry.nextBestQuestionCategory;
  session.avaLiveTurnHistory = sameTurn
    ? [historyEntry, ...currentHistory.slice(1, 12)]
    : [historyEntry, ...currentHistory].slice(0, 12);
  const category = normalizeQuestionCategory(contract.nextBestQuestionCategory || '');
  if (category && options.recordQuestion === true) {
    const current = Array.isArray(session.askedQuestionCategories)
      ? session.askedQuestionCategories.map(normalizeQuestionCategory)
      : [];
    session.askedQuestionCategories = unique([category, ...current]).slice(0, 10);
    session.lastQuestionCategory = category;
  }
  return session;
}

export function buildAvaLiveCockpitSnapshot({
  contract = {},
  replyMode = '',
  latencyMs = null,
  turnContractEnforced = false,
  replyPreview = '',
} = {}) {
  const activeSkill = contract.activeSkill || {};
  return {
    ok: Boolean(contract?.ok),
    revision: contract.revision || AVA_LIVE_TURN_CONTRACT_REVISION,
    intent: contract.intent || 'unknown',
    objection: contract.objection || '',
    phase: contract.phase || '',
    activeSkill: {
      id: activeSkill.id || '',
      name: activeSkill.name || '',
      action: activeSkill.action || 'none',
      reasonCodes: Array.isArray(activeSkill.reasonCodes) ? activeSkill.reasonCodes : [],
      matchedTriggers: Array.isArray(activeSkill.matchedTriggers) ? activeSkill.matchedTriggers : [],
    },
    knownFacts: contract.knownFacts || {},
    missingFacts: Array.isArray(contract.missingFacts) ? contract.missingFacts : [],
    nextBestQuestion: contract.nextBestQuestion || '',
    nextBestQuestionCategory: contract.nextBestQuestionCategory || '',
    forbiddenRepeats: Array.isArray(contract.forbiddenRepeats) ? contract.forbiddenRepeats : [],
    handoffNeeded: Boolean(contract.handoffNeeded),
    replyMode,
    latencyMs: latencyMs === null || latencyMs === undefined || latencyMs === '' ? null : Number(latencyMs),
    turnContractEnforced: Boolean(turnContractEnforced),
    replyPreview: String(replyPreview || '').slice(0, 500),
    generatedAt: new Date().toISOString(),
  };
}

export function buildAvaLiveSkillOutcomeDraft({
  contract = {},
  callId = '',
  leadId = '',
  transcript = '',
  reply = '',
  replyMode = '',
  success = null,
  outcomeLabel = 'turn_contract_observed',
} = {}) {
  const skill = contract.activeSkill || {};
  if (!contract?.ok || !skill.id) {
    return {
      ok: false,
      result: 'no_active_skill_for_outcome',
    };
  }
  return {
    ok: true,
    skillId: skill.id || '',
    skillName: skill.name || skill.id || 'Ava live turn contract',
    agentName: 'Ava',
    callId: String(callId || '').trim(),
    leadId: String(leadId || '').trim(),
    success: typeof success === 'boolean' ? success : null,
    outcomeLabel,
    transcript: String(transcript || '').slice(0, 1000),
    metadata: {
      source: 'ava_live_turn_contract',
      revision: contract.revision || AVA_LIVE_TURN_CONTRACT_REVISION,
      intent: contract.intent || 'unknown',
      objection: contract.objection || '',
      phase: contract.phase || '',
      nextQuestionCategory: contract.nextBestQuestionCategory || '',
      replyMode,
      replyPreview: String(reply || '').slice(0, 500),
      knownFacts: contract.knownFacts || {},
      missingFacts: Array.isArray(contract.missingFacts) ? contract.missingFacts : [],
      handoffNeeded: Boolean(contract.handoffNeeded),
    },
  };
}
