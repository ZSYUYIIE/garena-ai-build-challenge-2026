import type { ManifestV3Export } from "@crxjs/vite-plugin";

type StaticManifest = Exclude<Awaited<ManifestV3Export>, Function>;

type PackageMetadata = {
  name: string;
  version: string;
};

export function createExtensionManifest(
  pkg: PackageMetadata,
): StaticManifest {
  return {
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
    side_panel: {
      default_path: "src/sidepanel/index.html",
    },
    permissions: ["activeTab", "sidePanel", "storage", "tabCapture"],
    host_permissions: [
      "http://127.0.0.1:8000/*",
      "http://localhost:8000/*",
    ],
    content_security_policy: {
      extension_pages:
        "script-src 'self'; object-src 'self'; connect-src ws://127.0.0.1:8000 ws://localhost:8000;",
    },
  };
}
