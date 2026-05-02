-- PBK Ava negotiation intelligence
-- Stores editable closer tactics, emotional intelligence rules, and city rapport hooks.

create extension if not exists pgcrypto;

create schema if not exists pbk_agent;

create table if not exists pbk_agent.negotiation_tactics (
  id uuid primary key default gen_random_uuid(),
  scenario text not null,
  tactic_name text not null,
  principle text not null,
  script_example text not null,
  emotion_target text,
  rank integer not null default 1,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists pbk_agent.emotional_intelligence_rules (
  id uuid primary key default gen_random_uuid(),
  emotion text not null,
  trigger_phrase text,
  recommended_response text not null,
  script_fragment text not null,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists pbk_agent.city_knowledge (
  id uuid primary key default gen_random_uuid(),
  city text not null,
  state text not null default 'OH',
  zip_prefixes text[] not null default '{}',
  rapport_line text not null,
  local_story text not null,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists negotiation_tactics_scenario_idx
  on pbk_agent.negotiation_tactics (scenario, active, rank desc);

create index if not exists emotional_intelligence_rules_emotion_idx
  on pbk_agent.emotional_intelligence_rules (emotion, active);

create index if not exists city_knowledge_city_state_idx
  on pbk_agent.city_knowledge (city, state, active);

insert into pbk_agent.negotiation_tactics
  (scenario, tactic_name, principle, script_example, emotion_target, rank)
values
  ('opening', 'Accusation audit', 'Name the seller fear first so the conversation starts honest.', 'You may be getting a lot of investor calls, and I would not blame you for wondering if this is just another lowball. I can keep this simple and transparent.', 'distrust', 10),
  ('objection_price', 'Price labeling', 'Label the tension between speed, certainty, and price.', 'It sounds like you want the best number possible, but you also do not want repairs, showings, or a long listing process hanging over you.', 'hesitation', 10),
  ('counter_offer', 'Ackerman step-up', 'Move in small, justified increments and explain what each concession buys.', 'I cannot responsibly get to that number as-is. What I can do is improve the cash offer if we keep the close clean and avoid repair credits.', 'greed', 9),
  ('closing_hesitation', 'Smaller yes', 'When the seller hesitates, ask for the next low-pressure commitment instead of forcing the close.', 'What would need to be true for you to feel comfortable saying yes today, even if that yes is just letting me send the paperwork for review?', 'fear', 9),
  ('probate', 'Executor empathy', 'Probate sellers often need burden removal and dignity before numbers.', 'If you are handling this for the family, I know it can feel like one more heavy thing on top of everything else. We can move at your pace.', 'grief', 10),
  ('anger', 'Graceful exit', 'Protect trust and compliance when a seller is angry.', 'I hear you. I am sorry we bothered you. I can remove this number now so you do not get another outreach from us.', 'anger', 10)
on conflict do nothing;

insert into pbk_agent.emotional_intelligence_rules
  (emotion, trigger_phrase, recommended_response, script_fragment)
values
  ('angry', 'stop calling, mad, upset, leave me alone', 'Slow down, apologize without defensiveness, offer DNC, and end cleanly if requested.', 'I hear you, and I am sorry. I can remove you from our list right now.'),
  ('hesitant', 'I do not know, let me think, maybe, not sure', 'Label the uncertainty and ask what information would make the decision easier.', 'It sounds like you are not quite comfortable yet. What would you need to see before this feels safe?'),
  ('distrustful', 'how do I know, scam, are you real', 'Use proof, process clarity, and transparency. Do not over-defend.', 'Fair question. I can walk you through exactly who we are, how closing works, and what happens before anything is signed.'),
  ('urgent', 'need this done, behind, deadline, foreclosure', 'Move to clarity, timeline, and immediate next step. Keep tone steady.', 'Let us focus on the fastest clean path. What date are you trying to solve this before?')
on conflict do nothing;

insert into pbk_agent.city_knowledge
  (city, state, zip_prefixes, rapport_line, local_story)
values
  ('Columbus', 'OH', array['432'], 'Columbus sellers usually appreciate a clean, no-drama process, especially around probate and older homes.', 'Ava knows the Short North, German Village brick streets, and the way older Columbus houses can hide repair surprises behind charm.'),
  ('Akron', 'OH', array['443'], 'Akron sellers often respond well to practical burden removal: repairs, tenants, taxes, or a timeline that is getting tight.', 'Ava can reference Akron as a working town where people value straight talk and a buyer who does what they say.'),
  ('Cleveland', 'OH', array['441'], 'Cleveland conversations should be direct about winter repairs, older mechanicals, and buyer certainty.', 'Ava can use Cleveland neighborhood familiarity without pretending to be from the exact block.'),
  ('Cincinnati', 'OH', array['452'], 'Cincinnati sellers often care about certainty, timing, and whether the buyer understands hillside/older-home repair risks.', 'Ava can mention that Cincinnati houses can be beautiful but quirky, especially older homes with steps, basements, and deferred maintenance.'),
  ('Dayton', 'OH', array['454'], 'Dayton sellers usually respond to respect, speed, and a realistic as-is number more than flashy investor language.', 'Ava can connect around Dayton as a practical market where a clean close can matter more than squeezing every last dollar.')
on conflict do nothing;
