import { Action, Computed, Effect, Module, State } from "./decorators.js";

export abstract class FixtureLogger {
  abstract info(message: string): void;
}

@Module({
  deps: [FixtureLogger],
  name: "decoratorFixture",
})
export class DecoratorFixture {
  constructor(readonly logger: FixtureLogger) {}

  @State
  accessor count = 0;

  @Computed
  get double(): number {
    return this.count * 2;
  }

  @Action
  increase(step = 1): void {
    this.count += step;
    this.logger.info(String(this.count));
  }

  @Effect
  recordCount(): void {
    this.logger.info(`effect:${this.count}`);
  }
}
