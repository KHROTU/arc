export class AsyncEventQueue<T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private closed = false;
  private resolveNext: (() => void) | undefined;
  push(event: T): void {
    if (this.closed) return;
    this.queue.push(event);
    this.wake();
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.wake();
  }
  get isClosed(): boolean {
    return this.closed;
  }
  private wake(): void {
    const r = this.resolveNext;
    this.resolveNext = undefined;
    r?.();
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.queue.length) {
          return Promise.resolve({ value: this.queue.shift()!, done: false });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as unknown as T, done: true });
        }
        return new Promise<IteratorResult<T>>((resolve) => {
          const waiter = () => {
            if (this.queue.length) {
              resolve({ value: this.queue.shift()!, done: false });
            } else if (this.closed) {
              resolve({ value: undefined as unknown as T, done: true });
            } else {
              this.resolveNext = waiter;
            }
          };
          this.resolveNext = waiter;
        });
      },
      return: (): Promise<IteratorResult<T>> => {
        this.closed = true;
        this.queue = [];
        return Promise.resolve({ value: undefined as unknown as T, done: true });
      },
    };
  }
}
export function readableToAsyncIterable(stream: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          const r = await reader.read();
          if (r.done) return { value: undefined as unknown as string, done: true };
          return { value: decoder.decode(r.value, { stream: true }), done: false };
        },
        async return() {
try { await reader.cancel(); } catch {  }
          return { value: undefined as unknown as string, done: true };
        },
      };
    },
  };
}