const providerId = /^[a-zA-Z0-9_-]{1,128}$/;

function readBindings(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function readHighLevelLeadTasks(leadId, {
  token = process.env.PBK_HIGHLEVEL_READ_TOKEN,
  locationId = process.env.PBK_HIGHLEVEL_LOCATION_ID,
  bindings = process.env.PBK_HIGHLEVEL_LEAD_CONTACT_MAP,
  fetchTasks = fetch,
} = {}) {
  const base = { leadId, source: 'highlevel', writeMode: 'read_only' };
  const contacts = readBindings(bindings);
  if (!token || !providerId.test(locationId || '') || !contacts) {
    return { ...base, status: 'not_configured' };
  }
  const contactId = Object.hasOwn(contacts, leadId) ? contacts[leadId] : null;
  if (typeof contactId !== 'string' || !providerId.test(contactId)) {
    return { ...base, status: 'unmatched' };
  }

  try {
    const response = await fetchTasks(
      `https://services.leadconnectorhq.com/contacts/${encodeURIComponent(contactId)}/tasks`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28', Accept: 'application/json' },
        signal: AbortSignal.timeout(4500),
        redirect: 'error',
      },
    );
    if (!response.ok) return { ...base, status: 'unavailable' };
    const { tasks } = await response.json();
    if (!Array.isArray(tasks)) return { ...base, status: 'unavailable' };

    const seen = new Set();
    const openTasks = [];
    for (const task of tasks) {
      if (!task || task.contactId !== contactId || typeof task.id !== 'string' ||
          !providerId.test(task.id) || seen.has(task.id) || typeof task.completed !== 'boolean') {
        return { ...base, status: 'unavailable' };
      }
      seen.add(task.id);
      if (task.completed) continue;
      const due = typeof task.dueDate === 'string' ? Date.parse(task.dueDate) : NaN;
      openTasks.push({
        id: task.id,
        title: typeof task.title === 'string' ? task.title.trim().slice(0, 200) : '',
        dueAt: Number.isFinite(due) ? new Date(due).toISOString() : null,
        assigned: Boolean(task.assignedTo),
      });
    }
    openTasks.sort((a, b) => (a.dueAt || 'z').localeCompare(b.dueAt || 'z'));
    return {
      ...base, status: 'ready', checkedAt: new Date().toISOString(), tasks: openTasks,
      contactUrl: `https://app.gohighlevel.com/v2/location/${locationId}/contacts/detail/${contactId}`,
    };
  } catch {
    return { ...base, status: 'unavailable' };
  }
}
