import { CosystemError } from "./errors.js";
import type { ProviderInput } from "./types.js";

export interface LazyModule {
  readonly kind: "lazyModule";
  load(): LazyModuleLoadInput | Promise<LazyModuleLoadInput>;
}

export interface LazyModuleExports {
  readonly default?: ProviderInput | readonly ProviderInput[];
  readonly providers?: readonly ProviderInput[];
}

export type LazyModuleLoadInput = ProviderInput | readonly ProviderInput[] | LazyModuleExports;

export type AppProviderInput = ProviderInput | LazyModule;

export function lazyModule(
  load: () => LazyModuleLoadInput | Promise<LazyModuleLoadInput>,
): LazyModule {
  return {
    kind: "lazyModule",
    load,
  };
}

export function isLazyModule(input: AppProviderInput): input is LazyModule {
  return (
    typeof input === "object" &&
    input !== null &&
    "kind" in input &&
    input.kind === "lazyModule" &&
    "load" in input &&
    typeof input.load === "function"
  );
}

export function normalizeLazyModuleProviders(input: LazyModuleLoadInput): readonly ProviderInput[] {
  if (isProviderInput(input)) {
    return [input];
  }

  if (Array.isArray(input)) {
    assertProviderArray(input);
    return input;
  }

  if (typeof input === "object" && input !== null) {
    const exports = input as LazyModuleExports;
    const providers: ProviderInput[] = [];

    if (exports.providers !== undefined) {
      assertProviderArray(exports.providers);
      providers.push(...exports.providers);
    }

    if (exports.default !== undefined) {
      if (Array.isArray(exports.default)) {
        assertProviderArray(exports.default);
        providers.push(...exports.default);
      } else if (isProviderInput(exports.default)) {
        providers.push(exports.default);
      } else {
        throw new CosystemError("Lazy module default export must be a provider or provider array.");
      }
    }

    if (providers.length > 0) {
      return providers;
    }
  }

  throw new CosystemError(
    "Lazy module loader must return a provider, provider array, or module exports with providers/default.",
  );
}

function assertProviderArray(
  values: readonly unknown[],
): asserts values is readonly ProviderInput[] {
  if (values.every(isProviderInput)) {
    return;
  }

  throw new CosystemError("Lazy module provider arrays may only contain provider entries.");
}

function isProviderInput(value: unknown): value is ProviderInput {
  if (typeof value === "function") {
    return true;
  }

  return (
    typeof value === "object" &&
    value !== null &&
    "provide" in value &&
    ("useClass" in value || "useValue" in value || "useFactory" in value || "useExisting" in value)
  );
}
