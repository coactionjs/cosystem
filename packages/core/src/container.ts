import {
  AmbiguousProviderError,
  AsyncProviderInSyncResolutionError,
  CircularDependencyError,
  DuplicateProviderError,
  FrozenContainerError,
  LifetimeLeakError,
  MissingProviderError,
} from "./errors.js";
import { runWithInjectContext } from "./inject.js";
import { normalizeProvider } from "./provider.js";
import { tokenName } from "./token.js";
import type {
  BuildOptions,
  Constructor,
  Container,
  ContainerImpl,
  ContainerOptions,
  DependencySpec,
  DisposableInstance,
  InjectionToken,
  ProviderInput,
  ProviderRecord,
  ResolutionContext,
  Scope,
  ScopeOptions,
} from "./types.js";

const asyncDisposeSymbol: symbol | undefined = Symbol.asyncDispose;
const disposeSymbol: symbol | undefined = Symbol.dispose;

export function createContainer(options: ContainerOptions = {}): Container {
  return new RuntimeContainer(options);
}

class RuntimeContainer implements ContainerImpl {
  readonly parent: ContainerImpl | undefined;
  readonly strictScopes: boolean;
  readonly records = new Map<InjectionToken, ProviderRecord[]>();
  readonly scopedCache = new Map<ProviderRecord, unknown>();
  readonly created: DisposableInstance[] = [];
  readonly root: ContainerImpl;
  readonly singletonCache = new Map<ProviderRecord, unknown>();
  frozen = false;

  constructor(options: ContainerOptions = {}) {
    this.parent = options.parent as ContainerImpl | undefined;
    this.strictScopes = options.strictScopes ?? this.parent?.strictScopes ?? true;
    this.root = this.parent?.root ?? this;
  }

  get<T>(token: InjectionToken<T>): T;
  get<T>(token: InjectionToken<T>, options: { readonly optional: true }): T | undefined;
  get<T>(token: InjectionToken<T>, options?: { readonly optional: true }): T | undefined {
    const record =
      options?.optional === true
        ? this.getSingleRecord(token, true)
        : this.getSingleRecord(token, false);

    if (record === undefined) {
      return undefined;
    }

    const context = this.createResolutionContext("sync");
    const value = this.resolveRecord(record, context);

    if (isPromiseLike(value)) {
      observePromise(value);
      throw new AsyncProviderInSyncResolutionError(record.tokenName);
    }

    return value as T;
  }

  getAll<T>(token: InjectionToken<T>): T[] {
    const records = this.getAllRecords(token);
    const context = this.createResolutionContext("sync");

    return records.map((record) => {
      const value = this.resolveRecord(record, context);

      if (isPromiseLike(value)) {
        observePromise(value);
        throw new AsyncProviderInSyncResolutionError(record.tokenName);
      }

      return value as T;
    });
  }

  async getAsync<T>(token: InjectionToken<T>): Promise<T> {
    const record = this.getSingleRecord(token, false);
    const context = this.createResolutionContext("async");
    return (await this.resolveRecord(record, context)) as T;
  }

  has(token: InjectionToken): boolean {
    return this.findRecords(token).length > 0;
  }

  provide(provider: ProviderInput): void {
    this.assertMutable();
    const record = normalizeProvider(provider);
    const existing = this.records.get(record.token) ?? [];

    if (!record.multi && existing.some((candidate) => !candidate.multi)) {
      throw new DuplicateProviderError(record.tokenName);
    }

    this.records.set(record.token, [...existing, record]);
  }

  override(provider: ProviderInput): void {
    this.assertMutable();
    const record = normalizeProvider(provider);
    this.records.set(record.token, [record]);
  }

  createScope(options: ScopeOptions = {}): Container {
    return new RuntimeContainer({
      parent: this,
      strictScopes: options.strictScopes ?? this.strictScopes,
    });
  }

  build<T>(target: Constructor<T>, options: BuildOptions = {}): T {
    const deps =
      options.deps ?? (target as { readonly inject?: readonly DependencySpec[] }).inject ?? [];
    const context = this.createResolutionContext("sync");
    const values = this.resolveDependencies(deps, context);

    if (isPromiseLike(values)) {
      observePromise(values);
      throw new AsyncProviderInSyncResolutionError(target.name);
    }

    return Reflect.construct(target, values) as T;
  }

