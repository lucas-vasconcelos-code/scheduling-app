import Constants from "expo-constants";
import * as TaskManager from "expo-task-manager";
import { api } from "./api";
import * as Crypto from "expo-crypto";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { prominentAlarms } from "@aligned/alarms";
import type { AlertPlan } from "@aligned/shared";
Notifications.setNotificationHandler({
  handleNotification: async (notification) => ({
    shouldShowBanner:
      notification.request.content.data?.type !== "aligned.changed",
    shouldShowList:
      notification.request.content.data?.type !== "aligned.changed",
    shouldPlaySound:
      notification.request.content.data?.type !== "aligned.changed" &&
      notification.request.content.data?.quiet !== true,
    shouldSetBadge: false,
  }),
});
const key = "aligned-alert-ids";
export async function deviceId() {
  let id = await SecureStore.getItemAsync("aligned-device");
  if (!id) {
    id = Crypto.randomUUID();
    await SecureStore.setItemAsync("aligned-device", id);
  }
  return id;
}
export async function enableAlerts() {
  const p = await Notifications.requestPermissionsAsync();
  if (!p.granted)
    return "Notifications were not enabled. Calendar scheduling still works.";
  const capability = await prominentAlarms.capability();
  const granted = capability.available
    ? await prominentAlarms.requestPermission()
    : false;
  return granted
    ? "Meeting notifications and context-aware alarms enabled."
    : "Meeting notifications enabled. " + capability.reason;
}
let pending: Promise<unknown> = Promise.resolve();
function serialize<T>(work: () => Promise<T>): Promise<T> {
  const result = pending.catch(() => {}).then(work);
  pending = result;
  return result;
}
export function cancelAllAlerts() {
  return serialize(cancelRegisteredAlerts);
}
async function cancelRegisteredAlerts() {
  const previous = JSON.parse(
    (await SecureStore.getItemAsync(key)) ?? "[]",
  ) as string[];
  for (const id of previous) {
    await prominentAlarms.cancel(id);
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  }
  await SecureStore.setItemAsync(key, "[]");
}
export function reconcileAlerts(plans: AlertPlan[]) {
  return serialize(() => reconcile(plans));
}
async function reconcile(plans: AlertPlan[]) {
  await cancelRegisteredAlerts();
  if (!(await Notifications.getPermissionsAsync()).granted) {
    await api("/api/v1/devices", "POST", {
      id: await deviceId(),
      platform: Platform.OS,
      appVersion: Constants.expoConfig?.version,
      capability: "Notification permission denied",
      registrations: [],
      pushStatus: "Permission denied",
    });
    return;
  }
  const ids: string[] = [],
    registrations: {
      id: string;
      notification: boolean;
      prominent: boolean;
      reason: string;
    }[] = [];
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("meetings-quiet", {
      name: "Quiet meeting reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: null,
    });
    await Notifications.setNotificationChannelAsync("meetings", {
      name: "Meeting reminders",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
    });
  }
  const capability = await prominentAlarms.capability();
  for (const p of plans
    .filter((p) => Date.parse(p.at) > Date.now())
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(0, 48)) {
    ids.push(p.id);
    await SecureStore.setItemAsync(key, JSON.stringify(ids));
    let prominent = false;
    if (p.prominent && capability.authorized)
      prominent = await prominentAlarms
        .schedule(p.id, p.title, Date.parse(p.at) / 1000)
        .catch(() => false);
    await Notifications.scheduleNotificationAsync({
      identifier: p.id,
      content: {
        title: p.title,
        body: "Your meeting starts in 15 minutes",
        sound: p.prominent && !prominent ? "default" : false,
        data: { quiet: !p.prominent || prominent },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(p.at),
        channelId: p.prominent && !prominent ? "meetings" : "meetings-quiet",
      },
    });
    registrations.push({
      id: p.id,
      notification: true,
      prominent,
      reason: prominent
        ? "Alarm registered"
        : p.prominent
          ? "Notification fallback"
          : p.reason,
    });
  }
  await SecureStore.setItemAsync(key, JSON.stringify(ids));
  let token: string | undefined;
  let pushStatus = "Push is not configured for this build";
  const projectId =
    Constants.easConfig?.projectId ??
    Constants.expoConfig?.extra?.eas?.projectId;
  if (projectId)
    try {
      token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      if (
        !(await TaskManager.isTaskRegisteredAsync("aligned-background-change"))
      )
        await Notifications.registerTaskAsync("aligned-background-change");
      pushStatus = "Registered; background delivery depends on the OS";
    } catch {
      pushStatus = "Push unavailable; foreground refresh remains active";
    }
  await api("/api/v1/devices", "POST", {
    token,
    pushStatus,
    appVersion: Constants.expoConfig?.version,
    capability: capability.reason,
    id: await deviceId(),
    platform: Platform.OS,
    registrations,
  });
}

export async function registerDevice() {
  const capability = await prominentAlarms.capability();
  await api("/api/v1/devices", "POST", {
    id: await deviceId(),
    platform: Platform.OS,
    appVersion: Constants.expoConfig?.version,
    capability: capability.reason,
    registrations: [],
    pushStatus: "Enable reminders to register push delivery",
  });
}
