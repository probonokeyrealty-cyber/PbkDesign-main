-- PBK 7-Figure Closer OS seed data.
-- Idempotent: deterministic IDs let this migration refresh copy without duplicating rows.

INSERT INTO public.coach_memory (
  id, workspace_id, memory_type, objection_tag, path_key, prompt, response,
  source, source_url, outcome, score, metadata
)
VALUES
(
  '00000000-0000-7000-8000-000000000001'::uuid,
  'pbk',
  'objection',
  'too_expensive',
  'general',
  $pbk$Seller says: "It is too expensive" or "I cannot afford it."$pbk$,
  $pbk$I understand. Before we decide it is too expensive, let's compare it to the cost of doing nothing. What is this costing you in money, time, stress, or missed options every month?$pbk$,
  '7figure_closer_os',
  '',
  'approved',
  0.95,
  '{"framework":"7_figure_closer_os","track":"objection_eradication"}'::jsonb
),
(
  '00000000-0000-7000-8000-000000000002'::uuid,
  'pbk',
  'objection',
  'need_to_think',
  'general',
  $pbk$Seller says: "I need to think about it."$pbk$,
  $pbk$That is fair. So I do not follow up with the wrong thing, what specifically do you need to think through: the number, the timing, the process, or whether someone else needs to weigh in?$pbk$,
  '7figure_closer_os',
  '',
  'approved',
  0.94,
  '{"framework":"7_figure_closer_os","track":"objection_eradication"}'::jsonb
),
(
  '00000000-0000-7000-8000-000000000003'::uuid,
  'pbk',
  'objection',
  'talk_to_partner',
  'general',
  $pbk$Seller says: "I need to talk to my partner, spouse, boss, or decision maker."$pbk$,
  $pbk$Smart. Would it help if we got them the simple version now, so you do not have to replay the whole conversation? I can summarize the price, timing, and protection points in plain English.$pbk$,
  '7figure_closer_os',
  '',
  'approved',
  0.96,
  '{"framework":"7_figure_closer_os","track":"objection_eradication"}'::jsonb
),
(
  '00000000-0000-7000-8000-000000000004'::uuid,
  'pbk',
  'objection',
  'send_info',
  'general',
  $pbk$Seller says: "Send me the info."$pbk$,
  $pbk$I can send it. Before I do, what information would actually help you decide: the offer math, proof of funds, title process, timeline, or something else?$pbk$,
  '7figure_closer_os',
  '',
  'approved',
  0.93,
  '{"framework":"7_figure_closer_os","track":"objection_eradication"}'::jsonb
),
(
  '00000000-0000-7000-8000-000000000005'::uuid,
  'pbk',
  'objection',
  'talking_to_others',
  'general',
  $pbk$Seller says: "I am talking to other options."$pbk$,
  $pbk$That makes sense. What would another option need to do for you to feel confident choosing them over us? I want to make sure I have not missed what matters most to you.$pbk$,
  '7figure_closer_os',
  '',
  'approved',
  0.94,
  '{"framework":"7_figure_closer_os","track":"objection_eradication"}'::jsonb
),
(
  '00000000-0000-7000-8000-000000000006'::uuid,
  'pbk',
  'objection',
  'not_priority',
  'general',
  $pbk$Seller says: "It is not a priority right now."$pbk$,
  $pbk$I hear you. What would make it a priority: a deadline, repairs getting worse, payments, taxes, family pressure, or just a better number? Sometimes delay has a cost hiding in the background.$pbk$,
  '7figure_closer_os',
  '',
  'approved',
  0.93,
  '{"framework":"7_figure_closer_os","track":"objection_eradication"}'::jsonb
),
(
  '00000000-0000-7000-8000-000000000007'::uuid,
  'pbk',
  'objection',
  'been_burned',
  'general',
  $pbk$Seller says: "I have been burned before."$pbk$,
  $pbk$I am sorry that happened. What did they promise that they did not deliver? I want to avoid repeating that mistake, and anything important should be clear in writing before you decide.$pbk$,
  '7figure_closer_os',
  '',
  'approved',
  0.97,
  '{"framework":"7_figure_closer_os","track":"objection_eradication"}'::jsonb
),
(
  '00000000-0000-7000-8000-000000000008'::uuid,
  'pbk',
  'objection',
  'can_do_ourselves',
  'general',
  $pbk$Seller says: "I can do this myself" or "We can handle this in-house."$pbk$,
  $pbk$You may be able to. What would it take in time, money, risk, and attention to get it done correctly? The real comparison is not DIY versus us; it is DIY cost, delay, and certainty versus a clean path.$pbk$,
  '7figure_closer_os',
  '',
  'approved',
  0.92,
  '{"framework":"7_figure_closer_os","track":"objection_eradication"}'::jsonb
),
(
  '00000000-0000-7000-8000-000000000009'::uuid,
  'pbk',
  'objection',
  'call_in_3_months',
  'general',
  $pbk$Seller says: "Call me in three months."$pbk$,
  $pbk$I can do that. Quick question so I time it correctly: what would need to change in three months for this to become worth acting on? If that issue can be solved sooner, should we at least map the options now?$pbk$,
  '7figure_closer_os',
  '',
  'approved',
  0.91,
  '{"framework":"7_figure_closer_os","track":"objection_eradication"}'::jsonb
),
(
  '00000000-0000-7000-8000-000000000010'::uuid,
  'pbk',
  'objection',
  'not_sure_it_works',
  'general',
  $pbk$Seller says: "I am not sure it will work for us."$pbk$,
  $pbk$That is a fair concern. What would need to be true for you to feel confident: proof from a similar situation, a clearer timeline, title company details, a written guarantee, or a smaller first step?$pbk$,
  '7figure_closer_os',
  '',
  'approved',
  0.95,
  '{"framework":"7_figure_closer_os","track":"objection_eradication"}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  workspace_id = EXCLUDED.workspace_id,
  memory_type = EXCLUDED.memory_type,
  objection_tag = EXCLUDED.objection_tag,
  path_key = EXCLUDED.path_key,
  prompt = EXCLUDED.prompt,
  response = EXCLUDED.response,
  source = EXCLUDED.source,
  source_url = EXCLUDED.source_url,
  outcome = EXCLUDED.outcome,
  score = EXCLUDED.score,
  metadata = public.coach_memory.metadata || EXCLUDED.metadata,
  updated_at = NOW();

INSERT INTO public.probe_questions (
  id, workspace_id, signal_keywords, sentiment_range, emotion_tags,
  question_text, follow_up_depth, priority, source, metadata, active
)
VALUES
(
  '7figure-pain-probe-layer-1',
  'pbk',
  ARRAY['setup','process','currently','current','working','not working']::text[],
  NULL,
  ARRAY[]::text[],
  $pbk$Tell me about your current setup. What is working well, and what is not?$pbk$,
  1,
  10,
  '7figure_closer_os',
  '{"framework":"7_figure_closer_os","probe":"four_layer_pain","layer":1}'::jsonb,
  TRUE
),
(
  '7figure-pain-probe-layer-2',
  'pbk',
  ARRAY['cost','dollars','time','morale','money','stress','monthly']::text[],
  NULL,
  ARRAY[]::text[],
  $pbk$What does that actually cost you in dollars, time, stress, or team morale on a monthly basis?$pbk$,
  2,
  10,
  '7figure_closer_os',
  '{"framework":"7_figure_closer_os","probe":"four_layer_pain","layer":2}'::jsonb,
  TRUE
),
(
  '7figure-pain-probe-layer-3',
  'pbk',
  ARRAY['change','nothing changes','future','12 months','personal']::text[],
  NULL,
  ARRAY[]::text[],
  $pbk$If nothing changes and this problem is still here 12 months from now, what happens to you personally?$pbk$,
  3,
  10,
  '7figure_closer_os',
  '{"framework":"7_figure_closer_os","probe":"four_layer_pain","layer":3}'::jsonb,
  TRUE
),
(
  '7figure-pain-probe-layer-4',
  'pbk',
  ARRAY['solve','solved','different','90 days','complete','outcome']::text[],
  NULL,
  ARRAY[]::text[],
  $pbk$If we could solve this completely, 90 days from now, what would be different and what would that mean for you?$pbk$,
  4,
  10,
  '7figure_closer_os',
  '{"framework":"7_figure_closer_os","probe":"four_layer_pain","layer":4}'::jsonb,
  TRUE
)
ON CONFLICT (id) DO UPDATE SET
  workspace_id = EXCLUDED.workspace_id,
  signal_keywords = EXCLUDED.signal_keywords,
  sentiment_range = EXCLUDED.sentiment_range,
  emotion_tags = EXCLUDED.emotion_tags,
  question_text = EXCLUDED.question_text,
  follow_up_depth = EXCLUDED.follow_up_depth,
  priority = EXCLUDED.priority,
  source = EXCLUDED.source,
  metadata = public.probe_questions.metadata || EXCLUDED.metadata,
  active = EXCLUDED.active,
  updated_at = NOW();
