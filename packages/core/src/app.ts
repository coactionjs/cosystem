import {
  computed as createCoactionComputed,
  create as createCoactionStore,
  createReactiveTracker,
  type Store,
} from "coaction";

import { createContainer } from "./container.js";
import { CosystemError, DuplicateProviderError } from "./errors.js";
import { runWithInjectContext } from "./inject.js";
import {
  isLazyModule,
  normalizeLazyModuleProviders,
  type AppProviderInput,
  type LazyModule,
} from "./lazyModule.js";
import { getModuleMetadata, type ModuleMetadata } from "./metadata.js";
import { provide } from "./provider.js";
import { tokenName } from "./token.js";
import type {
  ClassProvideOptions,
  Constructor,
  Container,
  ContainerImpl,
  InjectionToken,
  Provider,
  ProviderInput,
  ResolutionContext,
  ScopeOptions,
} from "./types.js";

export interface EngineOptions {
  readonly patches?: boolean;
  readonly transport?: unknown;
}

export interface AppDevOptions {
  readonly strictActions?: boolean;
}

export interface CreateAppOptions {
  readonly providers?: readonly AppProviderInput[];
  readonly plugins?: readonly Plugin[];
  readonly parent?: App | Container;
  readonly devOptions?: AppDevOptions;
  readonly engine?: EngineOptions;
}

export interface InternalCreateAppOptions extends CreateAppOptions {
  readonly overrides?: readonly ProviderInput[];
  readonly testInspector?: MutableTestInspector;
}

export interface AppState {
  readonly version: number;
}

export interface AppScope {
  readonly container: Container;
}

export interface App {
  readonly state: AppState;
  readonly started: boolean;
  readonly store: Store<RootState>;

  get<T>(token: InjectionToken<T>): T;
  getAsync<T>(token: InjectionToken<T>): Promise<T>;
  getAll<T>(token: InjectionToken<T>): T[];
  getModule<T>(token: InjectionToken<T>): T;
  getModuleByName<T = unknown>(name: string): T;
  watch<T>(
    read: () => T,
    listener: (value: T, previous: T) => void,
    options?: WatchOptions<T>,
  ): () => void;
  start(): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
  createScope(options?: ScopeOptions): AppScope;
  load(module: LazyModule): Promise<LazyModuleLoadResult>;
  load(): Promise<readonly LazyModuleLoadResult[]>;
}

export interface WatchOptions<T> {
  readonly equals?: (value: T, previous: T) => boolean;
  readonly immediate?: boolean;
}

export interface Plugin {
  readonly name?: string;
  setup?(app: App): void | Promise<void>;
  onModuleCreated?(event: ModuleCreatedEvent): void;
  onActionStart?(event: ActionEvent): void;
  onActionEnd?(event: ActionEvent): void;
  onPatch?(event: PatchEvent): void;
  onStateChange?(event: StateChangeEvent): void;
  onError?(error: unknown, context: ErrorContext): void;
  dispose?(): void | Promise<void>;
}

export interface ModuleCreatedEvent {
  readonly name: string;
  readonly token: InjectionToken;
  readonly instance: unknown;
}

export interface LazyModuleLoadResult {
  readonly scope: AppScope;
  readonly modules: readonly ModuleCreatedEvent[];
}

export interface ActionEvent {
  readonly module: string;
  readonly method: string;
  readonly args: readonly unknown[];
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly error?: unknown;
}

export interface StateChangeEvent {
  readonly state: unknown;
}

export interface PatchEvent {
  readonly patches: readonly unknown[];
  readonly inversePatches: readonly unknown[];
}

export interface ErrorContext {
  readonly phase: string;
}

export interface TestAppInspector {
  getActions(): readonly ActionEvent[];
  getState(): unknown;
  getPatches(): readonly unknown[];
  clearActions(): void;
  clearPatches(): void;
  flushEffects(): Promise<void>;
}

