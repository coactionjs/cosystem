export class CosystemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CosystemError";
  }
}

export class FrozenContainerError extends CosystemError {
  constructor() {
    super("Container provider graph is frozen and can no longer be mutated.");
    this.name = "FrozenContainerError";
  }
}

export class MissingProviderError extends CosystemError {
  constructor(token: string, path: readonly string[]) {
    super(
      [
        `Missing provider for ${token}.`,
        path.length > 0 ? "Resolution path:" : "",
        ...path.map((entry) => `  ${entry}`),
      ]
        .filter(Boolean)
        .join("\n"),
    );
    this.name = "MissingProviderError";
  }
}

export class DuplicateProviderError extends CosystemError {
  constructor(token: string) {
    super(`Duplicate non-multi provider for ${token}. Use override() or mark providers as multi.`);
    this.name = "DuplicateProviderError";
  }
}

export class AmbiguousProviderError extends CosystemError {
  constructor(token: string) {
    super(`Multiple providers registered for ${token}. Use getAll() instead of get().`);
    this.name = "AmbiguousProviderError";
  }
}

export class CircularDependencyError extends CosystemError {
  constructor(path: readonly string[]) {
    super(["Circular dependency detected:", ...path.map((entry) => `  ${entry}`)].join("\n"));
    this.name = "CircularDependencyError";
  }
}

export class AsyncProviderInSyncResolutionError extends CosystemError {
  constructor(token: string) {
    super(`Provider for ${token} resolved asynchronously. Use getAsync() instead of get().`);
    this.name = "AsyncProviderInSyncResolutionError";
  }
}

export class LifetimeLeakError extends CosystemError {
  constructor(parent: string, parentScope: string, child: string, childScope: string) {
    super(`${parent} (${parentScope}) cannot depend on ${child} (${childScope}) without leakSafe.`);
    this.name = "LifetimeLeakError";
  }
}

export class InjectContextError extends CosystemError {
  constructor(token: string) {
    super(`${token} can only be injected while resolving a provider or running an app hook.`);
    this.name = "InjectContextError";
  }
}
