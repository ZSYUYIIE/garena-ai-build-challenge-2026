import type { ManifestV3Export } from "@crxjs/vite-plugin";

type StaticManifest = Exclude<Awaited<ManifestV3Export>, Function>;

type PackageMetadata = {
  name: string;
  version: string;
};

type ExtensionManifestOptions = {
  development?: boolean;
};

const backendHostPermissions = [
  "http://127.0.0.1:8000/*",
  "http://localhost:8000/*",
];

const devServerHostPermissions = [
  "http://127.0.0.1:5173/*",
  "http://localhost:5173/*",
];

const backendConnectSources = [
  "ws://127.0.0.1:8000",
  "ws://localhost:8000",
];

const devServerScriptSources = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
];

const devServerConnectSources = [
  ...devServerScriptSources,
  "ws://127.0.0.1:5173",
  "ws://localhost:5173",
];

export function createExtensionManifest(
  pkg: PackageMetadata,
  { development = false }: ExtensionManifestOptions = {},
): StaticManifest {
  const scriptSources = development
    ? ["'self'", ...devServerScriptSources]
    : ["'self'"];
  const connectSources = development
    ? [...backendConnectSources, ...devServerConnectSources]
    : backendConnectSources;

  return {
    manifest_version: 3,
    name: "StreamSense",
    short_name: "StreamSense",
    description: "Live screen narration and conversational assistance for blind and low-vision viewers.",
    version: pkg.version,
    icons: {
      16: "public/assets/streamsense.png",
      32: "public/assets/streamsense.png",
      48: "public/assets/streamsense.png",
      128: "public/assets/streamsense.png",
    },
    action: {
      default_icon: {
        16: "public/assets/streamsense.png",
        32: "public/assets/streamsense.png",
        48: "public/assets/streamsense.png",
        128: "public/assets/streamsense.png",
      },
    },
    background: {
      service_worker: "src/services/background.ts",
    },
    side_panel: {
      default_path: "src/sidepanel/index.html",
    },
    permissions: ["activeTab", "sidePanel", "storage", "tabCapture", "tts"],
    host_permissions: development
      ? [...backendHostPermissions, ...devServerHostPermissions]
      : backendHostPermissions,
    content_security_policy: {
      extension_pages:
        `script-src ${scriptSources.join(" ")}; object-src 'self'; connect-src ${connectSources.join(" ")};`,
    },
  };
}
