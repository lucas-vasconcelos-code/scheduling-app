import { describe, it, expect, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  reconcile: vi.fn(),
  cancel: vi.fn(),
  register: vi.fn(),
}));
vi.mock("react-native", () => ({ AppState: {}, Platform: { OS: "web" } }));
vi.mock("@react-native-community/netinfo", () => ({ default: {} }));
vi.mock("../apps/client/src/api", () => ({
  api: mocks.api,
  API: "",
  authHeaders: vi.fn(),
}));
vi.mock("../apps/client/src/stream", () => ({ streamFetch: vi.fn() }));
vi.mock("../apps/client/src/alerts", () => ({
  reconcileAlerts: mocks.reconcile,
  cancelAllAlerts: mocks.cancel,
  registerDevice: mocks.register,
}));
import { refreshAndReconcile } from "../apps/client/src/sync";
beforeEach(() => {
  vi.resetAllMocks();
});
describe("activation and device alert refresh", () => {
  it("uses fresh alert times after a remote move and cancels disabled reminders", async () => {
    const fresh = {
      settings: { notificationsEnabled: true, prominentAlarmsEnabled: false },
      alerts: [{ id: "meeting", at: "2026-09-14T16:45:00Z", prominent: true }],
    };
    mocks.api.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce(fresh);
    await refreshAndReconcile(true);
    expect(mocks.api.mock.calls.map((c) => c[0])).toEqual([
      "/api/v1/sync",
      "/api/v1/state",
    ]);
    expect(mocks.reconcile).toHaveBeenCalledWith([
      { ...fresh.alerts[0], prominent: false },
    ]);
    mocks.api.mockResolvedValueOnce({
      ...fresh,
      settings: { ...fresh.settings, notificationsEnabled: false },
    });
    await refreshAndReconcile();
    expect(mocks.cancel).toHaveBeenCalledOnce();
  });
  it("reconciles the persisted snapshot when Google refresh fails and reports the failure", async () => {
    mocks.api
      .mockRejectedValueOnce(new Error("Reconnect Google"))
      .mockResolvedValueOnce({
        settings: { notificationsEnabled: true, prominentAlarmsEnabled: true },
        alerts: [],
      });
    await expect(refreshAndReconcile(true)).rejects.toThrow("Reconnect Google");
    expect(mocks.reconcile).toHaveBeenCalledWith([]);
  });
  it("does not invent remote success or replace alerts when the backend is offline", async () => {
    mocks.api.mockRejectedValue(new Error("Offline"));
    await expect(refreshAndReconcile(true)).rejects.toThrow("Offline");
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
});
