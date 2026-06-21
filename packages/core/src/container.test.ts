import { describe, expect, expectTypeOf, it } from "vitest";

import {
  AmbiguousProviderError,
  AsyncProviderInSyncResolutionError,
  CircularDependencyError,
  DuplicateProviderError,
  FrozenContainerError,
  InjectContextError,
  LifetimeLeakError,
  MissingProviderError,
  createContainer,
  inject,
  provide,
  token,
} from "./index.js";

interface Logger {
  info(message: string): void;
}

class ConsoleLogger implements Logger {
  readonly messages: string[] = [];

  info(message: string): void {
    this.messages.push(message);
  }
}

class Counter {
  static readonly inject = [ConsoleLogger] as const;

  count = 0;

  constructor(readonly logger: ConsoleLogger) {}

  increase(): void {
    this.count += 1;
    this.logger.info(`count: ${this.count}`);
  }
}

describe("DI container", () => {
  it("creates typed tokens", () => {
    const LoggerToken = token<Logger>("Logger");

    expect(LoggerToken.description).toBe("Logger");
    expect(typeof LoggerToken.id).toBe("symbol");
  });

  it("resolves class shorthand providers with static inject metadata", () => {
    const container = createContainer();

    container.provide(ConsoleLogger);
    container.provide(Counter);

    const counter = container.get(Counter);

    counter.increase();

    expect(counter.count).toBe(1);
    expect(counter.logger.messages).toEqual(["count: 1"]);
    expect(container.get(Counter)).toBe(counter);
  });

  it("resolves value providers with typed tokens", () => {
    const LoggerToken = token<Logger>("Logger");
    const logger = new ConsoleLogger();
    const container = createContainer();

    container.provide(provide(LoggerToken, { useValue: logger }));

    expect(container.get(LoggerToken)).toBe(logger);
  });

  it("resolves class, existing, factory, optional, and many providers", () => {
    const LoggerToken = token<Logger>("Logger");
    const AliasToken = token<Logger>("AliasLogger");
    const OptionalToken = token<string>("Optional");
    const PluginToken = token<{ readonly name: string }>("Plugin");
    const SummaryToken = token<string>("Summary");
    const container = createContainer();

    container.provide(provide(LoggerToken, { useClass: ConsoleLogger }));
    container.provide(provide(AliasToken, { useExisting: LoggerToken }));
    container.provide(provide(PluginToken, { multi: true, useValue: { name: "a" } }));
    container.provide(provide(PluginToken, { multi: true, useValue: { name: "b" } }));
    container.provide(
      provide(SummaryToken, {
        deps: [
          AliasToken,
          { token: OptionalToken, optional: true },
          { token: PluginToken, many: true },
        ] as const,
        useFactory: (logger, optional, plugins) => {
          expectTypeOf(logger).toEqualTypeOf<Logger>();
          expectTypeOf(optional).toEqualTypeOf<string | undefined>();
          expectTypeOf(plugins).toEqualTypeOf<{ readonly name: string }[]>();
          logger.info("factory");
          return `${optional ?? "none"}:${plugins.map((plugin) => plugin.name).join(",")}`;
        },
      }),
    );

    expect(container.get(SummaryToken)).toBe("none:a,b");
    expect(container.getAll(PluginToken).map((plugin) => plugin.name)).toEqual(["a", "b"]);
  });

  it("supports async factories through getAsync only", async () => {
    const AsyncToken = token<string>("Async");
    const container = createContainer();

    container.provide(
      provide(AsyncToken, {
        useFactory: async () => "ready",
      }),
    );

    expect(() => container.get(AsyncToken)).toThrow(AsyncProviderInSyncResolutionError);
    await expect(container.getAsync(AsyncToken)).resolves.toBe("ready");
  });

  it("supports explicit build without registering the class", () => {
    const container = createContainer();
    container.provide(ConsoleLogger);

    const counter = container.build(Counter);

    counter.increase();
    expect(counter.logger.messages).toEqual(["count: 1"]);
    expect(() => container.get(Counter)).toThrow(MissingProviderError);
  });

  it("supports explicit async build when dependencies resolve asynchronously", async () => {
    const LoggerToken = token<Logger>("AsyncLogger");
    const logger = new ConsoleLogger();
    const container = createContainer();

    class AsyncCounter {
      static readonly inject = [LoggerToken] as const;

      constructor(readonly resolvedLogger: Logger) {}
    }

    container.provide(
      provide(LoggerToken, {
        useFactory: async () => logger,
      }),
    );

    expect(() => container.build(AsyncCounter)).toThrow(AsyncProviderInSyncResolutionError);

    const counter = await container.buildAsync(AsyncCounter);

    expect(counter.resolvedLogger).toBe(logger);
    expect(() => container.get(AsyncCounter)).toThrow(MissingProviderError);
  });

  it("includes the requesting provider in missing dependency errors", () => {
    const MissingLoggerToken = token<Logger>("MissingLogger");

    class NeedsMissingLogger {
      static readonly inject = [MissingLoggerToken] as const;
      readonly kind = "needsMissingLogger";
    }

    const container = createContainer();
    container.provide(NeedsMissingLogger);

    expect(() => container.get(NeedsMissingLogger)).toThrow(
      /Missing provider for MissingLogger[\s\S]*NeedsMissingLogger/,
    );
  });

  it("creates scoped instances per child container", () => {
    class RequestContext {
      readonly id = Symbol("request");
    }

    const root = createContainer();
    root.provide(provide(RequestContext, { scope: "scoped", useClass: RequestContext }));

    const first = root.createScope();
    const second = root.createScope();

    expect(first.get(RequestContext)).toBe(first.get(RequestContext));
    expect(first.get(RequestContext)).not.toBe(second.get(RequestContext));
  });

  it("creates transient and resolution-scoped instances with expected identity", () => {
    class TransientThing {
      readonly id = Symbol("transient");
    }
    class ResolutionThing {
      readonly id = Symbol("resolution");
    }
    class UsesResolution {
      static readonly inject = [ResolutionThing, ResolutionThing] as const;

      constructor(
        readonly first: ResolutionThing,
        readonly second: ResolutionThing,
      ) {}
    }

    const container = createContainer({ strictScopes: false });
    container.provide(provide(TransientThing, { scope: "transient", useClass: TransientThing }));
    container.provide(provide(ResolutionThing, { scope: "resolution", useClass: ResolutionThing }));
    container.provide(UsesResolution);

    expect(container.get(TransientThing)).not.toBe(container.get(TransientThing));

    const usesResolution = container.get(UsesResolution);
    expect(usesResolution.first).toBe(usesResolution.second);

    const nextUsesResolution = container.get(UsesResolution);
    expect(nextUsesResolution).toBe(usesResolution);
  });

  it("detects duplicate and ambiguous providers", () => {
    const LoggerToken = token<Logger>("Logger");
    const container = createContainer();

    container.provide(provide(LoggerToken, { useValue: new ConsoleLogger() }));

    expect(() =>
      container.provide(provide(LoggerToken, { useValue: new ConsoleLogger() })),
    ).toThrow(DuplicateProviderError);

    const MultiLoggerToken = token<Logger>("MultiLogger");
    container.provide(provide(MultiLoggerToken, { multi: true, useValue: new ConsoleLogger() }));
    container.provide(provide(MultiLoggerToken, { multi: true, useValue: new ConsoleLogger() }));

    expect(() => container.get(MultiLoggerToken)).toThrow(AmbiguousProviderError);
    expect(container.getAll(MultiLoggerToken)).toHaveLength(2);
  });

  it("supports override before freeze and rejects mutation after freeze", () => {
    const LoggerToken = token<Logger>("Logger");
    const first = new ConsoleLogger();
    const second = new ConsoleLogger();
    const container = createContainer();

    container.provide(provide(LoggerToken, { useValue: first }));
    container.override(provide(LoggerToken, { useValue: second }));

    expect(container.get(LoggerToken)).toBe(second);

    container.freeze();

    expect(() => container.provide(ConsoleLogger)).toThrow(FrozenContainerError);
    expect(() => container.override(provide(LoggerToken, { useValue: first }))).toThrow(
      FrozenContainerError,
    );
  });

  it("detects circular dependencies", () => {
    class First {
      static readonly inject = [] as const;
      readonly name = "first";
    }
    class Second {
      static readonly inject = [First] as const;
      readonly name = "second";
    }

    Object.defineProperty(First, "inject", { value: [Second] as const });

    const container = createContainer();
    container.provide(First);
    container.provide(Second);

    expect(() => container.get(First)).toThrow(CircularDependencyError);
  });

  it("detects lifetime leaks unless the dependency is leakSafe", () => {
    class RequestContext {
      readonly id = Symbol("request");
    }
    class ApiClient {
      static readonly inject = [RequestContext] as const;

      constructor(readonly context: RequestContext) {}
    }

    const container = createContainer();
    container.provide(provide(RequestContext, { scope: "scoped", useClass: RequestContext }));
    container.provide(ApiClient);

    expect(() => container.get(ApiClient)).toThrow(LifetimeLeakError);

    const allowed = createContainer();
    allowed.provide(
      provide(RequestContext, {
        leakSafe: true,
        scope: "scoped",
        useClass: RequestContext,
      }),
    );
    allowed.provide(ApiClient);

    expect(allowed.get(ApiClient)).toBeInstanceOf(ApiClient);
  });

  it("supports inject() inside factory providers only", () => {
    const LoggerToken = token<Logger>("Logger");
    const SummaryToken = token<string>("Summary");
    const logger = new ConsoleLogger();
    const container = createContainer();

    container.provide(provide(LoggerToken, { useValue: logger }));
    container.provide(
      provide(SummaryToken, {
        useFactory: () => {
          inject(LoggerToken).info("injected");
          return "done";
        },
      }),
    );

    expect(container.get(SummaryToken)).toBe("done");
    expect(logger.messages).toEqual(["injected"]);
    expect(() => inject(LoggerToken)).toThrow(InjectContextError);
  });

  it("disposes created instances in reverse order and aggregates errors", async () => {
    const disposed: string[] = [];

    class First {
      dispose(): void {
        disposed.push("first");
      }
    }

    class Second {
      dispose(): void {
        disposed.push("second");
        throw new Error("failed");
      }
    }

    const container = createContainer();
    container.provide(First);
    container.provide(Second);

    container.get(First);
    container.get(Second);

    await expect(container.dispose()).rejects.toThrow(AggregateError);
    expect(disposed).toEqual(["second", "first"]);
  });
});
