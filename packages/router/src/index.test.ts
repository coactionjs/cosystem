import { describe, expect, it } from "vitest";

import { createApp } from "@cosystem/core";

import { RouterToken, createMemoryRouter, parseLocation, provideRouter } from "./index.js";

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
});
