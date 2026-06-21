import { describe, expect, it } from "vitest";

import { action, computed, getModuleMetadata, module, state } from "./index.js";

describe("module metadata storage", () => {
  it("merges standard decorator context metadata into module metadata", () => {
    const metadata: Record<PropertyKey, unknown> = {};

    state(
      undefined as never,
      {
        addInitializer() {},
        kind: "accessor",
        metadata,
        name: "count",
        private: false,
        static: false,
      } as unknown as ClassAccessorDecoratorContext<object, number>,
    );
    action(function increase() {}, {
      addInitializer() {},
      kind: "method",
      metadata,
      name: "increase",
      private: false,
      static: false,
    } as unknown as ClassMethodDecoratorContext<object, () => void>);
    computed(
      function double() {
        return 0;
      },
      {
        addInitializer() {},
        kind: "getter",
        metadata,
        name: "double",
        private: false,
        static: false,
      } as unknown as ClassGetterDecoratorContext<object, number>,
    );

    class Counter {}

    module({ name: "metadataCounter" })(Counter, {
      addInitializer() {},
      kind: "class",
      metadata,
      name: "Counter",
    } as ClassDecoratorContext<typeof Counter>);

    const moduleMetadata = getModuleMetadata(Counter);

    expect(moduleMetadata?.name).toBe("metadataCounter");
    expect(moduleMetadata?.state.has("count")).toBe(true);
    expect(moduleMetadata?.actions.has("increase")).toBe(true);
    expect(moduleMetadata?.computed.has("double")).toBe(true);
  });
});
