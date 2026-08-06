import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

import { createExtensionManifest } from "./extensionManifest.js";

export default defineManifest(createExtensionManifest(pkg));