export interface MutableTestInspector extends TestAppInspector {
  recordAction(event: ActionEvent): void;
  recordPatch(patch: unknown): void;
  recordState(state: unknown): void;
  setFlushEffects(callback: () => Promise<void>): void;
}

type RootState = Record<string, Record<PropertyKey, unknown>>;
type StoreSetState = Store<RootState>["setState"];

interface CoactionStoreOptions {
  readonly name: string;
  readonly sliceMode: "single";
  readonly enablePatches?: boolean;
  readonly transport?: unknown;
}

interface ModuleBinding {
  readonly name: string;
  readonly token: InjectionToken;
  readonly instance: Record<PropertyKey, unknown>;
  readonly metadata: ModuleMetadata;
  readonly originalActions: Map<PropertyKey, (...args: unknown[]) => unknown>;
  readonly originalComputed: Map<PropertyKey, () => unknown>;
  readonly computedAccessors: Map<PropertyKey, () => unknown>;
  readonly reactiveSlice: boolean;
  activeDraft: Record<PropertyKey, unknown> | undefined;
  actionDepth: number;
}

interface RuntimeModuleMetadata {
  readonly app: App;
  readonly name: string;
  readonly token: InjectionToken;
}

interface LifecycleModule {
  onInit?(): void | Promise<void>;
  onStart?(): void | Promise<void>;
  onStop?(): void | Promise<void>;
  onDispose?(): void | Promise<void>;
}

const runtimeModuleMetadataKey = Symbol.for("@cosystem/core/runtimeModule");
const appContainerMap = new WeakMap<App, Container>();

export function createApp(options: CreateAppOptions = {}): App {
  return createAppInternal(options);
}

export function createAppInternal(options: InternalCreateAppOptions = {}): App {
  const parent = isApp(options.parent) ? getAppContainer(options.parent) : options.parent;
  const container = parent === undefined ? createContainer() : createContainer({ parent });
  const moduleTokens: InjectionToken[] = [];
  const lazyModules: LazyModule[] = [];

  for (const provider of options.providers ?? []) {
    if (isLazyModule(provider)) {
      lazyModules.push(provider);
      continue;
    }

    const normalized = normalizeAppProvider(provider);
    container.provide(normalized.provider);

    if (normalized.moduleToken !== undefined) {
      moduleTokens.push(normalized.moduleToken);
    }
  }

  for (const override of options.overrides ?? []) {
    const normalized = normalizeAppProvider(override);

    if (
      normalized.moduleToken !== undefined &&
      !moduleTokens.some((moduleToken) => moduleToken === normalized.moduleToken)
    ) {
      throw new CosystemError(
        `Cannot add ${tokenName(normalized.moduleToken)} as a new CoSystem module through overrides.`,
      );
    }

    container.override(normalized.provider);
  }

  container.freeze();

  const modules = instantiateModules(container, moduleTokens);
  const rootState = createRootState(modules);
  const store = createCoactionStore(
    rootState,
    createStoreOptions(options.engine, shouldEnablePatches(options)) as never,
  );
  const state: { version: number } = { version: 0 };
  const app = new RuntimeApp({
    container,
    devOptions: options.devOptions ?? {},
    lazyModules,
    modules,
    plugins: options.plugins ?? [],
    state,
    store,
    ...(options.testInspector === undefined ? {} : { testInspector: options.testInspector }),
  });

  app.bindModules();
  app.attachRuntimeMetadata();
  instantiateEagerProviders(container);
  app.runModuleCreatedHooks();
  app.init();
  appContainerMap.set(app, container);

  return app;
}

class RuntimeApp implements App {
  readonly state: AppState;
  readonly store: Store<RootState>;

