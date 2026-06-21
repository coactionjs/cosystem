import { createApp } from "vue";

import { cosystemPlugin } from "@cosystem/vue";

import App from "./App.vue";
import { cosystem } from "./counter";

createApp(App).use(cosystemPlugin(cosystem)).mount("#app");
