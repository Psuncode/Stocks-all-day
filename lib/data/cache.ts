const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes

export class MemCache<T> {
  private data: T | null = null;
  private expiresAt = 0;
  private ttl: number;

  constructor(ttlMs = DEFAULT_TTL) {
    this.ttl = ttlMs;
  }

  get(): T | null {
    if (this.data !== null && Date.now() < this.expiresAt) return this.data;
    return null;
  }

  set(value: T): T {
    this.data = value;
    this.expiresAt = Date.now() + this.ttl;
    return value;
  }

  clear(): void {
    this.data = null;
    this.expiresAt = 0;
  }
}
