import { action, computed, module, state } from "./decorators.js";

abstract class FixtureLogger {
  abstract info(message: string): void;
}

@module({
  deps: [FixtureLogger],
  name: "decoratorFixture",
})
class DecoratorFixture {
  constructor(readonly logger: FixtureLogger) {}

  @state
  accessor count = 0;

  @computed
  get double(): number {
    return this.count * 2;
  }

  @action
  increase(step = 1): void {
    this.count += step;
    this.logger.info(String(this.count));
  }
}

void DecoratorFixture;