  readonly #container: Container;
  private readonly devOptions: AppDevOptions;
  private readonly modules: ModuleBinding[];
  private readonly pendingLazyModules: LazyModule[];
  private readonly moduleByToken = new Map<InjectionToken, ModuleBinding>();
  private readonly moduleByName = new Map<string, ModuleBinding>();
  private readonly plugins: readonly Plugin[];
  private readonly testInspector: MutableTestInspector | undefined;
  private readonly effectDisposers: (() => void)[] = [];
  private readonly pendingEffects = new Set<Promise<void>>();
  private readonly loadedLazyModules = new WeakMap<LazyModule, LazyModuleLoadResult>();
  private readonly dynamicScopes: Container[] = [];
  private initPromise: Promise<void> = Promise.resolve();
  private isStarted = false;
  private isDisposed = false;

  constructor(options: {
    readonly container: Container;
    readonly devOptions: AppDevOptions;
    readonly lazyModules: readonly LazyModule[];
    readonly modules: ModuleBinding[];
    readonly plugins: readonly Plugin[];
    readonly state: AppState;
    readonly store: Store<RootState>;
    readonly testInspector?: MutableTestInspector;
  }) {
    this.#container = options.container;
    this.devOptions = options.devOptions;
    this.pendingLazyModules = [...options.lazyModules];
    this.modules = options.modules;
    this.plugins = options.plugins;
    this.state = options.state;
    this.store = options.store;
    this.testInspector = options.testInspector;

    for (const moduleBinding of options.modules) {
      this.moduleByToken.set(moduleBinding.token, moduleBinding);
      this.moduleByName.set(moduleBinding.name, moduleBinding);
    }

    this.wrapStoreSetState();

    this.store.subscribe(() => {
      (this.state as { version: number }).version += 1;
      const state = this.store.getPureState();
      this.testInspector?.recordState(state);
      this.emitStateChange({ state });
    });

    this.testInspector?.setFlushEffects(() => this.flushEffects());
  }

  get started(): boolean {
    return this.isStarted;
  }

  get<T>(token: InjectionToken<T>): T {
    return this.#container.get(token);
  }

  getAsync<T>(token: InjectionToken<T>): Promise<T> {
    return this.#container.getAsync(token);
  }

  getAll<T>(token: InjectionToken<T>): T[] {
    return this.#container.getAll(token);
  }

  getModule<T>(token: InjectionToken<T>): T {
    const moduleBinding = this.moduleByToken.get(token);

    if (moduleBinding === undefined) {
      throw new CosystemError(`${tokenName(token)} is not a CoSystem module.`);
    }

    return moduleBinding.instance as T;
  }

  getModuleByName<T = unknown>(name: string): T {
    const moduleBinding = this.moduleByName.get(name);

    if (moduleBinding === undefined) {
      throw new CosystemError(`${name} is not a CoSystem module.`);
    }

    return moduleBinding.instance as T;
  }

  watch<T>(
    read: () => T,
    listener: (value: T, previous: T) => void,
    options: WatchOptions<T> = {},
  ): () => void {
    const equals = options.equals ?? Object.is;
    const tracker = createReactiveTracker();
    let previous = tracker.track(read);

    if (options.immediate === true) {
      listener(previous, previous);
    }

    const publish = () => {
      const next = tracker.track(read);

      if (equals(next, previous)) {
        return;
      }

      const last = previous;
      previous = next;
      listener(next, last);
    };

    const unsubscribeStore = this.store.subscribe(publish);
    const unsubscribeTracker = tracker.subscribe(publish);

    return () => {
      unsubscribeStore();
      unsubscribeTracker();
      tracker.dispose();
    };
  }

