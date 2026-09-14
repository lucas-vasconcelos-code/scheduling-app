import { useEffect, useState } from "react";
import { AppState, Platform } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import {
  focusManager,
  onlineManager,
  useQueryClient,
} from "@tanstack/react-query";
import { api, API, authHeaders, type AppState as CalendarState } from "./api";
import { streamFetch } from "./stream";
import { reconcileAlerts, cancelAllAlerts, registerDevice } from "./alerts";

export async function refreshAndReconcile(syncGoogle = false) {
  let failure: unknown;
  if (syncGoogle)
    try {
      await api("/api/v1/sync", "POST");
    } catch (e) {
      failure = e;
    }
  const s = await api<CalendarState>("/api/v1/state");
  if (s.settings.notificationsEnabled)
    await reconcileAlerts(
      s.alerts.map((p) => ({
        ...p,
        prominent: p.prominent && s.settings.prominentAlarmsEnabled,
      })),
    );
  else {
    await cancelAllAlerts();
    await registerDevice();
  }
  if (failure) throw failure;
  return s;
}

export function useLiveSync(userId?: string) {
  const query = useQueryClient();
  const [online, setOnline] = useState(true),
    [live, setLive] = useState(false);
  useEffect(() => {
    let previous = true;
    const update = (next: boolean) => {
      setOnline(next);
      onlineManager.setOnline(next);
      if (next && !previous)
        void query.invalidateQueries({ queryKey: ["session"] });
      previous = next;
    };
    if (Platform.OS === "web") {
      const updateBrowser = () => update(navigator.onLine);
      window.addEventListener("online", updateBrowser);
      window.addEventListener("offline", updateBrowser);
      updateBrowser();
      return () => {
        window.removeEventListener("online", updateBrowser);
        window.removeEventListener("offline", updateBrowser);
      };
    }
    return NetInfo.addEventListener((state) =>
      update(state.isConnected !== false),
    );
  }, [query]);
  useEffect(() => {
    if (!userId || !online) {
      setLive(false);
      return;
    }
    let active = AppState.currentState !== "background",
      disposed = false,
      pending = false;
    let controller: AbortController | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let delay = 2000,
      generation = 0;
    const refresh = async (google = false) => {
      if (disposed || pending || !active) return;
      pending = true;
      try {
        const s = await refreshAndReconcile(google);
        if (!disposed) query.setQueryData(["state", userId], s);
      } catch {
        if (!disposed) void query.invalidateQueries({ queryKey: ["state"] });
      } finally {
        pending = false;
      }
    };
    const connect = async () => {
      if (disposed || !active) return;
      const current = ++generation;
      clearTimeout(retry);
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await streamFetch(API + "/api/v1/changes", {
          headers: await authHeaders(),
          credentials: "include",
          signal: controller.signal,
        });
        if (!response.ok || !response.body)
          throw new Error("Live updates unavailable");
        if (disposed || current !== generation) return;
        setLive(true);
        delay = 2000;
        const reader = response.body.getReader(),
          decoder = new TextDecoder();
        let buffer = "";
        while (!disposed && active && current === generation) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let end;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const message = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            if (message.includes("event: change")) {
              clearTimeout(debounce);
              debounce = setTimeout(() => void refresh(), 250);
            }
          }
        }
      } catch {
        /* Authenticated polling remains available when streaming is blocked. */
      } finally {
        if (!disposed && current === generation) setLive(false);
        if (!disposed && active && current === generation) {
          retry = setTimeout(() => void connect(), delay);
          delay = Math.min(60000, delay * 2);
        }
      }
    };
    const activate = (next: boolean) => {
      active = next;
      focusManager.setFocused(next);
      clearTimeout(retry);
      if (next) {
        void refresh(true);
        void connect();
      } else {
        generation++;
        controller?.abort();
        setLive(false);
      }
    };
    const subscription = AppState.addEventListener("change", (state) =>
      activate(state === "active"),
    );
    const visibility = () => activate(document.visibilityState === "visible");
    if (Platform.OS === "web")
      document.addEventListener("visibilitychange", visibility);
    void refresh(true);
    void connect();
    return () => {
      disposed = true;
      controller?.abort();
      clearTimeout(retry);
      clearTimeout(debounce);
      subscription.remove();
      if (Platform.OS === "web")
        document.removeEventListener("visibilitychange", visibility);
    };
  }, [userId, online, query]);
  return { online, live };
}
