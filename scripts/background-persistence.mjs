// Full-state snapshots can replace pending snapshots, never an active write.
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
