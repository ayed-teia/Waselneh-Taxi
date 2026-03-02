export interface RetryTask {
  id: string;
  label: string;
  run: () => Promise<void>;
}

type QueueListener = (pendingCount: number) => void;

export class RetryQueue {
  private queue: RetryTask[] = [];
  private listeners = new Set<QueueListener>();
  private draining = false;

  subscribe(listener: QueueListener): () => void {
    this.listeners.add(listener);
    listener(this.queue.length);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getPendingCount(): number {
    return this.queue.length;
  }

  enqueue(task: Omit<RetryTask, 'id'>): void {
    this.queue.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...task,
    });
    this.emit();
  }

  async drain(): Promise<void> {
    if (this.draining || this.queue.length === 0) return;
    this.draining = true;

    const failed: RetryTask[] = [];
    for (const task of this.queue) {
      try {
        await task.run();
      } catch {
        failed.push(task);
      }
    }

    this.queue = failed;
    this.draining = false;
    this.emit();
  }

  private emit(): void {
    const size = this.queue.length;
    this.listeners.forEach((listener) => listener(size));
  }
}
