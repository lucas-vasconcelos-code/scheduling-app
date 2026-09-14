import { api } from "./api";
import type { AlertPlan } from "@aligned/shared";
let timers: ReturnType<typeof setTimeout>[] = [];
export async function enableAlerts() {
  if (!("Notification" in window))
    return "This browser does not support notifications.";
  const p = await Notification.requestPermission();
  if (p === "granted") {
    let id = localStorage.getItem("aligned-device");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("aligned-device", id);
    }
    await api("/api/v1/devices", "POST", { id, platform: "web" });
  }
  return p === "granted"
    ? "Browser reminders enabled while Aligned is open. Google Calendar reminders work independently."
    : "Notifications were not enabled. Calendar scheduling still works.";
}
export async function reconcileAlerts(plans: AlertPlan[]) {
  await registerDevice();
  timers.forEach(clearTimeout);
  timers = [];
  if (!("Notification" in window) || Notification.permission !== "granted")
    return;
  for (const p of plans) {
    const delay = Date.parse(p.at) - Date.now();
    if (delay > 0 && delay < 2147483647)
      timers.push(
        setTimeout(
          () =>
            new Notification(p.title, {
              body: "Your meeting starts in 15 minutes",
              tag: p.id,
              silent: !p.prominent,
            }),
          delay,
        ),
      );
  }
}
export async function cancelAllAlerts() {
  timers.forEach(clearTimeout);
  timers = [];
}

export async function registerDevice() {
  let id = localStorage.getItem("aligned-device");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("aligned-device", id);
  }
  await api("/api/v1/devices", "POST", {
    id,
    platform: "web",
    capability: "Browser reminders while Aligned is open",
    registrations: [],
  });
}
