import { action, computed, effect, module, state } from "./decorators.js";

export abstract class FixtureLogger {
  abstract info(message: string): void;
}

@module({
  deps: [FixtureLogger],
  name: "decoratorFixture",
})
export class DecoratorFixture {
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

  @effect
  recordCount(): void {
    this.logger.info(`effect:${this.count}`);
  }
}
