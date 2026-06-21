import { describe, expect, it } from "vitest";

import { createApp } from "@cosystem/core";

import {
  RouterToken,
  createMemoryRouter,
  createRouterPlugin,
  parseLocation,
  provideRouter,
} from "./index.js";

describe("router package", () => {
  it("parses path, search, and hash segments", () => {
    expect(parseLocation("/users?id=1#profile")).toEqual({
      hash: "#profile",
      path: "/users",
      search: "?id=1",
    });
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
});
