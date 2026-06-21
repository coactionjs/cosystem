<script lang="ts">
  import { moduleStore, selectedModuleStore } from "@cosystem/svelte";

  import { Counter, cosystem } from "./counter";

  const counter = moduleStore(Counter, cosystem);
  const count = selectedModuleStore(Counter, (module) => module.count, { app: cosystem });
  const double = selectedModuleStore(Counter, (module) => module.double, { app: cosystem });
</script>

<main class="shell">
  <section class="panel">
    <span class="eyebrow">Svelte + CoSystem</span>
    <h1>Counter module</h1>
    <dl class="stats">
      <div>
        <dt>Count</dt>
        <dd>{$count}</dd>
      </div>
      <div>
        <dt>Double</dt>
        <dd>{$double}</dd>
      </div>
    </dl>
    <div class="actions">
      <button type="button" onclick={() => $counter.increase()}>Increase</button>
      <button type="button" class="secondary" onclick={() => $counter.reset()}>Reset</button>
    </div>
  </section>
</main>

<style>
  :global(:root) {
    color: #1f2933;
    background: #f3f1ff;
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
    border: 1px solid #4338ca;
    border-radius: 8px;
    background: #4338ca;
    color: #ffffff;
    cursor: pointer;
    font: inherit;
    font-weight: 700;
    padding: 0.75rem 1rem;
  }

  button.secondary {
    background: #ffffff;
    color: #4338ca;
  }

  .shell {
    display: grid;
    min-height: 100vh;
    place-items: center;
    padding: 2rem;
  }

  .panel {
    width: min(100%, 28rem);
    border: 1px solid #d7d3ff;
    border-radius: 8px;
    background: #ffffff;
    padding: 2rem;
    box-shadow: 0 20px 50px rgb(67 56 202 / 12%);
  }

  .eyebrow {
    color: #4338ca;
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
    border: 1px solid #e4e1ff;
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
