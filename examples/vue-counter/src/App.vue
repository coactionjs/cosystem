<script setup lang="ts">
import { useComputed, useModule } from "@cosystem/vue";

import { Counter } from "./counter";

const counter = useModule(Counter);
const count = useComputed((app) => app.getModule(Counter).count);
const double = useComputed((app) => app.getModule(Counter).double);
</script>

<template>
  <main class="shell">
    <section class="panel">
      <span class="eyebrow">Vue + CoSystem</span>
      <h1>Counter module</h1>
      <dl class="stats">
        <div>
          <dt>Count</dt>
          <dd>{{ count }}</dd>
        </div>
        <div>
          <dt>Double</dt>
          <dd>{{ double }}</dd>
        </div>
      </dl>
      <div class="actions">
        <button type="button" @click="counter.increase()">Increase</button>
        <button type="button" class="secondary" @click="counter.reset()">Reset</button>
      </div>
    </section>
  </main>
</template>

<style scoped>
:global(:root) {
  color: #1f2933;
  background: #eef6f4;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

:global(*) {
  box-sizing: border-box;
}

:global(body) {
  margin: 0;
}

button {
  border: 1px solid #134e4a;
  border-radius: 8px;
  background: #134e4a;
  color: #ffffff;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  padding: 0.75rem 1rem;
}

button.secondary {
  background: #ffffff;
  color: #134e4a;
}

.shell {
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 2rem;
}

.panel {
  width: min(100%, 28rem);
  border: 1px solid #bad7d0;
  border-radius: 8px;
  background: #ffffff;
  padding: 2rem;
  box-shadow: 0 20px 50px rgb(19 78 74 / 12%);
}

.eyebrow {
  color: #0f766e;
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
  border: 1px solid #d7ebe6;
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
</style>
