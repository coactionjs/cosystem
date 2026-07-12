export interface RuntimeAsyncContext<T> {
  getStore(): T | undefined;
  run<TResult>(store: T, callback: () => TResult): TResult;
}

interface AsyncLocalStorageConstructor {
  new <T>(): RuntimeAsyncContext<T>;
}

interface AsyncHooksModule {
  readonly AsyncLocalStorage?: AsyncLocalStorageConstructor;
}

interface RuntimeProcess {
  getBuiltinModule?(name: string): unknown;
}

export function createRuntimeAsyncContext<T>(): RuntimeAsyncContext<T> | undefined {
  const runtimeProcess = (globalThis as typeof globalThis & { process?: RuntimeProcess }).process;

  try {
    const asyncHooks = runtimeProcess?.getBuiltinModule?.("node:async_hooks") as
      | AsyncHooksModule
      | undefined;
    const AsyncLocalStorage = asyncHooks?.AsyncLocalStorage;

    return AsyncLocalStorage === undefined ? undefined : new AsyncLocalStorage<T>();
  } catch {
    return undefined;
  }
}
