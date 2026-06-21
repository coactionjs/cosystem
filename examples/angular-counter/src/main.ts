// oxlint-disable-next-line import/no-unassigned-import -- Angular requires Zone.js as a runtime side effect.
import "zone.js";

import { Component } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";

import { createApp, defineModule } from "@cosystem/core";
import { injectModule, injectSignal, provideCoSystem } from "@cosystem/angular";

class Counter {
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

defineModule(Counter, {
  actions: ["increase", "reset"],
  computed: ["double"],
  name: "counter",
  state: ["count"],
});

const app = createApp({
  providers: [Counter],
});

@Component({
  selector: "cosystem-root",
  standalone: true,
  styles: [
    `
      :host {
        display: block;
        color: #1f2933;
        background: #fff7ed;
        font-family:
          Inter,
          ui-sans-serif,
          system-ui,
          -apple-system,
          BlinkMacSystemFont,
          "Segoe UI",
          sans-serif;
      }

      *,
      *::before,
      *::after {
        box-sizing: border-box;
      }

      .shell {
        display: grid;
        min-height: 100vh;
        place-items: center;
        padding: 2rem;
      }

      .panel {
        width: min(100%, 28rem);
        border: 1px solid #f4c7a3;
        border-radius: 8px;
        background: #ffffff;
        padding: 2rem;
        box-shadow: 0 20px 50px rgb(154 52 18 / 12%);
      }

      .eyebrow {
        color: #9a3412;
        font-size: 0.78rem;
        font-weight: 800;
        text-transform: uppercase;
      }

      h1 {
        margin: 0.5rem 0 1.5rem;
        font-size: 2rem;
      }

      .stats {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1rem;
        margin: 0 0 1.5rem;
      }

      .stats div {
        border: 1px solid #fed7aa;
        border-radius: 8px;
        padding: 1rem;
      }

      dt {
        color: #667085;
        font-size: 0.8rem;
        font-weight: 700;
      }

      dd {
        margin: 0.25rem 0 0;
        font-size: 2rem;
        font-weight: 800;
      }

      .actions {
        display: flex;
        gap: 0.75rem;
      }

      button {
        border: 1px solid #9a3412;
        border-radius: 8px;
        background: #9a3412;
        color: #ffffff;
        cursor: pointer;
        font: inherit;
        font-weight: 700;
        padding: 0.75rem 1rem;
      }

      button.secondary {
        background: #ffffff;
        color: #9a3412;
      }
    `,
  ],
  template: `
    <main class="shell">
      <section class="panel">
        <span class="eyebrow">Angular + CoSystem</span>
        <h1>Counter module</h1>
        <dl class="stats">
          <div>
            <dt>Count</dt>
            <dd>{{ count() }}</dd>
          </div>
          <div>
            <dt>Double</dt>
            <dd>{{ double() }}</dd>
          </div>
        </dl>
        <div class="actions">
          <button type="button" (click)="counter.increase()">Increase</button>
          <button type="button" class="secondary" (click)="counter.reset()">Reset</button>
        </div>
      </section>
    </main>
  `,
})
class CounterView {
  readonly counter = injectModule(Counter);
  readonly count = injectSignal(Counter, (module) => module.count);
  readonly double = injectSignal(Counter, (module) => module.double);
}

void bootstrapApplication(CounterView, {
  providers: [provideCoSystem(app)],
});
