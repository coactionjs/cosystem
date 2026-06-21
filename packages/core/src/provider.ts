import type {
  ClassProvideOptions,
  ClassProvider,
  DependencySpec,
  ExistingProvideOptions,
  ExistingProvider,
  FactoryProvideOptions,
  FactoryProvider,
  InjectionToken,
  ProviderInput,
  ProviderRecord,
  ResolvedDeps,
  ValueProvideOptions,
  ValueProvider,
} from "./types.js";
import { tokenName } from "./token.js";

export function provide<T>(
  token: InjectionToken<T>,
  options: ClassProvideOptions<T>,
): ClassProvider<T>;

export function provide<T>(
  token: InjectionToken<T>,
  options: ValueProvideOptions<T>,
): ValueProvider<T>;

export function provide<T, const TDeps extends readonly DependencySpec[]>(
  token: InjectionToken<T>,
  options: FactoryProvideOptions<T, TDeps>,
): FactoryProvider<T, TDeps>;

export function provide<T>(
  token: InjectionToken<T>,
  options: ExistingProvideOptions<T>,
): ExistingProvider<T>;

export function provide<T>(
  providerToken: InjectionToken<T>,
  options:
    | ClassProvideOptions<T>
    | ValueProvideOptions<T>
    | FactoryProvideOptions<T, readonly DependencySpec[]>
    | ExistingProvideOptions<T>,
): ClassProvider<T> | ValueProvider<T> | FactoryProvider<T> | ExistingProvider<T> {
  return {
    provide: providerToken,
    ...options,
  };
}

export function normalizeProvider(input: ProviderInput): ProviderRecord {
  if (typeof input === "function") {
    return normalizeProvider({
      provide: input,
      useClass: input,
    });
  }

  const token = input.provide;
  const base = {
    token,
    tokenName: tokenName(token),
    multi: input.multi ?? false,
    leakSafe: input.leakSafe ?? false,
  };

  if ("useClass" in input) {
    return {
      ...base,
      provider: {
        kind: "class",
        useClass: input.useClass,
      },
      scope: input.scope ?? "singleton",
      deps:
        input.deps ??
        (input.useClass as { readonly inject?: readonly DependencySpec[] }).inject ??
        [],
      eager: input.eager ?? false,
      ...eraseDispose(input.dispose),
    };
  }

  if ("useValue" in input) {
    return {
      ...base,
      provider: {
        kind: "value",
        useValue: input.useValue,
      },
      scope: "singleton",
      deps: [],
      eager: true,
      ...eraseDispose(input.dispose),
    };
  }

  if ("useFactory" in input) {
    return {
      ...base,
      provider: {
        kind: "factory",
        useFactory: input.useFactory as (...deps: readonly unknown[]) => unknown,
      },
      scope: input.scope ?? "singleton",
      deps: input.deps ?? [],
      eager: input.eager ?? false,
      ...eraseDispose(input.dispose),
    };
  }

  return {
    ...base,
    provider: {
      kind: "existing",
      useExisting: input.useExisting,
    },
    scope: "singleton",
    deps: [input.useExisting],
    eager: false,
  };
}

export type { ResolvedDeps };

function eraseDispose<T>(dispose: ((value: T) => void | Promise<void>) | undefined): {
  readonly dispose?: (value: unknown) => void | Promise<void>;
} {
  if (dispose === undefined) {
    return {};
  }

  return {
    dispose: dispose as (value: unknown) => void | Promise<void>,
  };
}
