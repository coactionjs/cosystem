import { mount } from "svelte";

import { setCoSystemApp } from "@cosystem/svelte";

import App from "./App.svelte";
import { cosystem } from "./counter";

setCoSystemApp(cosystem);

mount(App, {
  target: document.getElementById("app")!,
});
