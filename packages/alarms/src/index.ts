import { requireOptionalNativeModule } from "expo";
interface AlarmModule {
  capability(): Promise<{
    available: boolean;
    authorized: boolean;
    reason: string;
  }>;
  requestPermission(): Promise<boolean>;
  schedule(id: string, title: string, epochSeconds: number): Promise<boolean>;
  cancel(id: string): Promise<void>;
}
const native = requireOptionalNativeModule<AlarmModule>("AlignedAlarms");
export const prominentAlarms = {
  capability: () =>
    native?.capability() ??
    Promise.resolve({
      available: false,
      authorized: false,
      reason:
        "Prominent alarms need an installed development build on a supported device.",
    }),
  requestPermission: () =>
    native?.requestPermission() ?? Promise.resolve(false),
  schedule: (id: string, title: string, epochSeconds: number) =>
    native?.schedule(id, title, epochSeconds) ?? Promise.resolve(false),
  cancel: (id: string) => native?.cancel(id) ?? Promise.resolve(),
};
