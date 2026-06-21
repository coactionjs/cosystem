import { describe, expect, expectTypeOf, it } from "vitest";

import {
  provide,
  token,
  type ClassProvider,
  type ExistingProvider,
  type FactoryProvider,
  type ValueProvider,
} from "./index.js";

interface Logger {
  info(message: string): void;
}

class ConsoleLogger implements Logger {
  info(_message: string): void {}
}

class IncompatibleLogger {
  readonly info = (_message: number): void => {};
}

describe("provider type contracts", () => {
  it("preserves typed provider shapes", () => {
    const LoggerToken = token<Logger>("Logger");
    const AliasToken = token<Logger>("AliasLogger");
    const SummaryToken = token<string>("Summary");
    const logger = new ConsoleLogger();
    const deps = [LoggerToken] as const;

    const valueProvider = provide(LoggerToken, { useValue: logger });
    const classProvider = provide(LoggerToken, { useClass: ConsoleLogger });
    const existingProvider = provide(LoggerToken, { useExisting: AliasToken });
    const factoryProvider = provide(SummaryToken, {
      deps,
      useFactory: (dependency) => {
        expectTypeOf(dependency).toEqualTypeOf<Logger>();
        return "ready";
      },
    });

    expectTypeOf(valueProvider).toEqualTypeOf<ValueProvider<Logger>>();
    expectTypeOf(classProvider).toEqualTypeOf<ClassProvider<Logger>>();
    expectTypeOf(existingProvider).toEqualTypeOf<ExistingProvider<Logger>>();
    expectTypeOf(factoryProvider).toEqualTypeOf<FactoryProvider<string, typeof deps>>();
  });

  it("rejects providers that do not satisfy their token type", () => {
    const LoggerToken = token<Logger>("Logger");
    const StringToken = token<string>("String");

    expect(LoggerToken.description).toBe("Logger");

    // @ts-expect-error useValue must satisfy the token value type.
    provide(LoggerToken, { useValue: "not a logger" });

    // @ts-expect-error useClass instances must satisfy the token value type.
    provide(LoggerToken, { useClass: IncompatibleLogger });

    // @ts-expect-error useExisting must point at a compatible token.
    provide(LoggerToken, { useExisting: StringToken });

    // @ts-expect-error useFactory return value must satisfy the token value type.
    provide(LoggerToken, { useFactory: () => "not a logger" });
  });
});
