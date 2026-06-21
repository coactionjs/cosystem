import { createApp } from "@cosystem/core";
import {
  RouterToken,
  createBrowserRouter,
  createRouterPlugin,
  provideRouter,
  type RouteLocation,
} from "@cosystem/router";

// oxlint-disable-next-line import/no-unassigned-import -- Vite loads example styles through CSS side effects.
import "./styles.css";

const root = document.getElementById("app");

if (root === null) {
  throw new Error("Missing #app.");
}

const router = createBrowserRouter();
const app = createApp({
  plugins: [
    createRouterPlugin(router, {
      immediate: true,
      onChange(location) {
        render(location);
      },
    }),
  ],
  providers: [provideRouter(router)],
});

await app.start();
render(app.get(RouterToken).current);

root.addEventListener("click", (event) => {
  const target = event.target;

  if (!(target instanceof HTMLButtonElement)) {
    return;
  }

  const route = target.dataset.route;

  if (route !== undefined) {
    app.get(RouterToken).navigate(route);
  }
});

function render(location: RouteLocation): void {
  root!.innerHTML = `
    <section class="panel">
      <span class="eyebrow">Router plugin</span>
      <h1>Current location</h1>
      <dl class="location">
        <div><dt>Path</dt><dd>${location.path}</dd></div>
        <div><dt>Search</dt><dd>${location.search || "-"}</dd></div>
        <div><dt>Hash</dt><dd>${location.hash || "-"}</dd></div>
      </dl>
      <div class="actions">
        <button type="button" data-route="/">Home</button>
        <button type="button" data-route="/settings?tab=profile">Profile settings</button>
        <button type="button" class="secondary" data-route="/help#shortcuts">Help shortcuts</button>
      </div>
    </section>
  `;
}
