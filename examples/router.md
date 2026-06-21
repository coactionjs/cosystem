# Router

`@cosystem/router` keeps routing embeddable. It does not provide file-based
routes; it gives the app a router token and a lifecycle bridge.

```ts
import { createApp } from "@cosystem/core";
import {
  RouterToken,
  createBrowserRouter,
  createMemoryRouter,
  createRouterPlugin,
  provideRouter,
} from "@cosystem/router";

const router =
  typeof window === "undefined" ? createMemoryRouter({ initialPath: "/" }) : createBrowserRouter();

const app = createApp({
  plugins: [
    createRouterPlugin(router, {
      immediate: true,
      onChange(location) {
        console.log(location.path);
      },
    }),
  ],
  providers: [provideRouter(router)],
});

await app.start();

app.get(RouterToken).navigate("/settings?tab=profile");
```
