import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: pkg.name,
  version: pkg.version,
  icons: {
    48: "public/logo.png",
  },
  action: {
    default_icon: {
      48: "public/logo.png",
    },
  },
  background: {
    service_worker: "src/services/background.ts",
  },
  content_scripts: [
    {
      js: ["src/content/main.ts"],
      matches: ["https://*/*"],
    },
  ],
  side_panel: {
    default_path: "src/sidepanel/index.html",
  },
  permissions: ["activeTab", "contentSettings", "sidePanel", "tabCapture"],
  host_permissions: [
    "http://127.0.0.1:8000/*",
    "http://localhost:8000/*",
  ],
  content_security_policy: {
    extension_pages:
      "script-src 'self'; object-src 'self'; connect-src ws://127.0.0.1:8000 ws://localhost:8000;",
  },
});

