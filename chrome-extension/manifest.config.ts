import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

import { createExtensionManifest } from "./extensionManifest.js";

export default defineManifest((environment) =>
  createExtensionManifest(pkg, {
    development: environment.command === "serve",
  }),
);
