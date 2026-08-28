export function withTimeout<T>(promise: PromiseLike<T> | Thenable<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ]);
}