  async start(): Promise<void> {
    if (this.isStarted) {
      return;
    }

    await this.initPromise;

    try {
      await this.runLifecycle("onStart");
      this.isStarted = true;
    } catch (error) {
      this.emitError(error, { phase: "start" });
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    try {
      await this.runLifecycle("onStop", true);
      this.isStarted = false;
    } catch (error) {
      this.emitError(error, { phase: "stop" });
      throw error;
    }
  }

  async dispose(): Promise<void> {
    if (this.isDisposed) {
      return;
    }

    await this.stop();

    try {
      this.stopEffects();
      await this.waitForPendingEffects();
      await this.runLifecycle("onDispose", true);
      for (const scope of this.dynamicScopes.toReversed()) {
        await scope.dispose();
      }
      await Promise.all(this.plugins.map((plugin) => plugin.dispose?.()));
      await this.#container.dispose();
      this.store.destroy();
      this.isDisposed = true;
    } catch (error) {
      this.emitError(error, { phase: "dispose" });
      throw error;
    }
  }

  createScope(options?: ScopeOptions): AppScope {
    return {
      container: this.#container.createScope(options),
    };
  }

  async load(module: LazyModule): Promise<LazyModuleLoadResult>;
  async load(): Promise<readonly LazyModuleLoadResult[]>;
  async load(module?: LazyModule): Promise<LazyModuleLoadResult | readonly LazyModuleLoadResult[]> {
    if (module === undefined) {
      const modules = this.pendingLazyModules.splice(0);
      const results: LazyModuleLoadResult[] = [];

      for (const pendingModule of modules) {
        results.push(await this.load(pendingModule));
      }

      return results;
    }

    const existing = this.loadedLazyModules.get(module);

    if (existing !== undefined) {
      return existing;
    }

    if (this.isDisposed) {
      throw new CosystemError("Cannot load a lazy module after app disposal.");
    }

    await this.initPromise;

    try {
      const providers = normalizeLazyModuleProviders(await module.load());
      const scopeContainer = this.#container.createScope();
      const moduleTokens: InjectionToken[] = [];

      for (const provider of providers) {
        const normalized = normalizeAppProvider(provider);
        scopeContainer.provide(normalized.provider);

        if (normalized.moduleToken !== undefined) {
          moduleTokens.push(normalized.moduleToken);
        }
      }

      scopeContainer.freeze();

      const loadedModules = instantiateModules(scopeContainer, moduleTokens, false);
      this.assertNewModules(loadedModules);
      this.installModuleState(loadedModules);
      this.registerModules(loadedModules);
      this.bindModules(loadedModules);
      this.attachRuntimeMetadata(loadedModules);
      instantiateEagerProviders(scopeContainer);
      this.dynamicScopes.push(scopeContainer);
      this.runModuleCreatedHooks(loadedModules);
      await this.runLifecycle("onInit", false, loadedModules);
      this.startEffects(loadedModules);

      if (this.isStarted) {
        await this.runLifecycle("onStart", false, loadedModules);
      }

      const result: LazyModuleLoadResult = {
        modules: loadedModules.map(toModuleCreatedEvent),
        scope: {
          container: scopeContainer,
        },
      };

      this.loadedLazyModules.set(module, result);
      return result;
    } catch (error) {
      this.emitError(error, { phase: "load" });
      throw error;
    }
  }

  bindModules(modules: readonly ModuleBinding[] = this.modules): void {
    for (const moduleBinding of modules) {
      this.bindState(moduleBinding);
      this.bindComputed(moduleBinding);
      this.bindActions(moduleBinding);
    }
  }

  attachRuntimeMetadata(modules: readonly ModuleBinding[] = this.modules): void {
    for (const moduleBinding of modules) {
      Object.defineProperty(moduleBinding.instance, runtimeModuleMetadataKey, {
        configurable: false,
        enumerable: false,
        value: {
          app: this,
          name: moduleBinding.name,
          token: moduleBinding.token,
        } satisfies RuntimeModuleMetadata,
      });
    }
  }

  runModuleCreatedHooks(modules: readonly ModuleBinding[] = this.modules): void {
    for (const moduleBinding of modules) {
      const event = toModuleCreatedEvent(moduleBinding);

      for (const plugin of this.plugins) {
        plugin.onModuleCreated?.(event);
      }
    }
  }

  init(): void {
    this.initPromise = (async () => {
      try {
        await Promise.all(
          this.plugins.map((plugin) => this.runWithAppInjectContext(() => plugin.setup?.(this))),
        );
        await this.runLifecycle("onInit");
        this.startEffects();
      } catch (error) {
        this.emitError(error, { phase: "init" });
        throw error;
      }
    })();
  }

  private bindState(moduleBinding: ModuleBinding): void {
    for (const property of moduleBinding.metadata.state) {
      Object.defineProperty(moduleBinding.instance, property, {
        configurable: true,
        enumerable: true,
        get: () => this.readModuleState(moduleBinding, property),
        set: (value: unknown) => this.writeModuleState(moduleBinding, property, value),
      });
    }
  }

  private bindActions(moduleBinding: ModuleBinding): void {
    for (const property of moduleBinding.metadata.actions) {
      const action = getMethod(moduleBinding.instance, property);
      moduleBinding.originalActions.set(property, action);

      Object.defineProperty(moduleBinding.instance, property, {
        configurable: true,
        value: (...args: unknown[]) => this.runAction(moduleBinding, property, args),
      });
    }
  }

  private bindComputed(moduleBinding: ModuleBinding): void {
    for (const property of moduleBinding.metadata.computed) {
      const getter = getGetter(moduleBinding.instance, property);
      const accessor = createCoactionComputed(() => getter.call(moduleBinding.instance));
      moduleBinding.originalComputed.set(property, getter);
      moduleBinding.computedAccessors.set(property, accessor);

      Object.defineProperty(moduleBinding.instance, property, {
        configurable: true,
        enumerable: true,
        get: () => {
          if (moduleBinding.activeDraft !== undefined || !moduleBinding.reactiveSlice) {
            return getter.call(moduleBinding.instance);
          }

          return accessor();
        },
      });
    }
  }

  private readModuleState(moduleBinding: ModuleBinding, property: PropertyKey): unknown {
    if (!moduleBinding.reactiveSlice) {
      return this.store.getPureState()[moduleBinding.name]?.[property];
    }

    return this.store.getState()[moduleBinding.name]?.[property];
  }

  private writeModuleState(
    moduleBinding: ModuleBinding,
    property: PropertyKey,
    value: unknown,
  ): void {
    if (moduleBinding.activeDraft !== undefined) {
      moduleBinding.activeDraft[property] = value;
      return;
    }

    if (this.devOptions.strictActions === true && moduleBinding.actionDepth === 0) {
      throw new CosystemError(
        `Cannot write ${moduleBinding.name}.${String(property)} outside an action.`,
      );
    }

    if (!moduleBinding.reactiveSlice) {
      const state = this.store.getPureState();
      const slice = state[moduleBinding.name] ?? {};

      this.store.setState({
        ...state,
        [moduleBinding.name]: {
          ...slice,
          [property]: value,
        },
      });
      return;
    }

    this.store.setState((draft) => {
      draft[moduleBinding.name] ??= {};
      draft[moduleBinding.name]![property] = value;
    });
  }

  private runAction(
    moduleBinding: ModuleBinding,
    property: PropertyKey,
    args: readonly unknown[],
  ): unknown {
    const action = moduleBinding.originalActions.get(property);

    if (action === undefined) {
      throw new CosystemError(`${moduleBinding.name}.${String(property)} is not an action.`);
    }

    const event: ActionEvent = {
      args,
      method: String(property),
      module: moduleBinding.name,
      startedAt: Date.now(),
    };
    this.emitActionStart(event);

    let result: unknown;
    let error: unknown;

    try {
      moduleBinding.actionDepth += 1;
      if (moduleBinding.reactiveSlice) {
        this.store.setState((draft) => {
          const previousDraft = moduleBinding.activeDraft;
          moduleBinding.activeDraft = draft[moduleBinding.name] ?? {};
          draft[moduleBinding.name] = moduleBinding.activeDraft;

          try {
            result = action.apply(moduleBinding.instance, [...args]);
          } finally {
            moduleBinding.activeDraft = previousDraft;
          }
        });
      } else {
        const state = this.store.getPureState();
        const slice = state[moduleBinding.name];
        const previousDraft = moduleBinding.activeDraft;
        moduleBinding.activeDraft = slice === undefined ? {} : { ...slice };

        try {
          result = action.apply(moduleBinding.instance, [...args]);
          this.store.setState({
            ...state,
            [moduleBinding.name]: moduleBinding.activeDraft,
          });
        } finally {
          moduleBinding.activeDraft = previousDraft;
        }
      }
    } catch (caught) {
      error = caught;
      this.emitError(caught, { phase: "action" });
    } finally {
      moduleBinding.actionDepth -= 1;
    }

    if (error !== undefined) {
      this.finishAction(event, error);
      throw error;
    }

    if (isPromiseLike(result)) {
      return Promise.resolve(result).then(
        (value) => {
          this.finishAction(event);
          return value;
        },
        (caught) => {
          this.emitError(caught, { phase: "action" });
          this.finishAction(event, caught);
          throw caught;
        },
      );
    }

    this.finishAction(event);

    return result;
  }

  private finishAction(event: ActionEvent, error?: unknown): void {
    const endedEvent: ActionEvent = {
      ...event,
      endedAt: Date.now(),
      ...(error === undefined ? {} : { error }),
    };
    this.testInspector?.recordAction(endedEvent);
    this.emitActionEnd(endedEvent);
  }

  private async runLifecycle(
    method: keyof LifecycleModule,
    reverse = false,
    modules: readonly ModuleBinding[] = this.modules,
  ): Promise<void> {
    const orderedModules = reverse ? modules.toReversed() : modules;

    for (const moduleBinding of orderedModules) {
      const lifecycle = moduleBinding.instance as LifecycleModule;
      await this.runWithAppInjectContext(() => lifecycle[method]?.());
    }
  }

  private startEffects(modules: readonly ModuleBinding[] = this.modules): void {
    for (const moduleBinding of modules) {
      for (const property of moduleBinding.metadata.effects) {
        this.startEffect(moduleBinding, property);
      }
    }
  }

  private startEffect(moduleBinding: ModuleBinding, property: PropertyKey): void {
    const method = getMethod(moduleBinding.instance, property);
    const tracker = createReactiveTracker();
    let disposed = false;

    const run = () => {
      if (disposed) {
        return;
      }

      try {
        tracker.track(() => this.runEffect(moduleBinding, property, method));
      } catch (error) {
        this.emitError(error, { phase: "effect" });
        throw error;
      }
    };

    const unsubscribe = tracker.subscribe(() => {
      try {
        run();
      } catch {
        // The error has already been emitted through plugin hooks.
      }
    });

    run();

    this.effectDisposers.push(() => {
      disposed = true;
      unsubscribe();
      tracker.dispose();
    });
  }

  private runEffect(
    moduleBinding: ModuleBinding,
    property: PropertyKey,
    method: (...args: unknown[]) => unknown,
  ): void {
    const result = this.runWithAppInjectContext(() => method.call(moduleBinding.instance));

    if (!isPromiseLike(result)) {
      return;
    }

    const pending = Promise.resolve(result)
      .then(() => undefined)
      .catch((error) => {
        this.emitError(error, {
          phase: `effect:${moduleBinding.name}.${String(property)}`,
        });
        throw error;
      })
      .finally(() => {
        this.pendingEffects.delete(pending);
      });

    this.pendingEffects.add(pending);
    pending.catch(() => undefined);
  }

  private stopEffects(): void {
    for (const dispose of this.effectDisposers.splice(0).toReversed()) {
      dispose();
    }
  }

  private async flushEffects(): Promise<void> {
    await this.initPromise;
    await this.waitForPendingEffects();
  }

  private async waitForPendingEffects(): Promise<void> {
    while (this.pendingEffects.size > 0) {
      await Promise.all(this.pendingEffects);
    }
  }

  private emitActionStart(event: ActionEvent): void {
    for (const plugin of this.plugins) {
      plugin.onActionStart?.(event);
    }
  }

  private emitActionEnd(event: ActionEvent): void {
    for (const plugin of this.plugins) {
      plugin.onActionEnd?.(event);
    }
  }

  private emitStateChange(event: StateChangeEvent): void {
    for (const plugin of this.plugins) {
      plugin.onStateChange?.(event);
    }
  }

  private emitPatch(event: PatchEvent): void {
    for (const plugin of this.plugins) {
      plugin.onPatch?.(event);
    }
  }

  private emitError(error: unknown, context: ErrorContext): void {
    for (const plugin of this.plugins) {
      plugin.onError?.(error, context);
    }
  }

  private runWithAppInjectContext<T>(callback: () => T): T {
    return runWithInjectContext(
      {
        mode: "sync",
        requestContainer: this.#container as ResolutionContext["requestContainer"],
        resolutionCache: new Map(),
        stack: [],
      },
      callback,
    );
  }

  private wrapStoreSetState(): void {
    const originalSetState = this.store.setState.bind(this.store) as (
      ...args: Parameters<StoreSetState>
    ) => unknown;

    this.store.setState = ((...args: Parameters<StoreSetState>) => {
      const result = originalSetState(...args);
      this.recordMutationResult(result);
      return result as never;
    }) as StoreSetState;
  }

  private recordMutationResult(result: unknown): void {
    if (!Array.isArray(result) || result.length < 3) {
      return;
    }

    const patches = result[1] as readonly unknown[];

    if (patches.length === 0) {
      return;
    }

    this.testInspector?.recordPatch(patches);
    this.emitPatch({
      inversePatches: result[2] as readonly unknown[],
      patches,
    });
  }

  private assertNewModules(modules: readonly ModuleBinding[]): void {
    for (const moduleBinding of modules) {
      if (this.moduleByToken.has(moduleBinding.token)) {
        throw new DuplicateProviderError(tokenName(moduleBinding.token));
      }

      if (this.moduleByName.has(moduleBinding.name)) {
        throw new DuplicateProviderError(moduleBinding.name);
      }
    }
  }

  private installModuleState(modules: readonly ModuleBinding[]): void {
    if (modules.length === 0) {
      return;
    }

    const rootState = createRootState(modules);

    this.store.setState({
      ...this.store.getPureState(),
      ...rootState,
    });
  }

  private registerModules(modules: readonly ModuleBinding[]): void {
    for (const moduleBinding of modules) {
      this.modules.push(moduleBinding);
      this.moduleByToken.set(moduleBinding.token, moduleBinding);
      this.moduleByName.set(moduleBinding.name, moduleBinding);
    }
  }
}

function normalizeAppProvider(provider: ProviderInput): {
  readonly provider: ProviderInput;
  readonly moduleToken?: InjectionToken;
} {
  if (typeof provider === "function") {
    const metadata = getModuleMetadata(provider);

    if (metadata !== undefined) {
      return {
        provider: provide(provider, createModuleClassProviderOptions(provider, metadata)),
        moduleToken: provider,
      };
    }

    return { provider };
  }

  if ("useClass" in provider) {
    const metadata = getModuleMetadata(provider.useClass);

    if (metadata !== undefined) {
      return {
        provider: {
          ...provider,
          ...mergeModuleClassProviderOptions(provider, metadata),
        },
        moduleToken: provider.provide,
      };
    }
  }

  return { provider };
}

function createStoreOptions(
  engine: EngineOptions | undefined,
  enablePatches: boolean,
): CoactionStoreOptions {
  return {
    name: "cosystem",
    sliceMode: "single",
    enablePatches,
    ...(engine?.transport === undefined ? {} : { transport: engine.transport }),
  } as CoactionStoreOptions;
}

function shouldEnablePatches(options: InternalCreateAppOptions): boolean {
  if (options.engine?.patches !== undefined) {
    return options.engine.patches;
  }

  return (
    options.testInspector !== undefined ||
    (options.plugins ?? []).some((plugin) => plugin.onPatch !== undefined)
  );
}

function createModuleClassProviderOptions<T>(
  useClass: Constructor<T>,
  metadata: ModuleMetadata,
): ClassProvideOptions<T> {
  return {
    useClass,
    ...(metadata.deps === undefined ? {} : { deps: metadata.deps }),
    ...(metadata.scope === undefined ? {} : { scope: metadata.scope }),
  };
}

function mergeModuleClassProviderOptions<T>(
  provider: Provider<T>,
  metadata: ModuleMetadata,
): Partial<ClassProvideOptions<T>> {
  return {
    ...("deps" in provider || metadata.deps === undefined ? {} : { deps: metadata.deps }),
    ...("scope" in provider || metadata.scope === undefined ? {} : { scope: metadata.scope }),
  };
}

function instantiateModules(
  container: Container,
  moduleTokens: readonly InjectionToken[],
  reactiveSlice = true,
) {
  const modules: ModuleBinding[] = [];

  for (const moduleToken of moduleTokens) {
    const instance = container.get(moduleToken) as Record<PropertyKey, unknown>;
    const metadata = getModuleMetadata(instance.constructor);

    if (metadata === undefined) {
      continue;
    }

    const name = metadata.name ?? stableModuleName(moduleToken);

    if (modules.some((moduleBinding) => moduleBinding.name === name)) {
      throw new DuplicateProviderError(name);
    }

    modules.push({
      actionDepth: 0,
      activeDraft: undefined,
      computedAccessors: new Map(),
      instance,
      metadata,
      name,
      originalActions: new Map(),
      originalComputed: new Map(),
      reactiveSlice,
      token: moduleToken,
    });
  }

  return modules;
}

function toModuleCreatedEvent(moduleBinding: ModuleBinding): ModuleCreatedEvent {
  return {
    instance: moduleBinding.instance,
    name: moduleBinding.name,
    token: moduleBinding.token,
  };
}

function instantiateEagerProviders(container: Container): void {
  const internalContainer = container as ContainerImpl;

  for (const [token, records] of internalContainer.records) {
    if (!records.some((record) => record.eager)) {
      continue;
    }

    if (records.some((record) => record.multi)) {
      container.getAll(token);
      continue;
    }

    container.get(token);
  }
}

function createRootState(modules: readonly ModuleBinding[]): RootState {
  const rootState: RootState = {};

  for (const moduleBinding of modules) {
    const state: Record<PropertyKey, unknown> = {};

    for (const property of moduleBinding.metadata.state) {
      state[property] = moduleBinding.instance[property];
    }

    rootState[moduleBinding.name] = state;
  }

  return rootState;
}

function stableModuleName(token: InjectionToken): string {
  const name = tokenName(token);
  return `${name.slice(0, 1).toLowerCase()}${name.slice(1)}`;
}

function getMethod(
  instance: Record<PropertyKey, unknown>,
  property: PropertyKey,
): (...args: unknown[]) => unknown {
  const descriptor = getDescriptor(instance, property);

  if (descriptor?.value === undefined || typeof descriptor.value !== "function") {
    throw new CosystemError(`${String(property)} is not a method.`);
  }

  return descriptor.value as (...args: unknown[]) => unknown;
}

function getGetter(instance: Record<PropertyKey, unknown>, property: PropertyKey): () => unknown {
  const descriptor = getDescriptor(instance, property);

  if (descriptor?.get === undefined) {
    throw new CosystemError(`${String(property)} is not a getter.`);
  }

  return descriptor.get;
}

function getDescriptor(
  instance: Record<PropertyKey, unknown>,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  let current: object | null = instance;

  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, property);

    if (descriptor !== undefined) {
      return descriptor;
    }

    current = Object.getPrototypeOf(current);
  }

  return undefined;
}

function isApp(value: unknown): value is App {
  return (
    typeof value === "object" &&
    value !== null &&
    "get" in value &&
    "start" in value &&
    "dispose" in value
  );
}

function isPromiseLike<T = unknown>(value: unknown): value is PromiseLike<T> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function getAppContainer(app: App): Container {
  const container = appContainerMap.get(app);

  if (container === undefined) {
    throw new CosystemError("Parent app was not created by CoSystem.");
  }

  return container;
}
