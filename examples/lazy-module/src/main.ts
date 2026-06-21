import { createApp, lazyModule } from "@cosystem/core";

// oxlint-disable-next-line import/no-unassigned-import -- Vite loads example styles through CSS side effects.
import "./styles.css";

interface AdminCounterShape {
  readonly count: number;
  readonly double: number;
  increase(step?: number): void;
  reset(): void;
}

const app = createApp({
  providers: [
    lazyModule(async () => {
      const module = await import("./admin");

      return {
        providers: [module.AdminCounter],
      };
    }),
  ],
});

const root = document.getElementById("app");
let admin: AdminCounterShape | undefined;
let loading = false;
let loaded = false;
let unsubscribe: (() => void) | undefined;

if (root === null) {
  throw new Error("Missing #app.");
}

render();

root.addEventListener("click", (event) => {
  const target = event.target;

  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  if (target.dataset.action === "load") {
    void loadAdminCounter();
  }

  if (target.dataset.action === "increase") {
    admin?.increase();
  }

  if (target.dataset.action === "reset") {
    admin?.reset();
  }
});

async function loadAdminCounter(): Promise<void> {
  if (loading || loaded) {
    return;
  }

  loading = true;
  render();

  await app.load();

  admin = app.getModuleByName<AdminCounterShape>("adminCounter");
  loaded = true;
  loading = false;
  unsubscribe = app.watch(
    () => ({
      count: admin?.count ?? 0,
      double: admin?.double ?? 0,
    }),
    render,
    { immediate: true },
  );
}

function render(): void {
  const count = admin?.count ?? 0;
  const double = admin?.double ?? 0;

  root!.innerHTML = `
    <section class="panel">
      <span class="eyebrow">Lazy module</span>
      <h1>Admin counter</h1>
      <p>${loaded ? "The admin module has been loaded into the app." : "The admin module is still outside the app graph."}</p>
      <dl class="stats">
        <div><dt>Count</dt><dd>${count}</dd></div>
        <div><dt>Double</dt><dd>${double}</dd></div>
      </dl>
      <div class="actions">
        <button type="button" data-action="load" ${loaded || loading ? "disabled" : ""}>
          ${loading ? "Loading" : loaded ? "Loaded" : "Load module"}
        </button>
        <button type="button" data-action="increase" ${loaded ? "" : "disabled"}>Increase</button>
        <button type="button" class="secondary" data-action="reset" ${loaded ? "" : "disabled"}>Reset</button>
      </div>
    </section>
  `;
}

window.addEventListener("beforeunload", () => {
  unsubscribe?.();
});
