import type { ConfigContext } from "expo/config";
import dotenv from "dotenv";
import { resolve } from "node:path";
export default ({ config }: ConfigContext) => {
  dotenv.config({ path: resolve(__dirname, "../../.env"), quiet: true });
  return {
    ...config,
    android: {
      ...config.android,
      ...(process.env.GOOGLE_SERVICES_JSON
        ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON }
        : {}),
    },
    extra: {
      ...config.extra,
      ...(process.env.EXPO_PUBLIC_EAS_PROJECT_ID
        ? { eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID } }
        : {}),
    },
  };
};