  async buildAsync<T>(target: Constructor<T>, options: BuildOptions = {}): Promise<T> {
    const deps =
      options.deps ?? (target as { readonly inject?: readonly DependencySpec[] }).inject ?? [];
    const context = this.createResolutionContext("async");
    const values = await this.resolveDependencies(deps, context);
    return Reflect.construct(target, values) as T;
  }

  freeze(): void {
    this.frozen = true;
  }

  runWithResolutionContext<T>(callback: () => T): T {
    return runWithInjectContext(this.createResolutionContext("sync"), callback);
  }

  async dispose(): Promise<void> {
    const errors: unknown[] = [];

    for (const entry of [...this.created].toReversed()) {
      if (entry.disposed) {
        continue;
      }

      entry.disposed = true;

      try {
        // eslint-disable-next-line no-await-in-loop -- disposal order is observable and must remain sequential.
        await disposeValue(entry.value, entry.record);
      } catch (error) {
        errors.push(error);
      }
    }

    this.created.length = 0;
    this.scopedCache.clear();

    if (this.root === this) {
      this.singletonCache.clear();
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, "One or more providers failed to dispose.");
    }
  }

  private assertMutable(): void {
    if (this.frozen) {
      throw new FrozenContainerError();
    }
  }

  private createResolutionContext(mode: "sync" | "async"): ResolutionContext {
    let context: ResolutionContext;

    context = {
      stack: [],
      resolutionCache: new Map(),
      mode,
      requestContainer: this,
      resolve: <T>(token: InjectionToken<T>) => this.resolveInjected(token, context) as T,
    };

    return context;
  }

  private createChildResolutionContext(
    context: ResolutionContext,
    record: ProviderRecord,
  ): ResolutionContext {
    let childContext: ResolutionContext;

    childContext = {
      stack: [...context.stack, record],
      resolutionCache: context.resolutionCache,
      mode: context.mode,
      requestContainer: context.requestContainer,
      resolve: <T>(token: InjectionToken<T>) => this.resolveInjected(token, childContext) as T,
    };

    return childContext;
  }

  private getSingleRecord(token: InjectionToken, optional: false): ProviderRecord;
  private getSingleRecord(token: InjectionToken, optional: true): ProviderRecord | undefined;
  private getSingleRecord(token: InjectionToken, optional: boolean): ProviderRecord | undefined {
    const records = this.findRecords(token);

    if (records.length === 0) {
      if (optional) {
        return undefined;
      }

      throw new MissingProviderError(tokenName(token), []);
    }

    const nonMultiRecords = records.filter((record) => !record.multi);

    if (nonMultiRecords.length === 1) {
      return nonMultiRecords[0]!;
    }

    if (records.length === 1) {
      return records[0]!;
    }

    throw new AmbiguousProviderError(tokenName(token));
  }

  private getAllRecords(token: InjectionToken): ProviderRecord[] {
    return this.getAllRecordsFromHierarchy(token);
  }

  findRecords(token: InjectionToken): ProviderRecord[] {
    const localRecords = this.records.get(token);

    if (localRecords !== undefined && localRecords.length > 0) {
      return localRecords;
    }

    return this.parent?.findRecords(token) ?? [];
  }

  getAllRecordsFromHierarchy(token: InjectionToken): ProviderRecord[] {
    const parentRecords = this.parent?.getAllRecordsFromHierarchy(token) ?? [];
    const localRecords = this.records.get(token) ?? [];
    return [...parentRecords, ...localRecords];
  }

  private resolveRecord(
    record: ProviderRecord,
    context: ResolutionContext,
  ): unknown | Promise<unknown> {
    this.assertNoCycle(record, context);
    this.assertLifetimeSafe(record, context);

    const cached = this.getCached(record, context);

    if (cached.found) {
      return cached.value;
    }

    const childContext = this.createChildResolutionContext(context, record);
    const value = this.createValue(record, childContext);

    if (isPromiseLike(value)) {
      if (context.mode === "sync") {
        observePromise(value);
        throw new AsyncProviderInSyncResolutionError(record.tokenName);
      }

      return this.cachePending(record, value, context);
    }

    this.setCached(record, value, context);
    return value;
  }

  private resolveInjected<T>(token: InjectionToken<T>, context: ResolutionContext): T {
    const record = this.getRequiredRecord(token, context);
    const value = this.resolveRecord(record, context);

    if (isPromiseLike(value)) {
      observePromise(value);
      throw new AsyncProviderInSyncResolutionError(record.tokenName);
    }

    return value as T;
  }

  private createValue(
    record: ProviderRecord,
    context: ResolutionContext,
  ): unknown | Promise<unknown> {
    switch (record.provider.kind) {
      case "class": {
        const provider = record.provider;
        const deps = this.resolveDependencies(record.deps, context);

        if (isPromiseLike(deps)) {
          return Promise.resolve(deps).then((values) =>
            Reflect.construct(provider.useClass, values),
          );
        }

        return Reflect.construct(provider.useClass, deps);
      }

      case "value":
        return record.provider.useValue;

      case "factory": {
        const provider = record.provider;
        const deps = this.resolveDependencies(record.deps, context);

        if (isPromiseLike(deps)) {
          return Promise.resolve(deps).then((values) =>
            runWithInjectContext(context, () => provider.useFactory(...values)),
          );
        }

        return runWithInjectContext(context, () => provider.useFactory(...deps));
      }

      case "existing":
        return this.resolveDependency(record.provider.useExisting, context);
    }
  }

  private resolveDependencies(
    deps: readonly DependencySpec[],
    context: ResolutionContext,
  ): unknown[] | Promise<unknown[]> {
    const values: unknown[] = Array.from({ length: deps.length });
    const asyncValues: Promise<unknown>[] = [];

    for (const [index, dep] of deps.entries()) {
      const value = this.resolveDependency(dep, context);

      if (isPromiseLike(value)) {
        asyncValues.push(
          Promise.resolve(value).then((resolved) => {
            values[index] = resolved;
            return resolved;
          }),
        );
      } else {
        values[index] = value;
      }
    }

    if (asyncValues.length === 0) {
      return values;
    }

    return Promise.all(asyncValues).then(() => values);
  }

  private resolveDependency(
    dep: DependencySpec,
    context: ResolutionContext,
  ): unknown | Promise<unknown> {
    if (isDependencyObject(dep)) {
      if (dep.many === true) {
        const records = this.getAllRecords(dep.token);
        return this.resolveAllRecords(records, context);
      }

      const record =
        dep.optional === true
          ? this.getSingleRecord(dep.token, true)
          : this.getRequiredRecord(dep.token, context);

      if (record === undefined) {
        return undefined;
      }

      return this.resolveRecord(record, context);
    }

    const record = this.getRequiredRecord(dep, context);
    return this.resolveRecord(record, context);
  }

  private getRequiredRecord(token: InjectionToken, context: ResolutionContext): ProviderRecord {
    const record = this.getSingleRecord(token, true);

    if (record === undefined) {
      throw new MissingProviderError(
        tokenName(token),
        context.stack.map((entry) => entry.tokenName),
      );
    }

    return record;
  }

  private resolveAllRecords(
    records: readonly ProviderRecord[],
    context: ResolutionContext,
  ): unknown[] | Promise<unknown[]> {
    const values = records.map((record) => this.resolveRecord(record, context));

    if (values.some(isPromiseLike)) {
      return Promise.all(values);
    }

    return values;
  }

  private getCached(
    record: ProviderRecord,
    context: ResolutionContext,
  ): { readonly found: boolean; readonly value?: unknown } {
    const cache = this.cacheFor(record, context);

    if (cache === undefined || !cache.has(record)) {
      return { found: false };
    }

    return { found: true, value: cache.get(record) };
  }

  private setCached<T>(record: ProviderRecord, value: T, context: ResolutionContext): void {
    const cache = this.cacheFor(record, context);

    if (cache === undefined) {
      this.trackCreated(record, value, context);
      return;
    }

    if (!cache.has(record)) {
      cache.set(record, value);
      this.trackCreated(record, value, context);
    }
  }

  private cachePending(
    record: ProviderRecord,
    value: PromiseLike<unknown>,
    context: ResolutionContext,
  ): Promise<unknown> {
    const cache = this.cacheFor(record, context);

    if (cache === undefined) {
      return Promise.resolve(value).then((resolved) => {
        this.trackCreated(record, resolved, context);
        return resolved;
      });
    }

    let pending: Promise<unknown>;
    pending = Promise.resolve(value).then(
      (resolved) => {
        if (cache.get(record) === pending) {
          cache.set(record, resolved);
          this.trackCreated(record, resolved, context);
        }

        return resolved;
      },
      (error: unknown) => {
        if (cache.get(record) === pending) {
          cache.delete(record);
        }

        throw error;
      },
    );
    cache.set(record, pending);
    return pending;
  }

  private cacheFor(
    record: ProviderRecord,
    context: ResolutionContext,
  ): Map<ProviderRecord, unknown> | undefined {
    switch (record.scope) {
      case "singleton":
        return this.root.singletonCache;
      case "scoped":
        return context.requestContainer.scopedCache;
      case "resolution":
        return context.resolutionCache;
      case "transient":
        return undefined;
    }
  }

  private trackCreated<T>(record: ProviderRecord, value: T, context: ResolutionContext): void {
    if (value === null || (typeof value !== "object" && typeof value !== "function")) {
      return;
    }

    const owner = record.scope === "singleton" ? this.root : context.requestContainer;
    owner.created.push({ record, value, disposed: false });
  }

  private assertNoCycle(record: ProviderRecord, context: ResolutionContext): void {
    const existingIndex = context.stack.indexOf(record);

    if (existingIndex === -1) {
      return;
    }

    const cycle = [...context.stack.slice(existingIndex), record].map((entry) => entry.tokenName);
    throw new CircularDependencyError(cycle);
  }

  private assertLifetimeSafe(record: ProviderRecord, context: ResolutionContext): void {
    if (!this.strictScopes || record.leakSafe || context.stack.length === 0) {
      return;
    }

    const parent = context.stack.at(-1);

    if (parent === undefined) {
      return;
    }

    if (isLifetimeLeak(parent.scope, record.scope)) {
      throw new LifetimeLeakError(parent.tokenName, parent.scope, record.tokenName, record.scope);
    }
  }
}

