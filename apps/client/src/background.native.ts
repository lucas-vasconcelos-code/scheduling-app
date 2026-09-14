import * as TaskManager from "expo-task-manager";
import { api, type AppState } from "./api";
import { reconcileAlerts, cancelAllAlerts } from "./alerts";
export const BACKGROUND_CHANGE_TASK = "aligned-background-change";
TaskManager.defineTask(BACKGROUND_CHANGE_TASK, async ({ error }) => {
  if (error) return;
  try {
    const s = await api<AppState>("/api/v1/state");
    if (!s.settings.notificationsEnabled) await cancelAllAlerts();
    else
      await reconcileAlerts(
        s.alerts.map((p) => ({
          ...p,
          prominent: p.prominent && s.settings.prominentAlarmsEnabled,
        })),
      );
  } catch {
    /* The OS may deny background networking; activation repairs alerts. */
  }
});
