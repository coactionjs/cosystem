export interface Token<_T = any> {
  readonly id: symbol;
  readonly description?: string;
  readonly __type?: (value: _T) => _T;
}

export type Constructor<T = unknown> = new (...args: any[]) => T;
export type ClassToken<T = any> = abstract new (...args: any[]) => T;
export type InjectionToken<T = any> = Token<T> | ClassToken<T> | string | symbol;
export type TokenValue<TToken> = TToken extends InjectionToken<infer TValue> ? TValue : unknown;

export type DependencySpec<T = any> =
  | InjectionToken<T>
  | {
      readonly token: InjectionToken<T>;
      readonly optional?: boolean;
      readonly many?: boolean;
    };

export type DependencyValue<TDep> = TDep extends {
  readonly token: infer TToken;
  readonly many: true;
}
  ? TokenValue<TToken>[]
  : TDep extends { readonly token: infer TToken; readonly optional: true }
    ? TokenValue<TToken> | undefined
    : TDep extends { readonly token: infer TToken }
      ? TokenValue<TToken>
      : TokenValue<TDep>;

export type ResolvedDeps<TDeps extends readonly DependencySpec[]> = {
  [Index in keyof TDeps]: DependencyValue<TDeps[Index]>;
};

export type Scope = "singleton" | "scoped" | "resolution" | "transient";

export interface ProviderOptionsBase<T> {
  readonly scope?: Scope;
  readonly multi?: boolean;
  readonly eager?: boolean;
  readonly leakSafe?: boolean;
  readonly autoDispose?: boolean;
  readonly dispose?: (value: T) => void | Promise<void>;
}

export interface ClassProvideOptions<T> extends ProviderOptionsBase<T> {
  readonly useClass: Constructor<T>;
  readonly deps?: readonly DependencySpec[];
}

export interface ValueProvideOptions<T> {
  readonly useValue: T;
  readonly multi?: boolean;
  readonly leakSafe?: boolean;
  readonly autoDispose?: boolean;
  readonly dispose?: (value: T) => void | Promise<void>;
}

export interface FactoryProvideOptions<
  T,
  TDeps extends readonly DependencySpec[] = readonly [],
> extends ProviderOptionsBase<T> {
  readonly deps?: TDeps;
  readonly useFactory: (...deps: ResolvedDeps<TDeps>) => T | Promise<T>;
}

export interface ExistingProvideOptions<T> {
  readonly useExisting: InjectionToken<T>;
  readonly multi?: boolean;
  readonly leakSafe?: boolean;
}

export interface ClassProvider<T = unknown> {
  readonly provide: InjectionToken<T>;
  readonly useClass: Constructor<T>;
  readonly deps?: readonly DependencySpec[];
  readonly scope?: Scope;
  readonly multi?: boolean;
  readonly eager?: boolean;
  readonly leakSafe?: boolean;
  readonly autoDispose?: boolean;
  readonly dispose?: (value: T) => void | Promise<void>;
}

export interface ValueProvider<T = unknown> {
  readonly provide: InjectionToken<T>;
  readonly useValue: T;
  readonly multi?: boolean;
  readonly leakSafe?: boolean;
  readonly autoDispose?: boolean;
  readonly dispose?: (value: T) => void | Promise<void>;
}

export interface FactoryProvider<
  T = unknown,
  TDeps extends readonly DependencySpec[] = readonly DependencySpec[],
> {
  readonly provide: InjectionToken<T>;
  readonly useFactory: (...deps: ResolvedDeps<TDeps>) => T | Promise<T>;
  readonly deps?: TDeps;
  readonly scope?: Scope;
  readonly multi?: boolean;
  readonly eager?: boolean;
  readonly leakSafe?: boolean;
  readonly autoDispose?: boolean;
  readonly dispose?: (value: T) => void | Promise<void>;
}

export interface ExistingProvider<T = unknown> {
  readonly provide: InjectionToken<T>;
  readonly useExisting: InjectionToken<T>;
  readonly multi?: boolean;
  readonly leakSafe?: boolean;
}

export type Provider<
  T = unknown,
  TDeps extends readonly DependencySpec[] = readonly DependencySpec[],
> = ClassProvider<T> | ValueProvider<T> | FactoryProvider<T, TDeps> | ExistingProvider<T>;

export type ProviderInput = Constructor<any> | Provider<any, readonly DependencySpec<any>[]>;

export interface InjectableClass<T = unknown> extends Constructor<T> {
  readonly inject?: readonly DependencySpec[];
}

export interface ContainerOptions {
  readonly parent?: Container;
  readonly strictScopes?: boolean;
}

export interface ScopeOptions {
  readonly strictScopes?: boolean;
}

export interface BuildOptions {
  readonly deps?: readonly DependencySpec[];
}

export interface Container {
  get<T>(token: InjectionToken<T>): T;
  get<T>(token: InjectionToken<T>, options: { readonly optional: true }): T | undefined;
  getAll<T>(token: InjectionToken<T>): T[];
  getAsync<T>(token: InjectionToken<T>): Promise<T>;
  has(token: InjectionToken): boolean;
  provide(provider: ProviderInput): void;
  override(provider: ProviderInput): void;
  createScope(options?: ScopeOptions): Container;
  build<T>(target: Constructor<T>, options?: BuildOptions): T;
  buildAsync<T>(target: Constructor<T>, options?: BuildOptions): Promise<T>;
  freeze(): void;
  dispose(): Promise<void>;
}

export interface ResolutionContext {
  readonly stack: readonly ProviderRecord[];
  readonly resolutionCache: Map<ProviderRecord, unknown>;
  readonly mode: "sync" | "async";
  readonly requestContainer: ContainerImpl;
  resolve<T>(token: InjectionToken<T>): T;
}

export interface ProviderRecord {
  readonly token: InjectionToken;
  readonly tokenName: string;
  readonly provider: NormalizedProvider;
  readonly scope: Scope;
  readonly deps: readonly DependencySpec[];
  readonly multi: boolean;
  readonly eager: boolean;
  readonly leakSafe: boolean;
  readonly autoDispose: boolean;
  readonly dispose?: (value: unknown) => void | Promise<void>;
}

export type NormalizedProvider =
  | {
      readonly kind: "class";
      readonly useClass: Constructor;
    }
  | {
      readonly kind: "value";
      readonly useValue: unknown;
    }
  | {
      readonly kind: "factory";
      readonly useFactory: (...deps: readonly unknown[]) => unknown | Promise<unknown>;
    }
  | {
      readonly kind: "existing";
      readonly useExisting: InjectionToken;
    };

export interface ContainerImpl extends Container {
  readonly disposed: boolean;
  readonly parent: ContainerImpl | undefined;
  readonly pendingResolutions: Set<Promise<unknown>>;
  readonly strictScopes: boolean;
  readonly records: Map<InjectionToken, ProviderRecord[]>;
  readonly scopedCache: Map<ProviderRecord, unknown>;
  readonly singletonCache: Map<ProviderRecord, unknown>;
  readonly created: DisposableInstance[];
  readonly frozen: boolean;
  readonly root: ContainerImpl;
  findRecords(token: InjectionToken): ProviderRecord[];
  getAllRecordsFromHierarchy(token: InjectionToken): ProviderRecord[];
  runWithResolutionContext<T>(callback: () => T): T;
}

export interface DisposableInstance {
  readonly value: unknown;
  readonly record: ProviderRecord;
  disposed: boolean;
}
