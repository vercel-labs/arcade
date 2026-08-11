export type ResourceFactory<K, V> = (key: K) => V;
export type ResourceDisposer<K, V> = (value: V, key: K) => void;

export interface ResourceCacheOptions<K, V> {
  /** Maximum retained entries. Least-recently-used entries are disposed first. */
  maxEntries?: number;
  dispose?: ResourceDisposer<K, V>;
}

/** Lazy, explicitly owned resources such as parsed meshes and generated textures. */
export class ResourceCache<K, V> {
  private readonly resources = new Map<K, V>();
  private readonly disposer?: ResourceDisposer<K, V>;
  private readonly maxEntries: number;

  constructor(disposer?: ResourceDisposer<K, V>);
  constructor(options?: ResourceCacheOptions<K, V>);
  constructor(options: ResourceDisposer<K, V> | ResourceCacheOptions<K, V> = {}) {
    if (typeof options === 'function') {
      this.disposer = options;
      this.maxEntries = Infinity;
      return;
    }
    const maxEntries = options.maxEntries ?? Infinity;
    if (maxEntries !== Infinity && (!Number.isInteger(maxEntries) || maxEntries < 1)) {
      throw new RangeError(`ResourceCache maxEntries must be a positive integer, got ${maxEntries}`);
    }
    this.disposer = options.dispose;
    this.maxEntries = maxEntries;
  }

  get size(): number {
    return this.resources.size;
  }

  has(key: K): boolean {
    return this.resources.has(key);
  }

  get(key: K): V | undefined {
    const resource = this.resources.get(key);
    if (resource === undefined && !this.resources.has(key)) return undefined;
    // Unbounded caches do not need recency bookkeeping. Besides avoiding a hot-path Map mutation,
    // this preserves their historical insertion-order iteration semantics.
    if (this.maxEntries !== Infinity) this.touch(key, resource as V);
    return resource;
  }

  getOrCreate(key: K, factory: ResourceFactory<K, V>): V {
    const existing = this.get(key);
    if (existing !== undefined || this.resources.has(key)) return existing as V;
    const resource = factory(key);
    this.set(key, resource);
    return resource;
  }

  set(key: K, resource: V): this {
    const existed = this.resources.has(key);
    const previous = this.resources.get(key);
    if (existed && previous !== resource) this.disposer?.(previous as V, key);
    if (existed && this.maxEntries !== Infinity) this.resources.delete(key);
    this.resources.set(key, resource);
    this.evictOverflow();
    return this;
  }

  delete(key: K): boolean {
    if (!this.resources.has(key)) return false;
    const resource = this.resources.get(key) as V;
    this.resources.delete(key);
    this.disposer?.(resource, key);
    return true;
  }

  clear(): void {
    if (this.disposer) {
      for (const [key, resource] of this.resources) this.disposer(resource, key);
    }
    this.resources.clear();
  }

  keys(): IterableIterator<K> {
    if (this.maxEntries === Infinity) return this.resources.keys();
    // A bounded cache may retouch entries during get(). Snapshot iteration so a caller can safely
    // read every yielded key without the live Map iterator revisiting those entries forever.
    return [...this.resources.keys()][Symbol.iterator]();
  }

  values(): IterableIterator<V> {
    if (this.maxEntries === Infinity) return this.resources.values();
    return [...this.resources.values()][Symbol.iterator]();
  }

  private touch(key: K, resource: V): void {
    this.resources.delete(key);
    this.resources.set(key, resource);
  }

  private evictOverflow(): void {
    while (this.resources.size > this.maxEntries) {
      const oldest = this.resources.keys().next();
      if (oldest.done) return;
      this.delete(oldest.value);
    }
  }
}
