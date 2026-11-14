export function createSessionLifetime(onExpire) {
  let deadline = 0,
    timer;
  return {
    arm(seconds) {
      clearTimeout(timer);
      deadline = Date.now() + Math.max(0, seconds) * 1000;
      timer = setTimeout(onExpire, Math.max(0, seconds) * 1000);
    },
    clear() {
      clearTimeout(timer);
      deadline = 0;
    },
    expired() {
      return deadline > 0 && Date.now() >= deadline;
    },
  };
}
