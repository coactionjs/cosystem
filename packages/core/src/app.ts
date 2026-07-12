import {
  computed as createCoactionComputed,
  create as createCoactionStore,
  createReactiveTracker,
  type Store,
} from "coaction";

import { createContainer } from "./container.js";
import { CosystemError, DuplicateProviderError } from "./errors.js";
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
  Scope,
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
  runInAction<T>(callback: () => T, options?: RunInActionOptions): T;
  runInAction<T>(module: RunInActionTarget, callback: () => T, options?: RunInActionOptions): T;
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

export type RunInActionTarget<T extends object = object> = InjectionToken<T> | T;

export interface RunInActionOptions {
  readonly name?: string;
  readonly args?: readonly unknown[];
}

export interface Plugin {
  readonly name?: string;
  readonly providers?: readonly ProviderInput[];
  setup?(app: App, context: PluginContext): void | Promise<void>;
  onModuleCreated?(event: ModuleCreatedEvent, context: PluginContext): void;
  onActionStart?(event: ActionEvent, context: PluginContext): void;
  onActionEnd?(event: ActionEvent, context: PluginContext): void;
  onPatch?(event: PatchEvent, context: PluginContext): void;
  onStateChange?(event: StateChangeEvent, context: PluginContext): void;
  onError?(error: unknown, context: ErrorContext, pluginContext: PluginContext): void;
  dispose?(context: PluginContext): void | Promise<void>;
}

