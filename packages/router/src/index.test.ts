import { describe, expect, it } from "vitest";

import { createApp } from "@cosystem/core";

import {
  RouterToken,
  createBrowserRouter,
  createMemoryRouter,
  createRouterPlugin,
  formatLocation,
  parseLocation,
  provideRouter,
  type BrowserWindowLike,
} from "./index.js";

describe("router package", () => {
  it("parses path, search, and hash segments", () => {
    expect(parseLocation("/users?id=1#profile")).toEqual({
      hash: "#profile",
      path: "/users",
      search: "?id=1",
    });
  });

  it("formats route locations into browser hrefs", () => {
    expect(
      formatLocation({
        hash: "#profile",
        path: "/users",
        search: "?id=1",
      }),
    ).toBe("/users?id=1#profile");
  });

  it("provides a router through the CoSystem app container", () => {
    const router = createMemoryRouter({
      initialPath: "/",
    });
    const app = createApp({
      providers: [provideRouter(router)],
    });
    const locations: string[] = [];

    app.get(RouterToken).subscribe((location) => {
      locations.push(location.path);
    });
    app.get(RouterToken).navigate("/settings");

    expect(locations).toEqual(["/settings"]);
    expect(app.get(RouterToken).current.path).toBe("/settings");
  });

  it("bridges router changes through the router plugin lifecycle", async () => {
    const router = createMemoryRouter({
      initialPath: "/",
    });
    const locations: string[] = [];
    const app = createApp({
      plugins: [
        createRouterPlugin(router, {
          immediate: true,
          onChange(location) {
            locations.push(location.path);
          },
        }),
      ],
      providers: [provideRouter(router)],
    });

    await app.start();
    router.navigate("/settings");

    expect(locations).toEqual(["/", "/settings"]);

    await app.dispose();
    router.navigate("/ignored");

    expect(locations).toEqual(["/", "/settings"]);
  });

  it("adapts browser history navigation to the router contract", () => {
    const browserWindow = createMockBrowserWindow("/initial?tab=1#top");
    const router = createBrowserRouter({
      window: browserWindow,
    });
    const locations: string[] = [];
    const unsubscribe = router.subscribe((location) => {
      locations.push(formatLocation(location));
    });

    expect(router.current).toEqual({
      hash: "#top",
      path: "/initial",
      search: "?tab=1",
    });

    router.navigate("/settings?mode=dark");

    expect(browserWindow.location).toEqual({
      hash: "",
      pathname: "/settings",
      search: "?mode=dark",
    });
    expect(locations).toEqual(["/settings?mode=dark"]);

    browserWindow.pushPopState("/back#hash");

    expect(router.current).toEqual({
      hash: "#hash",
      path: "/back",
      search: "",
    });
    expect(locations).toEqual(["/settings?mode=dark", "/back#hash"]);

    unsubscribe();
    browserWindow.pushPopState("/ignored");

    expect(locations).toEqual(["/settings?mode=dark", "/back#hash"]);
  });
});

function createMockBrowserWindow(initialPath: string): BrowserWindowLike & {
  pushPopState(path: string): void;
} {
  const listeners = new Set<() => void>();
  let location = toBrowserLocation(initialPath);

  return {
    get location() {
      return location;
    },
    history: {
      pushState(_data, _unused, url) {
        location = toBrowserLocation(String(url ?? "/"));
      },
    },
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    pushPopState(path) {
      location = toBrowserLocation(path);

      for (const listener of listeners) {
        listener();
      }
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
  };
}

function toBrowserLocation(path: string) {
  const location = parseLocation(path);

  return {
    hash: location.hash,
    pathname: location.path,
    search: location.search,
  };
}
