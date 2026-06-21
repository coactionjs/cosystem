import { create as createCoactionStore, createReactiveTracker, type Store } from "coaction";

import { createContainer } from "./container.js";
import { CosystemError, DuplicateProviderError } from "./errors.js";
import { getModuleMetadata, type ModuleMetadata } from "./metadata.js";
import { provide } from "./provider.js";
import { tokenName } from "./token.js";
import type {
  ClassProvideOptions,
  Constructor,
  Container,
  InjectionToken,
  Provider,
  ProviderInput,
  ScopeOptions,
} from "./types.js";

export interface EngineOptions {
  readonly patches?: boolean;
  readonly devtools?: boolean;
  readonly transport?: unknown;
}

export interface AppDevOptions {
  readonly strictActions?: boolean;
}

export interface CreateAppOptions {
  readonly providers?: readonly ProviderInput[];
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

  for (const provider of options.providers ?? []) {
    const normalized = normalizeAppProvider(provider);
    container.provide(normalized.provider);

    if (normalized.moduleToken !== undefined) {
      moduleTokens.push(normalized.moduleToken);
    }
  }

  for (const override of options.overrides ?? []) {
    container.override(normalizeAppProvider(override).provider);
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
    modules,
    plugins: options.plugins ?? [],
    state,
    store,
    ...(options.testInspector === undefined ? {} : { testInspector: options.testInspector }),
  });

  app.bindModules();
  app.attachRuntimeMetadata();
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
  private readonly moduleByToken = new Map<InjectionToken, ModuleBinding>();
  private readonly moduleByName = new Map<string, ModuleBinding>();
  private readonly plugins: readonly Plugin[];
  private readonly testInspector: MutableTestInspector | undefined;
  private initPromise: Promise<void> = Promise.resolve();
  private isStarted = false;
  private isDisposed = false;

  constructor(options: {
    readonly container: Container;
    readonly devOptions: AppDevOptions;
    readonly modules: ModuleBinding[];
    readonly plugins: readonly Plugin[];
    readonly state: AppState;
    readonly store: Store<RootState>;
    readonly testInspector?: MutableTestInspector;
  }) {
    this.#container = options.container;
    this.devOptions = options.devOptions;
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
    const value = this.get(token);

    if (!this.moduleByToken.has(token)) {
      throw new CosystemError(`${tokenName(token)} is not a CoSystem module.`);
    }

    return value;
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
      await this.runLifecycle("onDispose", true);
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

  bindModules(): void {
    for (const moduleBinding of this.modules) {
      this.bindState(moduleBinding);
      this.bindComputed(moduleBinding);
      this.bindActions(moduleBinding);
    }
  }

  attachRuntimeMetadata(): void {
    for (const moduleBinding of this.modules) {
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

  runModuleCreatedHooks(): void {
    for (const moduleBinding of this.modules) {
      const event: ModuleCreatedEvent = {
        name: moduleBinding.name,
        token: moduleBinding.token,
        instance: moduleBinding.instance,
      };

      for (const plugin of this.plugins) {
        plugin.onModuleCreated?.(event);
      }
    }
  }

  init(): void {
    this.initPromise = (async () => {
      try {
        await Promise.all(this.plugins.map((plugin) => plugin.setup?.(this)));
        await this.runLifecycle("onInit");
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
      moduleBinding.originalComputed.set(property, getter);

      Object.defineProperty(moduleBinding.instance, property, {
        configurable: true,
        enumerable: true,
        get: () => getter.call(moduleBinding.instance),
      });
    }
  }

  private readModuleState(moduleBinding: ModuleBinding, property: PropertyKey): unknown {
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
    } catch (caught) {
      error = caught;
      this.emitError(caught, { phase: "action" });
    } finally {
      moduleBinding.actionDepth -= 1;
    }

    const endedEvent: ActionEvent = {
      ...event,
      endedAt: Date.now(),
      ...(error === undefined ? {} : { error }),
    };
    this.testInspector?.recordAction(endedEvent);
    this.emitActionEnd(endedEvent);

    if (error !== undefined) {
      throw error;
    }

    return result;
  }

  private async runLifecycle(method: keyof LifecycleModule, reverse = false): Promise<void> {
    const modules = reverse ? this.modules.toReversed() : this.modules;

    for (const moduleBinding of modules) {
      const lifecycle = moduleBinding.instance as LifecycleModule;
      await lifecycle[method]?.();
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

function instantiateModules(container: Container, moduleTokens: readonly InjectionToken[]) {
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
      instance,
      metadata,
      name,
      originalActions: new Map(),
      originalComputed: new Map(),
      token: moduleToken,
    });
  }

  return modules;
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

function getAppContainer(app: App): Container {
  const container = appContainerMap.get(app);

  if (container === undefined) {
    throw new CosystemError("Parent app was not created by CoSystem.");
  }

  return container;
}
