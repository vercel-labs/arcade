export type ResourceFactory<K, V> = (key: K) => V;
export type ResourceDisposer<K, V> = (value: V, key: K) => void;

/** Lazy, explicitly owned resources such as parsed meshes and generated textures. */
export class ResourceCache<K, V> {
  private readonly resources = new Map<K, V>();

  constructor(private readonly disposer?: ResourceDisposer<K, V>) {}

  get size(): number {
    return this.resources.size;
  }

  has(key: K): boolean {
    return this.resources.has(key);
  }

  get(key: K): V | undefined {
    return this.resources.get(key);
  }

  getOrCreate(key: K, factory: ResourceFactory<K, V>): V {
    if (this.resources.has(key)) return this.resources.get(key) as V;
    const resource = factory(key);
    this.resources.set(key, resource);
    return resource;
  }

  set(key: K, resource: V): this {
    const existed = this.resources.has(key);
    const previous = this.resources.get(key);
    if (existed && previous !== resource) this.disposer?.(previous as V, key);
    this.resources.set(key, resource);
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
    return this.resources.keys();
  }

  values(): IterableIterator<V> {
    return this.resources.values();
  }
}
