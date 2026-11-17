import config from '../../config/ghl/wholesale-readiness.v1.json' with { type: 'json' };

const text = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const unknown = /^(?:unknown(?: seller)?|not (?:captured|available|provided|verified|recorded)|n\/a|null|undefined|none|unassigned|pending verification|-+)$/i;
const present = value => text(value) !== '' && !unknown.test(text(value));
const yes = value => value === true || value === 1 || /^(true|yes|on|enabled|1)$/i.test(text(value));
const no = value => value === false || value === 0 || /^(false|no|off|disabled|0)$/i.test(text(value));
const qaToken = /(?:^|[^a-z0-9])(?:qa|test|sandbox|synthetic)(?:$|[^a-z0-9])/i;
const done = value => /^(completed?|done|cancelled|canceled)$/i.test(text(value));
const openStatus = value => /^(open|pending|not[ _-]started|scheduled|in[ _-]progress|overdue)$/i.test(text(value));
const normalize = value => text(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const contactName = contact => text(contact.name) || [text(contact.firstName), text(contact.lastName)].filter(Boolean).join(' ');
const tags = item => (Array.isArray(item.tags) ? item.tags : []).map(tag => typeof tag === 'string' ? tag : text(tag?.name));
const isQa = (contact, opportunity) => yes(contact.isQa) || yes(opportunity.isQa) ||
  [contactName(contact), opportunity.name, contact.source, opportunity.source, ...tags(contact), ...tags(opportunity)].some(v => qaToken.test(text(v)));

function stable(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(item => JSON.parse(stable(item))));
  if (value && typeof value === 'object') return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(stable(value[key]))])));
  return JSON.stringify(value ?? null);
}

function unique(rows, kind) {
  if (!Array.isArray(rows)) throw new Error(`${kind} snapshot must be an array`);
  const byId = new Map();
  for (const row of rows) {
    if (!row || !present(row.id)) throw new Error(`Every ${kind} requires an existing ID`);
    const id = text(row.id);
    if (byId.has(id) && stable(byId.get(id)) !== stable(row)) throw new Error(`Conflicting ${kind} ID: ${id}`);
    byId.set(id, row);
  }
  return byId;
}

// Date-only fields retain calendar precision. Timestamp fields must carry their timezone.
function parseDate(value) {
  const raw = text(value);
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2}))?$/.exec(raw);
  if (!match) return null;
  const calendarTime = Date.parse(`${match[1]}T00:00:00Z`);
  if (!Number.isFinite(calendarTime) || new Date(calendarTime).toISOString().slice(0, 10) !== match[1]) return null;
  if (match[2] && (+match[2] > 23 || +match[3] > 59 || +(match[4] ?? 0) > 59)) return null;
  const epoch = Date.parse(raw);
  if (!Number.isFinite(epoch)) return null;
  return { raw, day: match[1], epoch, precision: match[2] ? 'instant' : 'date' };
}

