// Serializes writes to one import source. A failed write does not poison the
// queue, but its caller still receives the rejection.
export function createSerializedWriter() {
  let tail = Promise.resolve();
  return {
    enqueue(write) {
      const run = tail.catch(() => {}).then(write);
      tail = run.catch(() => {});
      return run;
    },
    flush() { return tail; }
  };
}
