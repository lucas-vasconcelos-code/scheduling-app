import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { UserState, Alignment, AlertPlan } from "@aligned/shared";
export const API =
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === "web" && !__DEV__ ? "" : "http://localhost:3000");
let csrf = "",
  nativeToken = "";
export async function saveSession(session: { token?: string; csrf: string }) {
  csrf = session.csrf;
  if (Platform.OS !== "web" && session.token) {
    nativeToken = session.token;
    await SecureStore.setItemAsync("aligned-session", session.token);
  }
}
export async function clearSession() {
  csrf = "";
  nativeToken = "";
  await AsyncStorage.removeItem("aligned-last-session");
  const keys = await AsyncStorage.getAllKeys();
  await AsyncStorage.multiRemove(
    keys.filter((k) => k.startsWith("aligned-cache:")),
  );
  if (Platform.OS !== "web")
    await SecureStore.deleteItemAsync("aligned-session");
}
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function authHeaders(): Promise<Record<string, string>> {
  if (Platform.OS !== "web" && !nativeToken)
    nativeToken = (await SecureStore.getItemAsync("aligned-session")) ?? "";
  return {
    ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    ...(nativeToken ? { Authorization: `Bearer ${nativeToken}` } : {}),
  };
}
export async function loadSession() {
  try {
    const s = await api("/api/v1/session");
    await saveSession(s);
    await AsyncStorage.setItem(
      "aligned-last-session",
      JSON.stringify({ userId: s.userId, name: s.name, demo: s.demo }),
    );
    return s;
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 0) throw e;
    const cached = await AsyncStorage.getItem("aligned-last-session");
    if (cached) return { ...JSON.parse(cached), stale: true };
    throw e;
  }
}
export async function cachedState(userId: string): Promise<AppState> {
  try {
    const s = await api<AppState>("/api/v1/state");
    await AsyncStorage.setItem("aligned-cache:" + userId, JSON.stringify(s));
    return s;
  } catch (e) {
    if (e instanceof ApiError && e.status !== 0) throw e;
    const cached = await AsyncStorage.getItem("aligned-cache:" + userId);
    if (cached) return { ...JSON.parse(cached), stale: true };
    throw e;
  }
}
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  if (Platform.OS !== "web" && !nativeToken)
    nativeToken = (await SecureStore.getItemAsync("aligned-session")) ?? "";
  const response = await fetch(API + path, {
    method,
    credentials: "include",
    headers: {
      ...(body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...(await authHeaders()),
    },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  }).catch(() => {
    throw new ApiError(
      0,
      "Cannot reach Aligned. Showing saved data; changes are not queued. Reconnect and try again.",
    );
  });
  const value = await response.json();
  if (!response.ok)
    throw new ApiError(
      response.status,
      value.error ?? "Something went wrong. Please try again.",
    );
  return value;
}
export interface AppState extends UserState {
  connected?: boolean;
  stale?: boolean;
  demo: boolean;
  alerts: AlertPlan[];
  alignment: {
    today: Alignment;
    week: Alignment;
    days: (Alignment & { date: string })[];
  };
}