function calendarDay(epoch, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(epoch);
  const part = key => parts.find(item => item.type === key).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function resolveFields(definitions) {
  const rows = [...unique(definitions, 'field definition').values()].filter(field => field.model === 'opportunity');
  const required = [...config.propertyChecks.map(check => check.field), ...Object.values(config.accountability).filter(name => name !== 'assignedTo')];
  return new Map(required.map(name => {
    const matches = rows.filter(field => field.name === name);
    if (matches.length !== 1) throw new Error(`${matches.length ? 'Ambiguous' : 'Missing'} opportunity field definition: ${name}`);
    return [name, text(matches[0].id)];
  }));
}

function fieldReader(opportunity, ids) {
  const rows = unique(opportunity.customFields ?? [], 'custom field');
  return name => rows.get(ids.get(name))?.fieldValue;
}

function dndState(contact) {
  if (yes(contact.dnd)) return 'on';
  if (contact.dndSettings != null && (typeof contact.dndSettings !== 'object' || Array.isArray(contact.dndSettings))) return 'unknown';
  const channels = Object.values(contact.dndSettings ?? {});
  if (channels.some(channel => yes(channel?.status) || /^(active|enabled)$/i.test(text(channel?.status)))) return 'restricted';
  if (channels.some(channel => !channel || typeof channel !== 'object' || (!no(channel.status) && !/^(inactive|disabled)$/i.test(text(channel.status))))) return 'unknown';
  return no(contact.dnd) ? 'off_not_permission' : 'unknown';
}

function taskState(task) {
  if ((task.completed === true && openStatus(task.status)) || (task.completed === false && done(task.status))) return 'conflict';
  if (present(task.status) && !done(task.status) && !openStatus(task.status)) return 'unknown';
  if (task.completed === true || done(task.status)) return 'completed';
  if (task.completed === false || openStatus(task.status)) return 'open';
  return 'unknown';
}

function inspectNextStep(opportunity, read, tasks, tasksComplete, ownerId, clock, today, timeZone, sharedTaskIds) {
  const summary = text(read(config.accountability.summary));
  const due = text(read(config.accountability.due));
  const status = text(read(config.accountability.status));
  const taskId = text(read(config.accountability.taskId));
  const issues = [];
  if (sharedTaskIds.has(taskId)) issues.push('task_reference_shared_between_properties');
  const matching = [...tasks.values()].filter(task => text(task.opportunityId) === text(opportunity.id) ||
    (text(task.id) === taskId && text(task.contactId) === text(opportunity.contactId) && !present(task.opportunityId) && !sharedTaskIds.has(taskId)));
  const ownedTasks = matching.filter(task => !present(task.contactId) || text(task.contactId) === text(opportunity.contactId));
  if (ownedTasks.length !== matching.length) issues.push('task_contact_mismatch');
  const open = ownedTasks.filter(task => taskState(task) === 'open');
  if (!tasksComplete) issues.push('task_snapshot_incomplete');
  if (ownedTasks.some(task => taskState(task) === 'unknown')) issues.push('task_status_unknown');
  if (ownedTasks.some(task => taskState(task) === 'conflict')) issues.push('task_status_conflict');
  if (open.length > 1) issues.push('multiple_current_tasks');
  if (open.some(task => !present(task.assignedTo))) issues.push('task_owner_missing');
  if (ownerId && open.some(task => present(task.assignedTo) && text(task.assignedTo) !== ownerId)) issues.push('task_owner_mismatch');
  if (!present(taskId)) issues.push('task_reference_missing');
  else {
    const referenced = ownedTasks.find(task => text(task.id) === taskId);
    const referencedElsewhere = tasks.get(taskId);
    if (!referenced && tasksComplete) issues.push('referenced_task_missing');
    if (referenced && taskState(referenced) === 'completed') issues.push('referenced_task_completed');
    if (referencedElsewhere && present(referencedElsewhere.opportunityId) && text(referencedElsewhere.opportunityId) !== text(opportunity.id)) issues.push('task_property_mismatch');
    if (referencedElsewhere && present(referencedElsewhere.contactId) && text(referencedElsewhere.contactId) !== text(opportunity.contactId)) issues.push('task_contact_mismatch');
  }
  const parsed = parseDate(due);
  for (const task of open) {
    const taskDue = parseDate(task.dueDate);
    if (!taskDue) issues.push('task_due_missing_or_invalid');
    else if (parsed && (parsed.precision === taskDue.precision
      ? parsed.precision === 'date' ? parsed.day !== taskDue.day : parsed.epoch !== taskDue.epoch
      : (parsed.precision === 'date' ? parsed.day : calendarDay(parsed.epoch, timeZone)) !==
        (taskDue.precision === 'date' ? taskDue.day : calendarDay(taskDue.epoch, timeZone)))) issues.push('task_due_mismatch');
  }
  let state;
  if (done(status)) state = 'completed';
  else if (!present(summary) || !present(due) || !present(status)) state = 'missing';
  else if (!openStatus(status)) state = 'invalid_status';
  else if (!parsed) state = 'invalid_date';
  else if (parsed.precision === 'date') state = parsed.day < today ? 'overdue' : parsed.day === today ? 'due_today' : 'scheduled';
  else state = parsed.epoch < clock ? 'overdue' : 'scheduled';
  return { summary: present(summary) ? summary : null, due: present(due) ? due : null, status: present(status) ? status : null,
    state, precision: parsed?.precision ?? null, taskId: present(taskId) ? taskId : null,
    currentTasks: tasksComplete ? open.length : null, observedCurrentTasks: open.length, issues: [...new Set(issues)] };
}

/** Pure evaluation only. It has no CRM client and returns no write commands. */
export function evaluateReadiness(snapshot, { now, timeZone = config.timeZone } = {}) {
  const parsedNow = parseDate(now);
  if (!parsedNow || parsedNow.precision !== 'instant') throw new Error('now must be an explicit timestamp with timezone');
  const today = calendarDay(parsedNow.epoch, timeZone);
  const contacts = unique(snapshot.contacts, 'contact');
  const opportunities = unique(snapshot.opportunities, 'opportunity');
  const tasks = unique(snapshot.tasks, 'task');
  for (const task of tasks.values()) {
    for (const key of ['contactId', 'opportunityId', 'status']) {
      if (task[key] != null && typeof task[key] !== 'string') throw new Error(`Task ${key} must be a string when supplied`);
    }
    if (task.completed != null && typeof task.completed !== 'boolean') throw new Error('Task completed must be a boolean when supplied');
  }
  const fields = resolveFields(snapshot.fieldDefinitions);
  const references = new Map();
  for (const opportunity of opportunities.values()) {
    const contact = contacts.get(text(opportunity.contactId));
    if (!contact || isQa(contact, opportunity) || text(opportunity.status).toLowerCase() !== 'open') continue;
    const taskId = text(fieldReader(opportunity, fields)(config.accountability.taskId));
    if (present(taskId)) references.set(taskId, (references.get(taskId) ?? 0) + 1);
  }
  const sharedTaskIds = new Set([...references].filter(([, count]) => count > 1).map(([id]) => id));
  const records = [...opportunities.values()].map(opportunity => {
    const contact = contacts.get(text(opportunity.contactId));
    if (!contact) throw new Error(`Opportunity contact is absent: ${text(opportunity.contactId) || '(missing ID)'}`);
    const read = fieldReader(opportunity, fields);
    const facts = Object.fromEntries(config.propertyChecks.map(check => [check.key, read(check.field)]));
    const missing = [], invalid = [];
    for (const check of config.propertyChecks) {
      const value = facts[check.key];
      if (!present(value)) missing.push(check.label);
      else if (check.type === 'date' && !parseDate(value)) invalid.push(check.label);
    }
    if (!present(contactName(contact))) missing.push('Contact name');
    if (!present(contact.phone) && !present(contact.email)) missing.push('Phone or email');
    const ownerId = present(opportunity.assignedTo) ? text(opportunity.assignedTo) : null;
    const nextStep = inspectNextStep(opportunity, read, tasks, snapshot.tasksComplete === true, ownerId, parsedNow.epoch, today, timeZone, sharedTaskIds);
    const issues = [...nextStep.issues];
    if (ownerId && present(contact.assignedTo) && ownerId !== text(contact.assignedTo)) issues.push('contact_property_owner_differs');
    const qa = isQa(contact, opportunity);
    const excludedReason = qa ? 'qa' : text(opportunity.status).toLowerCase() !== 'open' ? 'not_open' : null;
    return { opportunityId: text(opportunity.id), contactId: text(contact.id), qa, excludedReason,
      dnd: dndState(contact), outreachAllowed: false, ownerId,
      completeness: { captured: 11 - missing.length - invalid.length, total: 11, missing, invalid },
      nextStep, issues, facts };
  });
  const identities = new Map();
  for (const row of records.filter(row => !row.excludedReason)) {
    const f = row.facts;
    const keys = [];
    if (present(f.apn) && present(f.county)) keys.push(`parcel:${normalize(f.county)}:${normalize(f.apn)}`);
    if (['street', 'city', 'state', 'zip'].every(key => present(f[key]))) keys.push(`address:${['street', 'city', 'state', 'zip'].map(key => normalize(f[key])).join(':')}`);
    for (const key of keys) identities.set(key, [...(identities.get(key) ?? []), row]);
  }
  for (const group of identities.values()) if (group.length > 1) for (const row of group) {
    row.excludedReason = 'potential_duplicate';
    if (!row.issues.includes('potential_duplicate_property')) row.issues.push('potential_duplicate_property');
  }
  const queues = Object.fromEntries(config.nativeViews.map(view => [view.key, []]));
  const excluded = { qa: [], notOpen: [] };
  for (const row of records) {
    if (row.excludedReason === 'qa') { excluded.qa.push(row.opportunityId); continue; }
    if (row.excludedReason === 'not_open') { excluded.notOpen.push(row.opportunityId); continue; }
    if (row.excludedReason === 'potential_duplicate') { queues.duplicateReview.push(row.opportunityId); continue; }
    if (row.completeness.captured !== row.completeness.total) queues.incomplete.push(row.opportunityId);
    if (!row.ownerId) queues.unassigned.push(row.opportunityId);
    if (['missing', 'invalid_date', 'invalid_status', 'completed'].includes(row.nextStep.state)) queues.missingNextStep.push(row.opportunityId);
    if (row.nextStep.state === 'overdue') queues.overdue.push(row.opportunityId);
    if (row.issues.length) queues.accountabilityReview.push(row.opportunityId);
  }
  return { mode: 'preview_only', asOf: new Date(parsedNow.epoch).toISOString(), timeZone,
    coverageLabel: config.coverageLabel, records: records.map(({ facts, ...row }) => row), queues, excluded, writes: [] };
}
