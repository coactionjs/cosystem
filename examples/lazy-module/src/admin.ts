import { defineModule } from "@cosystem/core";

export class AdminCounter {
  count = 0;

  get double(): number {
    return this.count * 2;
  }

  increase(step = 1): void {
    this.count += step;
  }

  reset(): void {
    this.count = 0;
  }
}

defineModule(AdminCounter, {
  actions: ["increase", "reset"],
  computed: ["double"],
  name: "adminCounter",
  state: ["count"],
});
