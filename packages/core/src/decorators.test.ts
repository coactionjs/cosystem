import { describe, expect, it } from "vitest";

import { DecoratorFixture, FixtureLogger } from "./decorators.fixture.js";
import { provide, testApp } from "./index.js";

describe("standard decorators end-to-end", () => {
  it("binds @State, @Computed, and @Action through a live app", () => {
    const messages: string[] = [];
    const app = testApp({
      providers: [
        DecoratorFixture,
        provide(FixtureLogger, {
          useValue: {
            info(message: string): void {
              messages.push(message);
            },
          },
        }),
      ],
    });
    const fixture = app.getModule(DecoratorFixture);

    expect(fixture.count).toBe(0);
    expect(fixture.double).toBe(0);
    expect(app.store.getPureState()).toEqual({ decoratorFixture: { count: 0 } });

    fixture.increase(2);

    expect(fixture.count).toBe(2);
    expect(fixture.double).toBe(4);
    expect(messages).toEqual(["2"]);
    expect(app.store.getPureState()).toEqual({ decoratorFixture: { count: 2 } });
    expect(app.test.getActions()).toMatchObject([
      {
        method: "increase",
        module: "decoratorFixture",
      },
    ]);
  });

  it("enforces strict action writes on decorated state", () => {
    const app = testApp({
      providers: [
        DecoratorFixture,
        provide(FixtureLogger, {
          useValue: {
            info(): void {},
          },
        }),
      ],
      strictActions: true,
    });
    const fixture = app.getModule(DecoratorFixture);

    expect(() => {
      fixture.count = 5;
    }).toThrow(/outside an action/);

    fixture.increase();

    expect(fixture.count).toBe(1);
  });
});
