import assert from 'node:assert/strict';

export async function verifyAnalyzerPublicationGuards(page, key, olderRaw) {
  const url = new URL(page.url());
  assert.equal(url.origin, 'https://pbk-analyzer-qa.netlify.app', 'Timing tests require the isolated fixture');
  assert.equal(url.pathname, '/scripts/fixtures/analyzer-draft-recovery.html', 'Timing tests require the isolated fixture');
  assert.equal(key, 'pbk:prod:analyzer:current-deal');
  const results = await page.evaluate(async ({ key, olderRaw }) => {
    const base = window.PBKAnalyzer.getState().deal;
    if (base.leadId !== 'qa-draft' || base.address !== '11 Fixture Avenue') throw Error('Sample lead required');
    const fields = ['notes', 'repairs'];
    const decode = raw => raw ? JSON.parse(decodeURIComponent(escape(atob(raw)))) : null;
    const encode = value => btoa(unescape(encodeURIComponent(JSON.stringify(value))));
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('pbk-analyzer-draft-coordination', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(Error('Sample coordinator blocked'));
    });
    const changeCanonical = raw => new Promise((resolve, reject) => {
      const tx = database.transaction('drafts', 'readwrite');
      const store = tx.objectStore('drafts');
      if (raw === undefined) store.delete(key);
      else store.put({ raw }, key);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
    const canonical = () => new Promise((resolve, reject) => {
      const request = database.transaction('drafts', 'readonly').objectStore('drafts').get(key);
      request.onsuccess = () => resolve(request.result?.raw);
      request.onerror = () => reject(request.error);
    });
    const reports = [];
    try {
      for (const name of ['undefined-baseline', 'canonical-mismatch', 'permanent-local-mismatch',
        'cancel-between', 'cancel-after-reservation', 'abort-second', 'projection-failure',
        'canonical-between', 'legacy-between', 'missing-row', 'explicit-null']) {
        await window.__commitSampleDraft(base, fields, undefined, true, () => true);
        const original = localStorage.getItem(key);
        const peer = decode(original);
        peer.payload = { ...peer.payload, beds: 10, notes: 'Peer sample notes' };
        const peerRaw = encode(peer);
        if (name === 'canonical-mismatch') await changeCanonical(peerRaw);
        const empty = name === 'missing-row' || name === 'explicit-null';
        if (empty) {
          await changeCanonical(name === 'missing-row' ? undefined : null);
          localStorage.removeItem(key);
        }
        window.__draftWrites = [];
        const get = IDBObjectStore.prototype.get, put = IDBObjectStore.prototype.put;
        const set = Storage.prototype.setItem;
        let reads = 0, current = true, peerCommit, abortError = null;
        const lag = !empty && !['undefined-baseline', 'canonical-mismatch'].includes(name);
        IDBObjectStore.prototype.get = function (...args) {
          const request = get.apply(this, args);
          if (this.name !== 'drafts' || args[0] !== key) return request;
          reads++;
          if (name === 'abort-second' && reads === 2) {
            request.addEventListener('error', () => { abortError = request.error?.name || null; });
            this.transaction.abort();
          }
          if (lag && reads === 1) request.addEventListener('success', () => {
            window.__staleDraftRead = olderRaw;
            window.__staleDraftReadOnce = name !== 'permanent-local-mismatch';
            window.__onControlledCacheCatchup = () => {
              if (name === 'cancel-between') current = false;
              if (name === 'canonical-between') peerCommit = changeCanonical(peerRaw);
              if (name === 'legacy-between') localStorage.setItem(key, peerRaw);
            };
          }, { once: true });
          return request;
        };
        IDBObjectStore.prototype.put = function (...args) {
          const request = put.apply(this, args);
          if (name === 'cancel-after-reservation' && decode(args[0]?.raw)?.payload?.beds === 66) current = false;
          return request;
        };
        Storage.prototype.setItem = function (storageKey, value) {
          if (name === 'projection-failure' && this === localStorage && storageKey === key
            && decode(value)?.payload?.beds === 66) throw new DOMException('Sample projection failure', 'QuotaExceededError');
          return set.call(this, storageKey, value);
        };
        const candidate = { ...base, beds: 66 };
        const baseline = name === 'undefined-baseline' ? undefined : empty ? null : original;
        window.__writeSamplePrivateDraft(candidate, fields, baseline, true);
        let result, errorName = null, errorMessage = null, errorIsNull = false;
        try {
          result = await window.__commitSampleDraft(candidate, fields, baseline, false, () => current);
        } catch (error) {
          result = 'rejected';
          errorName = error?.name ?? null;
          errorMessage = error?.message ?? null;
          errorIsNull = error === null;
        }
        finally {
          IDBObjectStore.prototype.get = get;
          IDBObjectStore.prototype.put = put;
          Storage.prototype.setItem = set;
          delete window.__staleDraftRead;
          delete window.__staleDraftReadOnce;
          delete window.__onControlledCacheCatchup;
        }
        await peerCommit;
        const shared = localStorage.getItem(key), authoritative = await canonical();
        const privateEnvelope = decode(sessionStorage.getItem(key + ':session'));
        const privateDeal = privateEnvelope?.payload;
        reports.push({ name, result, reads, abortError, errorName, errorMessage, errorIsNull,
          publications: window.__draftWrites.filter(deal => deal.beds === 66).length,
          sharedPreserved: empty ? decode(shared)?.payload?.beds === 66 : shared === (name === 'legacy-between' ? peerRaw : original),
          canonicalPreserved: empty ? authoritative === shared
            : authoritative === (['canonical-mismatch', 'canonical-between'].includes(name) ? peerRaw : original),
          privatePreserved: privateDeal?.beds === 66 && privateDeal?.notes === base.notes
            && Boolean(privateEnvelope?.unpublishedEdits) === !empty
            && JSON.stringify(privateDeal?.comps) === JSON.stringify(base.comps)
            && JSON.stringify(privateDeal?.repairs) === JSON.stringify(base.repairs),
        });
      }
    } finally { database.close(); }
    return reports;
  }, { key, olderRaw });
  for (const report of results) {
    const empty = ['missing-row', 'explicit-null'].includes(report.name);
    const canceled = ['cancel-between', 'cancel-after-reservation'].includes(report.name);
    const failed = ['abort-second', 'projection-failure'].includes(report.name);
    assert.equal(report.result, empty ? 'published' : canceled ? 'superseded' : failed ? 'rejected' : 'conflict', report.name);
    assert.equal(report.reads, empty || ['undefined-baseline', 'canonical-mismatch', 'cancel-between'].includes(report.name) ? 1 : 2, report.name);
    assert.equal(report.publications, empty ? 1 : 0, report.name);
    if (report.name === 'projection-failure') {
      assert.equal(report.errorName, 'QuotaExceededError');
      assert.equal(report.errorMessage, 'Sample projection failure');
    } else if (report.name === 'abort-second') {
      assert.equal(report.abortError, 'AbortError');
      assert.ok(report.errorName === 'AbortError'
        || (report.errorName === 'Error' && report.errorMessage === 'Shared draft coordination failed.')
        || report.errorIsNull, 'Only the explicit transaction abort may reject');
    } else {
      assert.equal(report.errorName, null, report.name);
      assert.equal(report.errorMessage, null, report.name);
    }
    assert.ok(report.sharedPreserved && report.canonicalPreserved && report.privatePreserved, report.name);
  }
  return results;
}
