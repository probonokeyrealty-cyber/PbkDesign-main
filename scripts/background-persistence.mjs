// Full-state snapshots can replace pending snapshots, never an active write.
export function createCoalescedPersistence({ persist }) {
  let pending = null;
  let running = false;
  async function drain() {
    running = true;
    while (pending) {
      const batch = pending;
      pending = null;
      try {
        const result = await persist(batch.value);
        for (const waiter of batch.waiters) waiter.resolve(result);
      } catch (error) {
        for (const waiter of batch.waiters) waiter.reject(error);
      }
    }
    running = false;
  }
  return {
    schedule(value) {
      return new Promise((resolve, reject) => {
        if (!pending) pending = { value, waiters: [] };
        pending.value = value;
        pending.waiters.push({ resolve, reject });
        if (!running) void drain();
      });
    },
  };
}

export function createBackgroundPersistence({ persist, onError = () => {} }) {
  let pending = null;
  let running = null;

  function start() {
    running = Promise.resolve().then(async () => {
      while (pending) {
        const { value } = pending;
        pending = null;
        try {
          await persist(value);
        } catch (error) {
          onError(error, value);
        }
      }
    }).finally(() => {
      running = null;
      if (pending) start();
    });
  }

  async function drain() {
    while (running) await running;
  }

  return {
    schedule(value) {
      pending = { value };
      if (!running) start();
      return drain();
    },
    drain,
  };
}