function isDependencyObject(dep: DependencySpec): dep is {
  readonly token: InjectionToken;
  readonly optional?: boolean;
  readonly many?: boolean;
} {
  return typeof dep === "object" && dep !== null && "token" in dep;
}

function isPromiseLike<T = unknown>(value: unknown): value is PromiseLike<T> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function observePromise(value: PromiseLike<unknown>): void {
  void Promise.resolve(value).catch(() => undefined);
}

function isLifetimeLeak(parentScope: Scope, childScope: Scope): boolean {
  if (parentScope === "singleton") {
    return childScope === "scoped" || childScope === "resolution" || childScope === "transient";
  }

  if (parentScope === "scoped") {
    return childScope === "resolution" || childScope === "transient";
  }

  return false;
}

async function disposeValue(value: unknown, record: ProviderRecord): Promise<void> {
  if (record.dispose !== undefined) {
    await record.dispose(value);
  }

  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return;
  }

  const maybeDisposable = value as Record<PropertyKey, unknown>;

  if (
    asyncDisposeSymbol !== undefined &&
    typeof maybeDisposable[asyncDisposeSymbol] === "function"
  ) {
    await (maybeDisposable[asyncDisposeSymbol] as () => Promise<void> | void)();
    return;
  }

  if (disposeSymbol !== undefined && typeof maybeDisposable[disposeSymbol] === "function") {
    (maybeDisposable[disposeSymbol] as () => void)();
    return;
  }

  if (typeof maybeDisposable.dispose === "function") {
    await (maybeDisposable.dispose as () => Promise<void> | void)();
    return;
  }

  if (typeof maybeDisposable.destroy === "function") {
    await (maybeDisposable.destroy as () => Promise<void> | void)();
  }
}