export interface PluginContext {
  readonly app: App;
  readonly name: string;
  readonly signal: AbortSignal;
  emitError(error: unknown, phase?: string): void;
  onDispose(disposer: () => void | Promise<void>): void;
  watch<T>(
    read: () => T,
    listener: (value: T, previous: T) => void,
    options?: WatchOptions<T>,
  ): () => void;
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
type StoreApply = Store<RootState>["apply"];

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

interface PluginRecord {
  readonly plugin: Plugin;
  readonly context: RuntimePluginContext;
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

export function runInAction<T>(module: object, callback: () => T, options?: RunInActionOptions): T {
  const metadata = getRuntimeModuleMetadata(module);

  if (metadata === undefined) {
    throw new CosystemError("runInAction() target is not a CoSystem module instance.");
  }

  return metadata.app.runInAction(module, callback, options);
}

export function createAppInternal(options: InternalCreateAppOptions = {}): App {
  const parent = isApp(options.parent) ? getAppContainer(options.parent) : options.parent;
  const container = parent === undefined ? createContainer() : createContainer({ parent });
  const moduleTokens: InjectionToken[] = [];
  const lazyModules: LazyModule[] = [];
  const pluginProviderTokens = new Set<InjectionToken>();

  for (const plugin of options.plugins ?? []) {
    for (const provider of plugin.providers ?? []) {
      const normalized = normalizeAppProvider(provider);

      if (normalized.moduleToken !== undefined) {
        throw new CosystemError(
          `${plugin.name ?? "Anonymous plugin"} cannot register CoSystem modules through plugin providers.`,
        );
      }

      container.provide(normalized.provider);
      pluginProviderTokens.add(providerInputToken(normalized.provider));
    }
  }

  for (const provider of options.providers ?? []) {
    if (isLazyModule(provider)) {
      lazyModules.push(provider);
      continue;
    }

    const normalized = normalizeAppProvider(provider);
    const token = providerInputToken(normalized.provider);

    if (pluginProviderTokens.has(token) && !isMultiProvider(normalized.provider)) {
      container.override(normalized.provider);
    } else {
      container.provide(normalized.provider);
    }

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

class RuntimePluginContext implements PluginContext {
  readonly app: App;
  readonly name: string;
  readonly #abortController = new AbortController();
  readonly #disposers: (() => void | Promise<void>)[] = [];
  readonly #emitError: (error: unknown, context: ErrorContext) => void;

  constructor(options: {
    readonly app: App;
    readonly name: string;
    readonly emitError: (error: unknown, context: ErrorContext) => void;
  }) {
    this.app = options.app;
    this.name = options.name;
    this.#emitError = options.emitError;
  }

  get signal(): AbortSignal {
    return this.#abortController.signal;
  }

  emitError(error: unknown, phase = `plugin:${this.name}`): void {
    this.#emitError(error, { phase });
  }

  onDispose(disposer: () => void | Promise<void>): void {
    this.#disposers.push(disposer);
  }

  abort(): void {
    this.#abortController.abort();
  }

  watch<T>(
    read: () => T,
    listener: (value: T, previous: T) => void,
    options?: WatchOptions<T>,
  ): () => void {
    const stop = this.app.watch(read, listener, options);
    let active = true;

    const managedStop = () => {
      if (!active) {
        return;
      }

      active = false;
      stop();
    };

    this.onDispose(managedStop);

    return managedStop;
  }

  async dispose(): Promise<void> {
    this.abort();

    const errors: unknown[] = [];

    for (const dispose of this.#disposers.splice(0).toReversed()) {
      try {
        // eslint-disable-next-line no-await-in-loop -- plugin resources are disposed in registration order.
        await dispose();
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, `One or more disposers failed for plugin ${this.name}.`);
    }
  }
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
  private readonly pluginRecords: readonly PluginRecord[];
  private readonly testInspector: MutableTestInspector | undefined;
  private readonly effectDisposers: (() => void)[] = [];
  private readonly pendingEffects = new Set<Promise<void>>();
  private readonly stateProxyCache = new WeakMap<object, object>();
  private readonly loadedLazyModules = new WeakMap<LazyModule, LazyModuleLoadResult>();
  private readonly loadingLazyModules = new WeakMap<LazyModule, Promise<LazyModuleLoadResult>>();
  private readonly dynamicScopes: Container[] = [];
  private initPromise: Promise<void> = Promise.resolve();
  private startPromise: Promise<void> | undefined;
  private disposePromise: Promise<void> | undefined;
  private isInitialized = false;
  private isStarted = false;
  private isDisposing = false;
  private isDisposed = false;
  private actionDepth = 0;
  private internalMutationDepth = 0;
  private draftMutationDepth = 0;

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
    this.state = options.state;
    this.store = options.store;
    this.testInspector = options.testInspector;
    this.pluginRecords = options.plugins.map((plugin, index) => ({
      context: new RuntimePluginContext({
        app: this,
        emitError: (error, context) => this.emitError(error, context),
        name: plugin.name ?? `anonymous-${index + 1}`,
      }),
      plugin,
    }));

    for (const moduleBinding of options.modules) {
      this.moduleByToken.set(moduleBinding.token, moduleBinding);
      this.moduleByName.set(moduleBinding.name, moduleBinding);
    }

    this.wrapStoreMutations();

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
    this.assertActive("resolve providers");
    const moduleBinding = this.moduleByToken.get(token);

    if (moduleBinding !== undefined) {
      return moduleBinding.instance as T;
    }

    return this.#container.get(token);
  }

  async getAsync<T>(token: InjectionToken<T>): Promise<T> {
    this.assertActive("resolve providers");
    const moduleBinding = this.moduleByToken.get(token);

    if (moduleBinding !== undefined) {
      return moduleBinding.instance as T;
    }

    return await this.#container.getAsync(token);
  }

  getAll<T>(token: InjectionToken<T>): T[] {
    this.assertActive("resolve providers");
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
    this.assertActive("watch state");
    const equals = options.equals ?? Object.is;
    let previous = read();

    if (options.immediate === true) {
      this.notifyWatchListener(listener, previous, previous);
    }

    const publish = () => {
      let next: T;

      try {
        next = read();

        if (equals(next, previous)) {
          return;
        }
      } catch (error) {
        this.emitError(error, { phase: "watch" });
        return;
      }

      const last = previous;
      previous = next;
      this.notifyWatchListener(listener, next, last);
    };

    return this.store.subscribe(publish);
  }

  runInAction<T>(callback: () => T, options?: RunInActionOptions): T;
  runInAction<T>(module: RunInActionTarget, callback: () => T, options?: RunInActionOptions): T;
  runInAction<T>(
    moduleOrCallback: RunInActionTarget | (() => T),
    callbackOrOptions: (() => T) | RunInActionOptions = {},
    options: RunInActionOptions = {},
  ): T {
    this.assertActive("run actions");

    if (typeof callbackOrOptions !== "function") {
      return this.runStoreActionCallback(moduleOrCallback as () => T, callbackOrOptions);
    }

    const moduleBinding = this.resolveModuleBinding(moduleOrCallback as RunInActionTarget);

    return this.runActionCallback(
      moduleBinding,
      options.name ?? "runInAction",
      options.args ?? [],
      callbackOrOptions,
    ) as T;
  }

  async start(): Promise<void> {
    if (this.isStarted) {
      return;
    }

    this.startPromise ??= this.startApp();
    await this.startPromise;
  }

  private async startApp(): Promise<void> {
    if (this.isDisposing || this.isDisposed) {
      throw new CosystemError("Cannot start an app after disposal.");
    }

    try {
      await this.initPromise;

      if (this.isDisposing || this.isDisposed) {
        throw new CosystemError("Cannot start an app after disposal.");
      }

      await this.runLifecycle("onStart");
      this.isStarted = true;
    } catch (error) {
      this.emitError(error, { phase: "start" });
      throw error;
    } finally {
      this.startPromise = undefined;
    }
  }

  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    try {
      await this.runTeardownLifecycle("onStop");
    } catch (error) {
      this.emitError(error, { phase: "stop" });
      throw error;
    } finally {
      this.isStarted = false;
    }
  }

  async dispose(): Promise<void> {
    this.disposePromise ??= this.disposeApp();
    await this.disposePromise;
  }

  private async disposeApp(): Promise<void> {
    this.isDisposing = true;
    const errors: unknown[] = [];

    if (!this.isInitialized) {
      this.abortPluginContexts();
    }

    try {
      await this.initPromise;
    } catch {
      // Init errors are already reported through plugin onError hooks. Disposal
      // should still release any resources registered before the failure.
    }

    try {
      await this.startPromise;
    } catch {
      // Start errors are already reported through plugin onError hooks. Disposal
      // should still release any resources registered before the failure.
    }

    await runCleanupPhase(errors, () => this.stop());
    await runCleanupPhase(errors, () => this.stopEffects());
    await runCleanupPhase(errors, () => this.waitForPendingEffects());
    await runCleanupPhase(errors, () => this.runTeardownLifecycle("onDispose"));

    for (const scope of this.dynamicScopes.splice(0).toReversed()) {
      // eslint-disable-next-line no-await-in-loop -- dynamic scopes are disposed in reverse load order.
      await runCleanupPhase(errors, () => scope.dispose());
    }

    await runCleanupPhase(errors, () => this.disposePlugins());
    await runCleanupPhase(errors, () => this.#container.dispose());
    await runCleanupPhase(errors, () => this.store.destroy());

    this.isStarted = false;
    this.isDisposed = true;
    this.isDisposing = false;

    if (errors.length > 0) {
      const error = new AggregateError(errors, "One or more app resources failed to dispose.");
      this.emitError(error, { phase: "dispose" });
      throw error;
    }
  }

  createScope(options?: ScopeOptions): AppScope {
    this.assertActive("create scopes");
    return {
      container: this.#container.createScope(options),
    };
  }

  async load(module: LazyModule): Promise<LazyModuleLoadResult>;
  async load(): Promise<readonly LazyModuleLoadResult[]>;
  async load(module?: LazyModule): Promise<LazyModuleLoadResult | readonly LazyModuleLoadResult[]> {
    this.assertCanLoadLazyModule();

    if (module === undefined) {
      const modules = [...this.pendingLazyModules];
      const results: LazyModuleLoadResult[] = [];

      for (const pendingModule of modules) {
        // eslint-disable-next-line no-await-in-loop -- pending lazy modules load in registration order.
        results.push(await this.load(pendingModule));
      }

      return results;
    }

    await this.initPromise;
    this.assertCanLoadLazyModule();

    const existing = this.loadedLazyModules.get(module);

    if (existing !== undefined) {
      return existing;
    }

    const loading = this.loadingLazyModules.get(module);

    if (loading !== undefined) {
      return await loading;
    }

    const pending = this.loadLazyModule(module);
    this.loadingLazyModules.set(module, pending);

    try {
      return await pending;
    } catch (error) {
      this.emitError(error, { phase: "load" });
      throw error;
    } finally {
      if (this.loadingLazyModules.get(module) === pending) {
        this.loadingLazyModules.delete(module);
      }
    }
  }

  private async loadLazyModule(module: LazyModule): Promise<LazyModuleLoadResult> {
    const providers = normalizeLazyModuleProviders(await module.load());
    this.assertCanLoadLazyModule();

    const scopeContainer = this.#container.createScope();
    const moduleTokens: InjectionToken[] = [];
    let loadedModules: ModuleBinding[] = [];
    let initAttempted = false;
    let startAttempted = false;
    let modulesRegistered = false;
    let metadataAttached = false;
    let scopeRegistered = false;
    let stateInstalled = false;
    let effectStartIndex: number | undefined;

    try {
      for (const provider of providers) {
        const normalized = normalizeAppProvider(provider);
        scopeContainer.provide(normalized.provider);

        if (normalized.moduleToken !== undefined) {
          moduleTokens.push(normalized.moduleToken);
        }
      }

      scopeContainer.freeze();
      loadedModules = instantiateModules(scopeContainer, moduleTokens, false);
      this.assertNewModules(loadedModules);
      instantiateEagerProviders(scopeContainer);

      initAttempted = true;
      await this.runLifecycle("onInit", false, loadedModules, scopeContainer);
      this.assertCanLoadLazyModule();

      if (this.isStarted) {
        startAttempted = true;
        await this.runLifecycle("onStart", false, loadedModules, scopeContainer);
        this.assertCanLoadLazyModule();
      }

      this.assertNewModules(loadedModules);
      const stagedState = createRootState(loadedModules);

      this.bindModules(loadedModules);
      metadataAttached = true;
      this.attachRuntimeMetadata(loadedModules);
      modulesRegistered = true;
      this.registerModules(loadedModules);
      scopeRegistered = true;
      this.dynamicScopes.push(scopeContainer);
      stateInstalled = true;
      this.installModuleState(loadedModules, stagedState);

      effectStartIndex = this.effectDisposers.length;
      this.startEffects(loadedModules);
      this.runModuleCreatedHooks(loadedModules);

      const result: LazyModuleLoadResult = {
        modules: loadedModules.map(toModuleCreatedEvent),
        scope: {
          container: scopeContainer,
        },
      };

      this.loadedLazyModules.set(module, result);
      this.removePendingLazyModule(module);
      return result;
    } catch (error) {
      const rollbackErrors: unknown[] = [];

      const rollbackEffectStartIndex = effectStartIndex;

      if (rollbackEffectStartIndex !== undefined) {
        await runCleanupPhase(rollbackErrors, () => this.stopEffectsFrom(rollbackEffectStartIndex));
      }

      if (modulesRegistered) {
        this.unregisterModules(loadedModules);
      }

      if (scopeRegistered) {
        this.unregisterDynamicScope(scopeContainer);
      }

      if (startAttempted) {
        await runCleanupPhase(rollbackErrors, () =>
          this.runTeardownLifecycle("onStop", loadedModules, scopeContainer),
        );
      }

      if (initAttempted) {
        await runCleanupPhase(rollbackErrors, () =>
          this.runTeardownLifecycle("onDispose", loadedModules, scopeContainer),
        );
      }

      if (stateInstalled) {
        await runCleanupPhase(rollbackErrors, () => this.uninstallModuleState(loadedModules));
      }

      if (metadataAttached) {
        this.detachRuntimeMetadata(loadedModules);
      }

      await runCleanupPhase(rollbackErrors, () => scopeContainer.dispose());

      if (rollbackErrors.length > 0) {
        // eslint-disable-next-line preserve-caught-error -- AggregateError.errors and cause both retain the load failure.
        throw new AggregateError(
          [error, ...rollbackErrors],
          error instanceof Error ? error.message : "Lazy module load and rollback failed.",
          { cause: error },
        );
      }

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
        configurable: true,
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

      for (const record of this.pluginRecords) {
        this.runPluginHook(record, "onModuleCreated", () =>
          record.plugin.onModuleCreated?.(event, record.context),
        );
      }
    }
  }

  init(): void {
    this.initPromise = (async () => {
      try {
        await Promise.all(
          this.pluginRecords.map((record) =>
            this.runWithAppInjectContext(() => record.plugin.setup?.(this, record.context)),
          ),
        );

        if (this.isDisposing || this.isDisposed) {
          return;
        }

        await this.runLifecycle("onInit");

        if (this.isDisposing || this.isDisposed) {
          return;
        }

        this.startEffects();
        this.isInitialized = true;
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

    if (this.devOptions.strictActions === true && this.actionDepth === 0) {
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

    return this.runActionCallback(moduleBinding, property, args, () =>
      action.apply(moduleBinding.instance, [...args]),
    );
  }

  private runActionCallback(
    moduleBinding: ModuleBinding,
    property: PropertyKey,
    args: readonly unknown[],
    callback: () => unknown,
  ): unknown {
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
      this.actionDepth += 1;
      if (moduleBinding.reactiveSlice) {
        this.store.setState((draft) => {
          const previousDraft = moduleBinding.activeDraft;
          moduleBinding.activeDraft = draft[moduleBinding.name] ?? {};
          draft[moduleBinding.name] = moduleBinding.activeDraft;

          try {
            result = callback();
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
          result = callback();
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
      this.actionDepth -= 1;
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

  private runStoreActionCallback<T>(callback: () => T, options: RunInActionOptions): T {
    const event: ActionEvent = {
      args: options.args ?? [],
      method: options.name ?? "runInAction",
      module: "$app",
      startedAt: Date.now(),
    };
    this.emitActionStart(event);

    let result: T;

    try {
      this.actionDepth += 1;
      result = callback();
    } catch (error) {
      this.emitError(error, { phase: "action" });
      this.finishAction(event, error);
      throw error;
    } finally {
      this.actionDepth -= 1;
    }

    if (isPromiseLike(result)) {
      return Promise.resolve(result).then(
        (value) => {
          this.finishAction(event);
          return value;
        },
        (error) => {
          this.emitError(error, { phase: "action" });
          this.finishAction(event, error);
          throw error;
        },
      ) as T;
    }

    this.finishAction(event);
    return result;
  }

  private resolveModuleBinding(target: RunInActionTarget): ModuleBinding {
    if (typeof target === "object" && target !== null) {
      const metadata = getRuntimeModuleMetadata(target);

      if (metadata !== undefined) {
        if (metadata.app !== this) {
          throw new CosystemError("runInAction() target belongs to another CoSystem app.");
        }

        const moduleBinding = this.moduleByToken.get(metadata.token);

        if (moduleBinding !== undefined) {
          return moduleBinding;
        }
      }

      if (isTokenObject(target)) {
        const moduleBinding = this.moduleByToken.get(target);

        if (moduleBinding !== undefined) {
          return moduleBinding;
        }
      }

      throw new CosystemError("runInAction() target is not a CoSystem module.");
    }

    if (typeof target === "string") {
      const moduleBinding = this.moduleByName.get(target) ?? this.moduleByToken.get(target);

      if (moduleBinding !== undefined) {
        return moduleBinding;
      }

      throw new CosystemError(`${target} is not a CoSystem module.`);
    }

    const moduleBinding = this.moduleByToken.get(target);

    if (moduleBinding !== undefined) {
      return moduleBinding;
    }

    throw new CosystemError(`${tokenName(target)} is not a CoSystem module.`);
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
    container: Container = this.#container,
  ): Promise<void> {
    const orderedModules = reverse ? modules.toReversed() : modules;

    for (const moduleBinding of orderedModules) {
      const lifecycle = moduleBinding.instance as LifecycleModule;
      // eslint-disable-next-line no-await-in-loop -- lifecycle hooks run in deterministic module order.
      await this.runWithAppInjectContext(() => lifecycle[method]?.(), container);
    }
  }

  private async runTeardownLifecycle(
    method: "onStop" | "onDispose",
    modules: readonly ModuleBinding[] = this.modules,
    container: Container = this.#container,
  ): Promise<void> {
    const errors: unknown[] = [];

    for (const moduleBinding of modules.toReversed()) {
      const lifecycle = moduleBinding.instance as LifecycleModule;

      try {
        // eslint-disable-next-line no-await-in-loop -- teardown hooks run in deterministic module order.
        await this.runWithAppInjectContext(() => lifecycle[method]?.(), container);
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, `One or more module ${method} hooks failed.`);
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

    const dispose = () => {
      disposed = true;
      unsubscribe();
      tracker.dispose();
    };

    try {
      run();
    } catch (error) {
      try {
        dispose();
      } catch (disposeError) {
        // eslint-disable-next-line preserve-caught-error -- AggregateError.errors and cause both retain the startup failure.
        throw new AggregateError([error, disposeError], "Effect startup and cleanup failed.", {
          cause: error,
        });
      }

      throw error;
    }

    this.effectDisposers.push(dispose);
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
    this.stopEffectsFrom(0);
  }

  private stopEffectsFrom(index: number): void {
    const errors: unknown[] = [];

    for (const dispose of this.effectDisposers.splice(index).toReversed()) {
      try {
        dispose();
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, "One or more effects failed to stop.");
    }
  }

  private async disposePlugins(): Promise<void> {
    const errors: unknown[] = [];

    for (const record of this.pluginRecords.toReversed()) {
      try {
        // eslint-disable-next-line no-await-in-loop -- plugin teardown order is observable.
        await record.plugin.dispose?.(record.context);
      } catch (error) {
        errors.push(error);
      }

      try {
        // eslint-disable-next-line no-await-in-loop -- plugin context disposers belong to the same plugin.
        await record.context.dispose();
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, "One or more plugins failed to dispose.");
    }
  }

  private abortPluginContexts(): void {
    for (const record of this.pluginRecords) {
      record.context.abort();
    }
  }

  private async flushEffects(): Promise<void> {
    await this.initPromise;
    await this.waitForPendingEffects();
  }

  private async waitForPendingEffects(): Promise<void> {
    const errors: unknown[] = [];

    while (this.pendingEffects.size > 0) {
      // eslint-disable-next-line no-await-in-loop -- async effects may enqueue follow-up effects while settling.
      const results = await Promise.allSettled(this.pendingEffects);

      for (const result of results) {
        if (result.status === "rejected") {
          errors.push(result.reason);
        }
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, "One or more pending effects failed while disposing.");
    }
  }

  private notifyWatchListener<T>(
    listener: (value: T, previous: T) => void,
    value: T,
    previous: T,
  ): void {
    try {
      const result = (listener as (value: T, previous: T) => unknown)(value, previous);

      if (isPromiseLike(result)) {
        void Promise.resolve(result).catch((error: unknown) => {
          this.emitError(error, { phase: "watch" });
        });
      }
    } catch (error) {
      this.emitError(error, { phase: "watch" });
    }
  }

  private emitActionStart(event: ActionEvent): void {
    for (const record of this.pluginRecords) {
      this.runPluginHook(record, "onActionStart", () =>
        record.plugin.onActionStart?.(event, record.context),
      );
    }
  }

  private emitActionEnd(event: ActionEvent): void {
    for (const record of this.pluginRecords) {
      this.runPluginHook(record, "onActionEnd", () =>
        record.plugin.onActionEnd?.(event, record.context),
      );
    }
  }

  private emitStateChange(event: StateChangeEvent): void {
    for (const record of this.pluginRecords) {
      this.runPluginHook(record, "onStateChange", () =>
        record.plugin.onStateChange?.(event, record.context),
      );
    }
  }

  private emitPatch(event: PatchEvent): void {
    for (const record of this.pluginRecords) {
      this.runPluginHook(record, "onPatch", () => record.plugin.onPatch?.(event, record.context));
    }
  }

  private emitError(error: unknown, context: ErrorContext): void {
    for (const record of this.pluginRecords) {
      try {
        record.plugin.onError?.(error, context, record.context);
      } catch {
        // Error hooks are terminal observers; do not recurse if they fail.
      }
    }
  }

  private runPluginHook(
    record: PluginRecord,
    hook: keyof Pick<
      Plugin,
      "onActionEnd" | "onActionStart" | "onModuleCreated" | "onPatch" | "onStateChange"
    >,
    callback: () => unknown,
  ): void {
    try {
      const result = callback();

      if (isPromiseLike(result)) {
        void Promise.resolve(result).catch((error: unknown) => {
          this.emitError(error, { phase: `plugin:${record.context.name}.${hook}` });
        });
      }
    } catch (error) {
      this.emitError(error, { phase: `plugin:${record.context.name}.${hook}` });
    }
  }

  private runWithAppInjectContext<T>(callback: () => T, container: Container = this.#container): T {
    return (container as ContainerImpl).runWithResolutionContext(callback);
  }

  private wrapStoreMutations(): void {
    const originalSetState = this.store.setState.bind(this.store) as (
      ...args: Parameters<StoreSetState>
    ) => unknown;
    const originalApply = this.store.apply.bind(this.store) as StoreApply;
    const originalGetState = this.store.getState.bind(this.store);

    this.store.setState = ((...args: Parameters<StoreSetState>) => {
      this.assertStoreMutationAllowed("setState");
      const guardedArgs = [...args] as Parameters<StoreSetState>;
      const update = guardedArgs[0];

      if (typeof update === "function") {
        guardedArgs[0] = ((draft: Parameters<typeof update>[0]) =>
          this.runWithDraftMutation(() => update(draft))) as typeof update;
      }

      const result = originalSetState(...guardedArgs);
      this.recordMutationResult(result);
      return result as never;
    }) as StoreSetState;

    this.store.apply = ((...args: Parameters<StoreApply>) => {
      this.assertStoreMutationAllowed("apply");
      return originalApply(...args);
    }) as StoreApply;

    this.store.getState = (() =>
      this.guardStateValue(originalGetState())) as Store<RootState>["getState"];
  }

  private assertStoreMutationAllowed(operation: "apply" | "setState"): void {
    if (
      this.devOptions.strictActions === true &&
      this.actionDepth === 0 &&
      this.internalMutationDepth === 0
    ) {
      throw new CosystemError(`Cannot call store.${operation}() outside an action.`);
    }
  }

  private runWithDraftMutation<T>(callback: () => T): T {
    this.draftMutationDepth += 1;

    try {
      return callback();
    } finally {
      this.draftMutationDepth -= 1;
    }
  }

  private runWithInternalMutation<T>(callback: () => T): T {
    this.internalMutationDepth += 1;

    try {
      return callback();
    } finally {
      this.internalMutationDepth -= 1;
    }
  }

  private guardStateValue<T>(value: T): T {
    if (this.devOptions.strictActions !== true || !isGuardableStateValue(value)) {
      return value;
    }

    const existing = this.stateProxyCache.get(value);

    if (existing !== undefined) {
      return existing as T;
    }

    const proxy = new Proxy(value, {
      defineProperty: (target, property, descriptor) => {
        this.assertDeepMutationAllowed();
        return Reflect.defineProperty(target, property, descriptor);
      },
      deleteProperty: (target, property) => {
        this.assertDeepMutationAllowed();
        return Reflect.deleteProperty(target, property);
      },
      get: (target, property, receiver) =>
        this.guardStateValue(Reflect.get(target, property, receiver)),
      preventExtensions: (target) => {
        this.assertDeepMutationAllowed();
        return Reflect.preventExtensions(target);
      },
      set: (target, property, nextValue, receiver) => {
        this.assertDeepMutationAllowed();
        return Reflect.set(target, property, nextValue, receiver);
      },
      setPrototypeOf: (target, prototype) => {
        this.assertDeepMutationAllowed();
        return Reflect.setPrototypeOf(target, prototype);
      },
    });
    this.stateProxyCache.set(value, proxy);
    return proxy as T;
  }

  private assertDeepMutationAllowed(): void {
    if (this.draftMutationDepth === 0 && this.internalMutationDepth === 0) {
      throw new CosystemError("Cannot mutate state outside an action.");
    }
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

  private assertCanLoadLazyModule(): void {
    if (this.isDisposing || this.isDisposed) {
      throw new CosystemError("Cannot load a lazy module after app disposal.");
    }
  }

  private assertActive(operation: string): void {
    if (this.isDisposing || this.isDisposed) {
      throw new CosystemError(`Cannot ${operation} after app disposal has begun.`);
    }
  }

  private installModuleState(
    modules: readonly ModuleBinding[],
    rootState: RootState = createRootState(modules),
  ): void {
    if (modules.length === 0) {
      return;
    }

    this.runWithInternalMutation(() => {
      this.store.setState({
        ...this.store.getPureState(),
        ...rootState,
      });
    });
  }

  private registerModules(modules: readonly ModuleBinding[]): void {
    for (const moduleBinding of modules) {
      this.modules.push(moduleBinding);
      this.moduleByToken.set(moduleBinding.token, moduleBinding);
      this.moduleByName.set(moduleBinding.name, moduleBinding);
    }
  }

  private unregisterModules(modules: readonly ModuleBinding[]): void {
    for (const moduleBinding of modules) {
      if (this.moduleByToken.get(moduleBinding.token) === moduleBinding) {
        this.moduleByToken.delete(moduleBinding.token);
      }

      if (this.moduleByName.get(moduleBinding.name) === moduleBinding) {
        this.moduleByName.delete(moduleBinding.name);
      }

      const index = this.modules.indexOf(moduleBinding);

      if (index !== -1) {
        this.modules.splice(index, 1);
      }
    }
  }

  private detachRuntimeMetadata(modules: readonly ModuleBinding[]): void {
    for (const moduleBinding of modules) {
      delete moduleBinding.instance[runtimeModuleMetadataKey];
    }
  }

  private uninstallModuleState(modules: readonly ModuleBinding[]): void {
    if (modules.length === 0) {
      return;
    }

    const state = { ...this.store.getPureState() };

    for (const moduleBinding of modules) {
      delete state[moduleBinding.name];
    }

    this.runWithInternalMutation(() => this.store.apply(state));
  }

  private unregisterDynamicScope(scope: Container): void {
    const index = this.dynamicScopes.indexOf(scope);

    if (index !== -1) {
      this.dynamicScopes.splice(index, 1);
    }
  }

  private removePendingLazyModule(module: LazyModule): void {
    const index = this.pendingLazyModules.indexOf(module);

    if (index !== -1) {
      this.pendingLazyModules.splice(index, 1);
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
      const moduleProviderOptions = createModuleClassProviderOptions(provider, metadata);
      assertSingletonModuleScope(provider, moduleProviderOptions.scope);

      return {
        provider: provide(provider, moduleProviderOptions),
        moduleToken: provider,
      };
    }

    return { provider };
  }

  if ("useClass" in provider) {
    const metadata = getModuleMetadata(provider.useClass);

    if (metadata !== undefined) {
      const moduleProvider = {
        ...provider,
        ...mergeModuleClassProviderOptions(provider, metadata),
      };
      assertSingletonModuleScope(provider.provide, moduleProvider.scope);

      return {
        provider: moduleProvider,
        moduleToken: provider.provide,
      };
    }
  }

  return { provider };
}

function providerInputToken(provider: ProviderInput): InjectionToken {
  return typeof provider === "function" ? provider : provider.provide;
}

function isMultiProvider(provider: ProviderInput): boolean {
  return typeof provider !== "function" && provider.multi === true;
}

function assertSingletonModuleScope(token: InjectionToken, scope: Scope | undefined): void {
  const resolvedScope = scope ?? "singleton";

  if (resolvedScope !== "singleton") {
    throw new CosystemError(
      `CoSystem module ${tokenName(token)} must use singleton scope; received ${resolvedScope}. ` +
        "A module owns one app store slice and cannot have multiple instances.",
    );
  }
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

function getRuntimeModuleMetadata(module: object): RuntimeModuleMetadata | undefined {
  return (module as { readonly [runtimeModuleMetadataKey]?: RuntimeModuleMetadata })[
    runtimeModuleMetadataKey
  ];
}

function isTokenObject(value: object): value is Extract<InjectionToken, object> {
  return "id" in value && typeof (value as { readonly id?: unknown }).id === "symbol";
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

function isGuardableStateValue(value: unknown): value is Record<PropertyKey, unknown> | unknown[] {
  if (value === null || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value)) {
    return true;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

async function runCleanupPhase(
  errors: unknown[],
  cleanup: () => void | Promise<void>,
): Promise<void> {
  try {
    await cleanup();
  } catch (error) {
    if (error instanceof AggregateError) {
      errors.push(...error.errors);
      return;
    }

    errors.push(error);
  }
}

function getAppContainer(app: App): Container {
  const container = appContainerMap.get(app);

  if (container === undefined) {
    throw new CosystemError("Parent app was not created by CoSystem.");
  }

  return container;
}
