import { z, ZodType, ZodTypeDef } from "zod";
import EventEmitter from "eventemitter3";
import LockController from "./lock-controller";

export interface SyncStoreRef<V> {
  get(): V | null;
  set(value: V | null): void;
  remove(): void;
}

export interface SyncStore<V> {
  addListener(event: "change", fn: () => void): void;
  removeListener(event: "change", fn: () => void): void;
  removeAllListeners(): void;
  lock<T>(
    criticalSection: (ref: SyncStoreRef<V>) => PromiseLike<T> | T,
    controller?: LockController,
  ): Promise<T>;
}

export interface LocalStorageSyncStoreEventTypes<
  Z extends ZodType<unknown, ZodTypeDef, unknown>,
> {
  change: (this: LocalStorageSyncStore<Z>) => void;
}

class LocalStorageSyncStore<Z extends ZodType<unknown, ZodTypeDef, unknown>>
  implements SyncStore<z.output<Z>>
{
  private events: EventEmitter<
    LocalStorageSyncStoreEventTypes<Z>,
    LocalStorageSyncStore<Z>
  >;
  private listener: ((this: Window, e: StorageEvent) => void) | null = null;
  constructor(
    private Schema: Z,
    private key: string,
    options: { storage?: Storage; locks: LockManager },
  ) {
    this.storage = options.storage ?? window.localStorage;
    this.locks = options.locks ?? window.navigator.locks;
    this.events = new EventEmitter();
  }
  private storage: Storage;
  private locks: LockManager;
  addListener<E extends keyof LocalStorageSyncStoreEventTypes<Z>>(
    event: E,
    fn: LocalStorageSyncStoreEventTypes<Z>[E],
  ) {
    this.events.addListener(event, fn, this);
    this.updateListener();
  }
  removeListener<E extends keyof LocalStorageSyncStoreEventTypes<Z>>(
    event: E,
    fn: LocalStorageSyncStoreEventTypes<Z>[E],
  ) {
    this.events.removeListener(event, fn, this);
    this.updateListener();
  }
  removeAllListeners() {
    this.events.removeAllListeners();
    this.updateListener();
  }
  private updateListener() {
    const count = this.events.listenerCount("change");
    if (count <= 0 && this.listener !== null) {
      window.removeEventListener("storage", this.listener);
    }
    if (count > 0 && this.listener === null) {
      this.listener = (e: StorageEvent) => {
        if (e.storageArea === this.storage && e.key === this.key) {
          this.events.emit("change");
        }
      };
      window.addEventListener("storage", this.listener);
    }
  }
  lock<T>(
    criticalSection: (ref: SyncStoreRef<z.output<Z>>) => PromiseLike<T> | T,
    controller?: LockController,
  ): Promise<T> {
    const signal = controller?.startWaiting();
    const storage = this.storage;
    const key = this.key;
    const Schema = this.Schema;
    const emitChange = () => this.events.emit("change");
    const ref: SyncStoreRef<z.output<Z>> = {
      get() {
        const item = storage.getItem(key);
        if (item === null) {
          return null;
        }
        const state: unknown = JSON.parse(item);
        return Schema.parse(state);
      },
      set(value: z.output<Z> | null) {
        if (value === null) {
          this.remove();
        } else {
          storage.setItem(key, JSON.stringify(value));
        }
        emitChange();
      },
      remove() {
        storage.removeItem(key);
        emitChange();
      },
    };
    return this.locks.request(
      key,
      {
        signal,
      },
      async () => {
        controller?.stopWaiting(signal);
        return await criticalSection(ref);
      },
    ) as Promise<T>;
  }
}

export default LocalStorageSyncStore;
