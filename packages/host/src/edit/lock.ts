export class FileLockManager {
  private locks = new Map<string, Promise<void>>();
  private resolvers = new Map<string, () => void>();
  async acquire(file: string): Promise<void> {
    const pending = this.locks.get(file);
    if (pending) await pending;
    const promise = new Promise<void>((resolve) => {
      this.resolvers.set(file, resolve);
    });
    this.locks.set(file, promise);
  }
  release(file: string): void {
    const release = this.resolvers.get(file);
    if (release) {
      release();
      this.locks.delete(file);
      this.resolvers.delete(file);
    }
  }
}
export const fileLock = new FileLockManager();