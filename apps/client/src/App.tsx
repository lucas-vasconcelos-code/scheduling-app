import React, { useEffect, useState } from "react";
import {
  View,
  ScrollView,
  RefreshControl,
  Pressable,
  TextInput,
  ActivityIndicator,
  Modal,
  Platform,
  useColorScheme,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import type { CalendarEvent, Proposal, Alignment } from "@aligned/shared";
import {
  api,
  cachedState,
  loadSession,
  saveSession,
  clearSession,
  type AppState,
} from "./api";
import {
  Theme,
  light,
  dark,
  useTheme,
  Label,
  Heading,
  Card,
  Button,
  Chip,
  ui,
} from "./ui";
import { useLiveSync } from "./sync";
import { login } from "./login";
import { startVoice, stopVoice, disposeVoice } from "./voice";
import { reconcileAlerts, cancelAllAlerts } from "./alerts";
import { SettingsPanel, Onboarding, EventEditor } from "./Settings";

const sections = [
  ["today", "◉", "Today"],
  ["calendar", "▦", "Calendar"],
  ["assistant", "✧", "Assistant"],
  ["insights", "◷", "Insights"],
  ["settings", "⚙", "Settings"],
];
export type Run = (work: () => Promise<unknown>) => Promise<boolean>;
export default function App() {
  const { section = "today", signin } = useLocalSearchParams<{
      section?: string;
      signin?: string;
    }>(),
    { width } = useWindowDimensions(),
    wide = width >= 1080,
    tablet = width >= 760;
  const system = useColorScheme(),
    insets = useSafeAreaInsets(),
    query = useQueryClient();
  const [error, setError] = useState(
      signin === "cancelled"
        ? "Google sign-in was cancelled. You can try again."
        : "",
    ),
    [busy, setBusy] = useState(false),
    [editor, setEditor] = useState<CalendarEvent | "new" | null>(null),
    [showOnboard, setShowOnboard] = useState(false);
  const session = useQuery({
    queryKey: ["session"],
    queryFn: loadSession,
    networkMode: "always",
  });
  const state = useQuery<AppState>({
    queryKey: ["state", session.data?.userId],
    queryFn: () => cachedState(session.data.userId),
    networkMode: "always",
    enabled: Boolean(session.data),
    refetchInterval: 60000,
  });
  const config = useQuery({
    queryKey: ["config"],
    queryFn: () => api("/api/v1/config"),
  });
  const connection = useLiveSync(session.data?.userId);
  const s = state.data,
    scheme = s?.settings.theme ?? "system",
    t =
      scheme === "dark" || (scheme === "system" && system === "dark")
        ? dark
        : light;
  const run: Run = async (work) => {
    setBusy(true);
    setError("");
    try {
      await work();
      await query.invalidateQueries({ queryKey: ["state"] });
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (s)
      void (
        s.settings.notificationsEnabled
          ? reconcileAlerts(
              s.alerts.map((p) => ({
                ...p,
                prominent: p.prominent && s.settings.prominentAlarmsEnabled,
              })),
            )
          : cancelAllAlerts()
      ).catch((e) => setError("Reminder setup: " + e.message));
  }, [
    JSON.stringify(s?.alerts),
    s?.settings.notificationsEnabled,
    s?.settings.prominentAlarmsEnabled,
  ]);
  const startDemo = () =>
    run(async () => {
      const r = await api("/api/v1/demo", "POST", {
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      await saveSession(r);
      await query.invalidateQueries({ queryKey: ["session"] });
    });
  const send = async (message: string) => {
    await api("/api/v1/messages", "POST", { message });
    router.replace("/assistant");
  };
  const date = DateTime.now().setZone(
    s?.settings.timeZone ?? "America/New_York",
  );
  return (
    <Theme.Provider value={t}>
      <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
        {session.data &&
          (!connection.online || s?.stale || session.data.stale) && (
            <Label color={t.error}>
              Offline or out of date · showing saved data. Reconnect before
              editing.
            </Label>
          )}
        {session.data && !session.data.demo && !s?.sync.at && (
          <Label>
            Loading your Google calendar. Imported activities will be ready to
            review shortly.
          </Label>
        )}
        {session.isPending ? (
          <View
            style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
          >
            <ActivityIndicator color={t.accent} />
            <Label>Finding your rhythm…</Label>
          </View>
        ) : !session.data ? (
          <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
            <View
              style={{
                maxWidth: 1220,
                width: "100%",
                alignSelf: "center",
                padding: tablet ? 54 : 24,
                gap: 70,
              }}
            >
              <View style={ui.between}>
                <Brand />
                <Label color={t.muted} size={12}>
                  A little intention. A better day.
                </Label>
              </View>
              <View
                style={{
                  flexDirection: tablet ? "row" : "column",
                  gap: 60,
                  alignItems: "center",
                  paddingVertical: 30,
                }}
              >
                <View style={{ flex: 1, gap: 25 }}>
                  <Chip
                    text="YOUR TIME, THOUGHTFULLY PLANNED"
                    color={t.accent}
                  />
                  <Label
                    size={tablet ? 62 : 43}
                    weight="500"
                    style={{
                      lineHeight: tablet ? 69 : 50,
                      letterSpacing: -2.5,
                    }}
                  >
                    Make room for{"\n"}what matters.
                  </Label>
                  <Label size={18} color={t.muted}>
                    A calmer calendar that understands your priorities, protects
                    your focus, and finds your natural rhythm.
                  </Label>
                  <View style={ui.wrap}>
                    {config.data?.demo && (
                      <Button onPress={startDemo} disabled={busy}>
                        Explore the demo →
                      </Button>
                    )}
                    <Button variant="ghost" onPress={() => void run(login)}>
                      Connect Google Calendar
                    </Button>
                  </View>
                  <Label size={12} color={t.muted}>
                    {config.data?.demo
                      ? "No account needed for the demo. Your real calendar stays separate."
                      : "Your primary Google Calendar, with room for your preferences."}
                  </Label>
                </View>
                <View
                  style={{
                    flex: 1,
                    width: "100%",
                    maxWidth: 480,
                    transform: [{ rotate: tablet ? "2deg" : "0deg" }],
                  }}
                >
                  <Card style={{ padding: 30, gap: 22 }}>
                    <View style={ui.between}>
                      <Heading small>A day that feels right</Heading>
                      <Label color={t.accent}>✧</Label>
                    </View>
                    <Label color={t.muted}>
                      A little structure. Plenty of breathing room.
                    </Label>
                    {[
                      ["09:00", "Algorithms lecture", "Classes", "#5B7CFA"],
                      [
                        "11:00",
                        "Space for your best work",
                        "Deep Work",
                        "#558A75",
                      ],
                      [
                        "16:00",
                        "Move, recharge, reset",
                        "Health & Habits",
                        "#DE9369",
                      ],
                    ].map(([time, title, category, color]) => (
                      <View
                        key={time}
                        style={[
                          ui.row,
                          {
                            paddingVertical: 12,
                            borderBottomWidth: 1,
                            borderColor: t.line,
                          },
                        ]}
                      >
                        <Label size={12} color={t.muted}>
                          {time}
                        </Label>
                        <View
                          style={{
                            width: 3,
                            height: 48,
                            borderRadius: 2,
                            backgroundColor: color,
                          }}
                        />
                        <View style={{ gap: 5 }}>
                          <Label weight="600">{title}</Label>
                          <Label size={12} color={t.muted}>
                            {category}
                          </Label>
                        </View>
                      </View>
                    ))}
                    <View
                      style={{
                        backgroundColor: t.soft,
                        padding: 16,
                        borderRadius: 14,
                        gap: 5,
                      }}
                    >
                      <Label color={t.accent} weight="600">
                        ✧ Built around you
                      </Label>
                      <Label size={13} color={t.muted}>
                        Your energy, your routines, your priorities.
                      </Label>
                    </View>
                  </Card>
                </View>
              </View>
              {Boolean(error) && (
                <ErrorBanner message={error} onClose={() => setError("")} />
              )}
            </View>
          </ScrollView>
        ) : !s ? (
          <View style={{ padding: 40, gap: 20 }}>
            <ActivityIndicator color={t.accent} />
            <Label>{state.error?.message ?? "Preparing your calendar…"}</Label>
            <Button onPress={() => void state.refetch()}>Retry</Button>
          </View>
        ) : (
          <>
            <View style={{ flex: 1, flexDirection: "row" }}>
              {tablet && (
                <View
                  style={{
                    width: wide ? 218 : 176,
                    borderRightWidth: 1,
                    borderColor: t.line,
                    padding: wide ? 24 : 16,
                    gap: 36,
                    backgroundColor: t.card,
                  }}
                >
                  <Brand />
                  <View style={{ gap: 8 }}>
                    {sections.map(([key, icon, title]) => (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={title}
                        key={key}
                        onPress={() =>
                          router.replace(
                            (key === "today" ? "/" : "/" + key) as any,
                          )
                        }
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 13,
                          backgroundColor:
                            section === key ? t.soft : "transparent",
                          borderRadius: 12,
                          padding: 13,
                        }}
                      >
                        <Label
                          size={19}
                          color={section === key ? t.accent : t.muted}
                        >
                          {icon}
                        </Label>
                        <Label
                          size={14}
                          color={section === key ? t.accent : t.muted}
                          weight={section === key ? "600" : "400"}
                        >
                          {title}
                        </Label>
                      </Pressable>
                    ))}
                  </View>
                  <View style={{ gap: 14 }}>
                    <Label style={ui.tiny} color={t.muted}>
                      YOUR CATEGORIES
                    </Label>
                    {s.categories
                      .filter((c) => c.active)
                      .map((c) => (
                        <View key={c.id} style={ui.row}>
                          <View
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: 4,
                              backgroundColor: c.color,
                            }}
                          />
                          <Label size={12} color={t.muted}>
                            {c.name}
                          </Label>
                        </View>
                      ))}
                  </View>
                  <View style={{ flex: 1 }} />
                  <View
                    style={{
                      backgroundColor: t.soft,
                      borderRadius: 14,
                      padding: 14,
                      gap: 8,
                    }}
                  >
                    <Label size={16}>✧</Label>
                    <Label size={13} weight="600">
                      A little more aligned
                    </Label>
                    <Label size={11} color={t.muted}>
                      Good plans leave room to be human.
                    </Label>
                  </View>
                  <View style={ui.row}>
                    <View
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 16,
                        backgroundColor: t.surface,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Label weight="600">{s.name[0]}</Label>
                    </View>
                    <View>
                      <Label size={13} weight="600">
                        {s.name}
                      </Label>
                      <Label size={10} color={t.muted}>
                        {s.demo ? "Demo workspace" : "Personal workspace"}
                      </Label>
                    </View>
                  </View>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <View
                  style={[
                    ui.between,
                    {
                      paddingHorizontal: tablet ? 32 : 20,
                      paddingVertical: 18,
                      borderBottomWidth: 1,
                      borderColor: t.line,
                      backgroundColor: t.card,
                    },
                  ]}
                >
                  {tablet ? (
                    <Label color={t.muted} size={13}>
                      {date.toFormat("cccc, LLLL d, yyyy")}
                    </Label>
                  ) : (
                    <Brand />
                  )}
                  <View style={ui.row}>
                    {s.demo && <Chip text="DEMO" color="#B18B4A" />}
                    <Button
                      small
                      variant="ghost"
                      onPress={() =>
                        void run(() => api("/api/v1/sync", "POST"))
                      }
                      disabled={busy}
                      accessibilityLabel="Sync calendar"
                    >
                      ↻ {tablet ? "Sync" : ""}
                    </Button>
                    <Button small onPress={() => setEditor("new")}>
                      ＋ Event
                    </Button>
                  </View>
                </View>
                {busy && (
                  <View style={{ height: 3, backgroundColor: t.accent }} />
                )}
                {Boolean(error) && (
                  <View style={{ padding: 12 }}>
                    <ErrorBanner message={error} onClose={() => setError("")} />
                  </View>
                )}
                <ScrollView
                  refreshControl={
                    Platform.OS !== "web" ? (
                      <RefreshControl
                        refreshing={busy}
                        onRefresh={() =>
                          void run(() => api("/api/v1/sync", "POST"))
                        }
                      />
                    ) : undefined
                  }
                  contentContainerStyle={{
                    padding: tablet ? 32 : 20,
                    gap: 24,
                    paddingBottom: 48,
                  }}
                  keyboardShouldPersistTaps="handled"
                >
                  <View style={ui.between}>
                    <View style={{ gap: 5 }}>
                      <Label style={ui.tiny} color={t.accent}>
                        {section === "today"
                          ? "A LITTLE INTENTION GOES A LONG WAY"
                          : "YOUR PERSONAL RHYTHM"}
                      </Label>
                      <Heading>
                        {section === "today"
                          ? `Good ${date.hour < 12 ? "morning" : date.hour < 17 ? "afternoon" : "evening"}, ${s.name}.`
                          : (sections.find((v) => v[0] === section)?.[2] ??
                            "Today")}
                      </Heading>
                      <Label color={t.muted}>
                        {section === "today"
                          ? "Let’s make space for a day that feels like you."
                          : section === "calendar"
                            ? "The shape of your week, with room to breathe."
                            : section === "assistant"
                              ? "Tell me what matters. We’ll find the time."
                              : section === "insights"
                                ? "Understand what gives your days a better rhythm."
                                : "Small preferences. A calendar that fits you."}
                      </Label>
                    </View>
                    {section === "calendar" && tablet && (
                      <Label color={t.muted} size={12}>
                        {s.settings.timeZone}
                      </Label>
                    )}
                  </View>
                  {!s.settings.onboarded && section === "today" && (
                    <View
                      style={[
                        ui.between,
                        {
                          backgroundColor: t.soft,
                          padding: 17,
                          borderRadius: 14,
                          flexWrap: "wrap",
                        },
                      ]}
                    >
                      <View>
                        <Label weight="600">Make Aligned feel like you</Label>
                        <Label size={12} color={t.muted}>
                          Set your daily rhythm and review your categories.
                        </Label>
                      </View>
                      <Button
                        small
                        variant="ghost"
                        onPress={() => setShowOnboard(true)}
                      >
                        Personalize →
                      </Button>
                    </View>
                  )}
                  {section === "today" && (
                    <Today
                      s={s}
                      wide={wide}
                      onEdit={setEditor}
                      onPlan={(id) =>
                        run(async () => {
                          await api(`/api/v1/deadlines/${id}/plan`, "POST");
                          router.replace("/assistant");
                        })
                      }
                      onSend={(message) => run(() => send(message))}
                      busy={busy}
                      onError={setError}
                    />
                  )}
                  {section === "calendar" && (
                    <View
                      style={{
                        flexDirection: "row",
                        gap: 20,
                        alignItems: "flex-start",
                      }}
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Calendar s={s} tablet={tablet} onEdit={setEditor} />
                      </View>
                      {width >= 1280 && (
                        <View style={{ width: 250, gap: 20 }}>
                          <Card>
                            <Heading small>Your week</Heading>
                            <Score value={s.alignment.week} compact />
                            <Button
                              variant="ghost"
                              onPress={() => router.replace("/insights")}
                            >
                              Explore alignment →
                            </Button>
                          </Card>
                          <Composer
                            onSend={(message) => run(() => send(message))}
                            busy={busy}
                            onError={setError}
                          />
                        </View>
                      )}
                    </View>
                  )}
                  {section === "assistant" && (
                    <Assistant
                      s={s}
                      run={run}
                      onEdit={setEditor}
                      onSend={(message) => run(() => send(message))}
                      busy={busy}
                      onError={setError}
                    />
                  )}
                  {section === "insights" && <Insights s={s} />}
                  {section === "settings" && (
                    <SettingsPanel
                      connection={connection}
                      s={s}
                      run={run}
                      onLogout={() =>
                        void run(async () => {
                          await api("/api/v1/logout", "POST");
                          await query.cancelQueries();
                          query.setQueryData(["session"], null);
                          await cancelAllAlerts();
                          await clearSession();
                          query.removeQueries({ queryKey: ["state"] });
                          await query.invalidateQueries({
                            queryKey: ["session"],
                          });
                        })
                      }
                    />
                  )}
                </ScrollView>
              </View>
            </View>
            {!tablet && (
              <View
                style={{
                  flexDirection: "row",
                  paddingBottom: Math.max(10, insets.bottom),
                  paddingTop: 10,
                  borderTopWidth: 1,
                  borderColor: t.line,
                  backgroundColor: t.card,
                }}
              >
                {sections.map(([key, icon, title]) => (
                  <Pressable
                    key={key}
                    accessibilityRole="button"
                    accessibilityLabel={title}
                    onPress={() =>
                      router.replace((key === "today" ? "/" : "/" + key) as any)
                    }
                    style={{
                      flex: 1,
                      alignItems: "center",
                      gap: 3,
                      minHeight: 46,
                    }}
                  >
                    <Label
                      size={21}
                      color={section === key ? t.accent : t.muted}
                    >
                      {icon}
                    </Label>
                    <Label
                      size={10}
                      color={section === key ? t.accent : t.muted}
                    >
                      {title}
                    </Label>
                  </Pressable>
                ))}
              </View>
            )}
            <Modal
              transparent
              animationType="fade"
              visible={editor !== null}
              onRequestClose={() => setEditor(null)}
            >
              <View
                style={{
                  flex: 1,
                  backgroundColor: "#00000066",
                  justifyContent: "center",
                  alignItems: "center",
                  padding: 20,
                }}
              >
                <ScrollView
                  style={{ maxHeight: "90%", width: "100%", maxWidth: 560 }}
                >
                  <Card>
                    {Boolean(error) && (
                      <ErrorBanner
                        message={error}
                        onClose={() => setError("")}
                      />
                    )}
                    {editor && (
                      <EventEditor
                        s={s}
                        event={editor === "new" ? undefined : editor}
                        run={run}
                        onClose={() => setEditor(null)}
                        onProposal={() => {
                          setEditor(null);
                          router.replace("/assistant");
                        }}
                      />
                    )}
                  </Card>
                </ScrollView>
              </View>
            </Modal>
            <Modal
              transparent
              animationType="fade"
              visible={showOnboard}
              onRequestClose={() => setShowOnboard(false)}
            >
              <View
                style={{
                  flex: 1,
                  backgroundColor: "#00000066",
                  justifyContent: "center",
                  alignItems: "center",
                  padding: 20,
                }}
              >
                <ScrollView
                  style={{ maxHeight: "92%", width: "100%", maxWidth: 700 }}
                >
                  <Card>
                    {Boolean(error) && (
                      <ErrorBanner
                        message={error}
                        onClose={() => setError("")}
                      />
                    )}
                    <Onboarding
                      s={s}
                      run={run}
                      close={() => setShowOnboard(false)}
                    />
                  </Card>
                </ScrollView>
              </View>
            </Modal>
          </>
        )}
      </View>
    </Theme.Provider>
  );
}
function Brand() {
  const t = useTheme();
  return (
    <View style={[ui.row, { gap: 9 }]}>
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 10,
          backgroundColor: t.accent,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Label color={t === dark ? "#172A1F" : "white"} size={22}>
          a
        </Label>
      </View>
      <Label weight="600" size={22} style={{ letterSpacing: -0.8 }}>
        aligned
      </Label>
    </View>
  );
}
function ErrorBanner({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  const t = useTheme();
  return (
    <View
      accessibilityRole="alert"
      style={[
        ui.between,
        {
          backgroundColor: t.card,
          borderWidth: 1,
          borderColor: t.error,
          borderRadius: 12,
          padding: 14,
        },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Label color={t.error} size={13}>
          {message}
        </Label>
      </View>
      <Button
        small
        variant="ghost"
        onPress={onClose}
        accessibilityLabel="Dismiss error"
      >
        ×
      </Button>
    </View>
  );
}
export function EventRow({
  event: e,
  s,
  onPress,
}: {
  event: CalendarEvent;
  s: AppState;
  onPress: () => void;
}) {
  const t = useTheme(),
    c = s.categories.find((c) => c.id === e.categoryId),
    start = DateTime.fromISO(e.start).setZone(s.settings.timeZone),
    end = DateTime.fromISO(e.end).setZone(s.settings.timeZone);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${e.title}, ${start.toFormat("h:mm a")}, ${c?.name}`}
      onPress={onPress}
      style={{
        flexDirection: "row",
        gap: 16,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderColor: t.line,
      }}
    >
      <View style={{ width: 64, gap: 4 }}>
        <Label size={13} weight="500">
          {e.allDay ? "All day" : start.toFormat("h:mm")}
        </Label>
        <Label size={10} color={t.muted}>
          {e.allDay ? "" : start.toFormat("a")}
        </Label>
      </View>
      <View
        style={{
          width: 3,
          borderRadius: 3,
          backgroundColor: c?.color ?? t.accent,
        }}
      />
      <View style={{ flex: 1, gap: 6 }}>
        <Label weight="600">{e.title}</Label>
        <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
          <Label size={11} color={t.muted}>
            {c?.name ?? "Uncategorized"}
          </Label>
          <Label size={11} color={t.muted}>
            · {Math.round(end.diff(start, "minutes").minutes)} min
          </Label>
          {e.flexibility !== "flexible" && (
            <Label size={10} color={t.muted}>
              · {e.flexibility === "fixed" ? "Fixed" : "Protected"}
            </Label>
          )}
        </View>
      </View>
      <Label color={t.muted}>›</Label>
    </Pressable>
  );
}
function Score({
  value,
  compact = false,
}: {
  value: Alignment;
  compact?: boolean;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 12, alignItems: compact ? "flex-start" : "center" }}>
      <View
        style={{
          width: compact ? 86 : 140,
          height: compact ? 86 : 140,
          borderRadius: 100,
          borderWidth: compact ? 5 : 8,
          borderColor: t.soft,
          borderTopColor: t.accent,
          borderRightColor: t.accent,
          borderBottomColor:
            value.score && value.score >= 75 ? t.accent : t.soft,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Label
          size={compact ? 28 : 46}
          weight="500"
          style={{ letterSpacing: -1.5 }}
        >
          {value.score ?? "—"}
        </Label>
        {!compact && (
          <Label size={10} color={t.muted}>
            OUT OF 100
          </Label>
        )}
      </View>
      <Label size={compact ? 12 : 15} weight="500" color={t.accent}>
        {value.label}
      </Label>
    </View>
  );
}
function Today({
  s,
  wide,
  onEdit,
  onSend,
  onPlan,
  busy,
  onError,
}: {
  onPlan: (id: string) => Promise<boolean>;
  s: AppState;
  wide: boolean;
  onEdit: (e: CalendarEvent) => void;
  onSend: (v: string) => Promise<boolean>;
  busy: boolean;
  onError: (m: string) => void;
}) {
  const t = useTheme(),
    now = DateTime.now().setZone(s.settings.timeZone),
    events = s.events
      .filter((e) =>
        DateTime.fromISO(e.start)
          .setZone(s.settings.timeZone)
          .hasSame(now, "day"),
      )
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start)),
    next = events.find((e) => Date.parse(e.end) > Date.now()),
    deadline = [...s.deadlines]
      .filter((d) => Date.parse(d.due) > Date.now())
      .sort((a, b) => Date.parse(a.due) - Date.parse(b.due))[0];
  return (
    <View style={{ flexDirection: wide ? "row" : "column", gap: 24 }}>
      <View style={{ flex: 1, gap: 24 }}>
        <Card
          style={{ backgroundColor: t.soft, borderColor: t.soft, padding: 26 }}
        >
          <View style={ui.between}>
            <Chip text="UP NEXT" color={t.accent} />
            <Label color={t.muted} size={12}>
              {next
                ? DateTime.fromISO(next.start)
                    .setZone(s.settings.timeZone)
                    .toFormat("h:mm a")
                : "A little breathing room"}
            </Label>
          </View>
          <Heading small>
            {next?.title ?? "The rest of today is yours."}
          </Heading>
          <Label size={13} color={t.muted}>
            {next
              ? `${s.categories.find((c) => c.id === next.categoryId)?.name} · ${Math.round((Date.parse(next.end) - Date.parse(next.start)) / 60000)} minutes`
              : "Make space for something meaningful, or enjoy the open time."}
          </Label>
          {next && (
            <View style={{ alignSelf: "flex-start" }}>
              <Button small variant="ghost" onPress={() => onEdit(next)}>
                View event ↗
              </Button>
            </View>
          )}
        </Card>
        <Card>
          <View style={ui.between}>
            <Heading small>Your day, at a glance</Heading>
            <Label size={12} color={t.muted}>
              {events.length} events
            </Label>
          </View>
          {events.length ? (
            events.map((e) => (
              <EventRow key={e.id} event={e} s={s} onPress={() => onEdit(e)} />
            ))
          ) : (
            <Label color={t.muted}>
              A clear page. What would you like to make time for?
            </Label>
          )}
        </Card>
        <Composer onSend={onSend} busy={busy} onError={onError} />
      </View>
      <View style={{ width: wide ? 285 : "100%", gap: 24 }}>
        <Card>
          <View style={ui.between}>
            <Label weight="600">Today’s alignment</Label>
            <Label color={t.muted}>◷</Label>
          </View>
          <Score value={s.alignment.today} />
          <Label size={12} color={t.muted} style={{ textAlign: "center" }}>
            {s.alignment.today.contributions.find((c) => c.value > 0)?.label ??
              "Your score grows from your preferences and your schedule."}
          </Label>
          <Button
            variant="ghost"
            small
            onPress={() => router.replace("/insights")}
          >
            Why this score? ↗
          </Button>
        </Card>
        {deadline && (
          <Card>
            <Label style={ui.tiny} color={t.muted}>
              ON THE HORIZON
            </Label>
            <Label size={18} weight="600">
              {deadline.title}
            </Label>
            <Label size={12} color={t.muted}>
              Due{" "}
              {DateTime.fromISO(deadline.due)
                .setZone(s.settings.timeZone)
                .toFormat("ccc, MMM d · h:mm a")}
            </Label>
            <View
              style={{ height: 5, borderRadius: 5, backgroundColor: t.line }}
            >
              <View
                style={{
                  height: 5,
                  borderRadius: 5,
                  backgroundColor: t.accent,
                  width: `${Math.min(100, (deadline.completedMinutes / Math.max(1, deadline.estimatedMinutes)) * 100)}%`,
                }}
              />
            </View>
            <Label size={12} color={t.muted}>
              {Math.max(
                0,
                deadline.estimatedMinutes - deadline.completedMinutes,
              )}{" "}
              minutes of work remaining
            </Label>
            <Button
              small
              variant="secondary"
              onPress={() => void onPlan(deadline.id)}
            >
              Plan study time →
            </Button>
          </Card>
        )}
        <Card style={{ backgroundColor: t.surface }}>
          <Label size={19}>✧</Label>
          <Label weight="600">Room for your routine</Label>
          <Label size={13} color={t.muted}>
            Your calendar suggests a regular afternoon workout. Aligned
            considers that rhythm when finding your next session.
          </Label>
        </Card>
      </View>
    </View>
  );
}
function Calendar({
  s,
  tablet,
  onEdit,
}: {
  s: AppState;
  tablet: boolean;
  onEdit: (e: CalendarEvent) => void;
}) {
  const t = useTheme(),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState(
      DateTime.now().setZone(s.settings.timeZone).weekday - 1,
    ),
    start = DateTime.now()
      .setZone(s.settings.timeZone)
      .startOf("week")
      .plus({ weeks: offset }),
    days = Array.from({ length: 7 }, (_, i) => start.plus({ days: i }));
  const dayEvents = (d: DateTime) =>
    s.events
      .filter(
        (e) =>
          DateTime.fromISO(e.start)
            .setZone(s.settings.timeZone)
            .startOf("day") <= d &&
          DateTime.fromISO(e.end).setZone(s.settings.timeZone) > d,
      )
      .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return (
    <Card style={{ padding: tablet ? 20 : 14 }}>
      <View style={ui.between}>
        <Heading small>{start.toFormat("MMMM yyyy")}</Heading>
        <View style={ui.row}>
          <Button
            small
            variant="ghost"
            onPress={() => setOffset((v) => v - 1)}
            accessibilityLabel="Previous week"
          >
            ‹
          </Button>
          <Button small variant="ghost" onPress={() => setOffset(0)}>
            Today
          </Button>
          <Button
            small
            variant="ghost"
            onPress={() => setOffset((v) => v + 1)}
            accessibilityLabel="Next week"
          >
            ›
          </Button>
        </View>
      </View>
      <View
        style={{ flexDirection: "row", gap: 4, paddingLeft: tablet ? 48 : 0 }}
      >
        {days.map((d, i) => (
          <Pressable
            key={i}
            onPress={() => setSelected(i)}
            accessibilityRole="button"
            accessibilityLabel={d.toFormat("cccc MMMM d")}
            style={{
              flex: 1,
              alignItems: "center",
              padding: 8,
              borderRadius: 12,
              backgroundColor:
                (!tablet && selected === i) ||
                d.hasSame(DateTime.now().setZone(s.settings.timeZone), "day")
                  ? t.soft
                  : "transparent",
            }}
          >
            <Label size={11} color={t.muted}>
              {d.toFormat("ccc")}
            </Label>
            <Label size={tablet ? 23 : 17} weight="500">
              {d.day}
            </Label>
          </Pressable>
        ))}
      </View>
      {tablet ? (
        <ScrollView style={{ maxHeight: 650 }}>
          <View style={{ flexDirection: "row" }}>
            <View style={{ width: 48 }}>
              {Array.from({ length: 17 }, (_, i) => (
                <View key={i} style={{ height: 64 }}>
                  <Label size={10} color={t.muted}>
                    {String(i + 7).padStart(2, "0")}:00
                  </Label>
                </View>
              ))}
            </View>
            {days.map((d) => (
              <View
                key={d.toISODate()}
                style={{
                  flex: 1,
                  height: 17 * 64,
                  borderLeftWidth: 1,
                  borderColor: t.line,
                }}
              >
                {Array.from({ length: 17 }, (_, i) => (
                  <View
                    key={i}
                    style={{
                      position: "absolute",
                      top: i * 64,
                      left: 0,
                      right: 0,
                      borderTopWidth: 1,
                      borderColor: t.line,
                    }}
                  />
                ))}
                {dayEvents(d).map((e) => {
                  const a = DateTime.fromISO(e.start).setZone(
                      s.settings.timeZone,
                    ),
                    b = DateTime.fromISO(e.end).setZone(s.settings.timeZone),
                    c = s.categories.find((c) => c.id === e.categoryId),
                    top = e.allDay
                      ? 0
                      : Math.max(0, (((a.hour - 7) * 60 + a.minute) / 60) * 64),
                    height = e.allDay
                      ? 28
                      : Math.max(
                          29,
                          Math.min(
                            17 * 64 - top,
                            (b.diff(a, "minutes").minutes / 60) * 64 - 3,
                          ),
                        );
                  return (
                    <Pressable
                      key={e.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${e.title}, ${a.toFormat("ccc h:mm a")}`}
                      onPress={() => onEdit(e)}
                      style={{
                        position: "absolute",
                        top,
                        left: 3,
                        right: 3,
                        height,
                        borderRadius: 7,
                        borderLeftWidth: 3,
                        borderColor: c?.color,
                        backgroundColor:
                          t === dark ? t.soft : (c?.color ?? "#558A75") + "19",
                        padding: 6,
                        overflow: "hidden",
                      }}
                    >
                      <Label size={11} weight="600" style={{ lineHeight: 14 }}>
                        {e.title}
                      </Label>
                      {height > 44 && (
                        <Label size={9} color={t.muted}>
                          {a.toFormat("h:mm")}–{b.toFormat("h:mm")}
                        </Label>
                      )}
                      {height > 65 && (
                        <Label size={9} color={t.muted}>
                          {c?.name}
                        </Label>
                      )}
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
      ) : (
        <View>
          {dayEvents(days[selected]).length ? (
            dayEvents(days[selected]).map((e) => (
              <EventRow key={e.id} event={e} s={s} onPress={() => onEdit(e)} />
            ))
          ) : (
            <Label color={t.muted}>
              Nothing planned. A little room for possibility.
            </Label>
          )}
        </View>
      )}
    </Card>
  );
}
function Composer({
  onSend,
  busy,
  onError,
}: {
  onSend: (v: string) => Promise<boolean>;
  busy: boolean;
  onError: (m: string) => void;
}) {
  const t = useTheme(),
    [text, setText] = useState(""),
    [voice, setVoice] = useState("");
  useEffect(() => () => disposeVoice(), []);
  const submit = async () => {
    if (!text.trim() || busy) return;
    const value = text;
    if (await onSend(value)) setText("");
  };
  return (
    <Card style={{ padding: 18 }}>
      <View style={ui.row}>
        <Label color={t.accent} size={23}>
          ✧
        </Label>
        <Label weight="600">What would you like to make time for?</Label>
      </View>
      <TextInput
        accessibilityLabel="Scheduling request"
        placeholder="Schedule an hour to work out tomorrow…"
        placeholderTextColor={t.muted}
        value={text}
        onChangeText={setText}
        multiline
        style={{
          fontSize: 15,
          color: t.ink,
          minHeight: 72,
          lineHeight: 23,
          textAlignVertical: "top",
        }}
        onKeyPress={(e: any) => {
          if (
            Platform.OS === "web" &&
            e.nativeEvent.key === "Enter" &&
            !e.shiftKey
          ) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <View style={[ui.between, { flexWrap: "wrap", gap: 12 }]}>
        <Label color={t.muted} size={11} style={{ minWidth: 160 }}>
          {voice || "Your plans. In your own words."}
        </Label>
        <View style={ui.row}>
          <Button
            small
            variant="ghost"
            accessibilityLabel={voice ? "Stop recording" : "Start voice input"}
            onPress={() => {
              if (voice) stopVoice();
              else
                void startVoice(
                  (v) => setText((p) => (p ? p + " " + v : v)),
                  setVoice,
                  onError,
                ).catch((e) => onError(e.message));
            }}
          >
            {voice ? "■ Stop" : "◉ Voice"}
          </Button>
          <Button
            small
            disabled={busy || !text.trim() || Boolean(voice)}
            onPress={() => void submit()}
          >
            Send ↑
          </Button>
        </View>
      </View>
    </Card>
  );
}
function Assistant({
  s,
  run,
  onEdit,
  onSend,
  busy,
  onError,
}: {
  s: AppState;
  run: Run;
  onEdit: (e: CalendarEvent) => void;
  onSend: (m: string) => Promise<boolean>;
  busy: boolean;
  onError: (m: string) => void;
}) {
  const t = useTheme(),
    messages = s.conversations.at(-1)?.messages ?? [],
    shown = new Set<string>();
  return (
    <View
      style={{ maxWidth: 850, width: "100%", alignSelf: "center", gap: 20 }}
    >
      {!messages.length && (
        <Card style={{ padding: 30, gap: 24 }}>
          <Label size={36} color={t.accent}>
            ✧
          </Label>
          <Heading small>A good plan starts with a conversation.</Heading>
          <Label color={t.muted}>
            I’ll find time around your commitments, consider your energy and
            routines, and ask before moving anything.
          </Label>
          <View style={ui.wrap}>
            {[
              "Schedule an hour to work out tomorrow",
              "I have an exam Friday and want four hours of studying",
              "I hate doing homework after 9 PM",
            ].map((m) => (
              <Button
                key={m}
                variant="secondary"
                small
                onPress={() => void onSend(m)}
              >
                {m}
              </Button>
            ))}
          </View>
        </Card>
      )}
      {messages.map((m) => {
        const proposal = s.proposals.find((p) => p.id === m.proposalId);
        if (proposal) shown.add(proposal.id);
        return (
          <View
            key={m.id}
            style={{
              gap: 14,
              alignItems: m.role === "user" ? "flex-end" : "stretch",
            }}
          >
            <View
              style={{
                padding: 18,
                borderRadius: 16,
                backgroundColor: m.role === "user" ? t.soft : t.card,
                maxWidth: "95%",
                borderWidth: m.role === "assistant" ? 1 : 0,
                borderColor: t.line,
              }}
            >
              <Label size={10} color={t.muted} weight="600">
                {m.role === "user" ? "YOU" : "✧ ALIGNED"}
              </Label>
              <Label style={{ marginTop: 7 }}>{m.text}</Label>
            </View>
            {proposal && (
              <ProposalCard p={proposal} s={s} run={run} onEdit={onEdit} />
            )}
          </View>
        );
      })}
      {s.proposals
        .filter(
          (p) =>
            !shown.has(p.id) &&
            ["pending", "recovery", "applied"].includes(p.status),
        )
        .slice(-4)
        .map((p) => (
          <ProposalCard key={p.id} p={p} s={s} run={run} onEdit={onEdit} />
        ))}
      <Composer onSend={onSend} busy={busy} onError={onError} />
      <Label color={t.muted} size={11} style={{ textAlign: "center" }}>
        {s.demo
          ? "Demo language mode · Try the examples above, or edit any event directly."
          : "AI interprets your request. Scheduling rules check every proposed time."}
      </Label>
    </View>
  );
}
function ProposalCard({
  p,
  s,
  run,
  onEdit,
}: {
  p: Proposal;
  s: AppState;
  run: Run;
  onEdit: (e: CalendarEvent) => void;
}) {
  const t = useTheme(),
    [showAll, setShowAll] = useState(false);
  return (
    <Card style={{ borderColor: p.status === "applied" ? t.accent : t.line }}>
      <View style={ui.between}>
        <Heading small>
          {p.status === "applied" ? "✓ " + p.title : p.title}
        </Heading>
        <Chip text={p.status} />
      </View>
      <Label color={t.muted} size={13}>
        {p.explanation}
      </Label>
      {p.shortfallMinutes > 0 && (
        <Label color={t.error}>
          {p.shortfallMinutes} minutes still need space. Applying this adds only
          the sessions shown.
        </Label>
      )}
      {(p.appliedChanges ?? p.changes)
        .slice(0, showAll ? undefined : 12)
        .map((c, i) => {
          const e = c.after ?? c.before!,
            cat = s.categories.find((v) => v.id === e.categoryId),
            time = (v: CalendarEvent) =>
              DateTime.fromISO(v.start)
                .setZone(s.settings.timeZone)
                .toFormat("ccc, MMM d · h:mm a") +
              " – " +
              DateTime.fromISO(v.end)
                .setZone(s.settings.timeZone)
                .toFormat("h:mm a");
          return (
            <View
              key={i}
              style={{
                borderLeftWidth: 3,
                borderColor: cat?.color,
                paddingLeft: 13,
                gap: 5,
                paddingVertical: 5,
              }}
            >
              <Label weight="600">{e.title}</Label>
              {c.before && (
                <Label
                  size={12}
                  color={t.muted}
                  style={{ textDecorationLine: "line-through" }}
                >
                  {time(c.before)}
                </Label>
              )}
              {c.after && <Label size={13}>{time(c.after)}</Label>}
              <Label size={11} color={t.muted}>
                {cat?.name} · {e.priority} priority ·{" "}
                {c.kind === "update"
                  ? "Moved"
                  : c.kind === "delete"
                    ? "Delete"
                    : "New"}
              </Label>
            </View>
          );
        })}
      {p.changes.length > 12 && (
        <Button variant="ghost" onPress={() => setShowAll(!showAll)}>
          {showAll
            ? "Show fewer changes"
            : `Review all ${p.changes.length} changes`}
        </Button>
      )}
      {p.error && <Label color={t.error}>{p.error}</Label>}
      <View style={ui.wrap}>
        {p.status === "pending" && (
          <>
            <Button
              disabled={!p.changes.length}
              onPress={() =>
                void run(() => api(`/api/v1/proposals/${p.id}/apply`, "POST"))
              }
            >
              Apply Changes
            </Button>
            <Button
              variant="ghost"
              onPress={() =>
                void run(() => api(`/api/v1/proposals/${p.id}/reject`, "POST"))
              }
            >
              Dismiss
            </Button>
          </>
        )}
        {p.status === "applied" && (
          <>
            <Button
              variant="ghost"
              onPress={() =>
                void run(() => api(`/api/v1/proposals/${p.id}/undo`, "POST"))
              }
            >
              Undo
            </Button>
            {p.appliedChanges?.length === 1 && p.appliedChanges[0].after && (
              <Button
                variant="secondary"
                onPress={() => onEdit(p.appliedChanges![0].after!)}
              >
                Edit event
              </Button>
            )}
          </>
        )}
      </View>
    </Card>
  );
}
function Insights({ s }: { s: AppState }) {
  const t = useTheme();
  return (
    <View style={ui.column}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 20 }}>
        <Card style={{ flexGrow: 1, flexBasis: 280 }}>
          <Heading small>Today’s alignment</Heading>
          <Score value={s.alignment.today} />
          {s.alignment.today.contributions.map((c) => (
            <View key={c.key} style={ui.row}>
              <Label color={c.value > 0 ? t.accent : t.error}>
                {c.value > 0 ? "＋" : "−"}
              </Label>
              <View style={{ flex: 1 }}>
                <Label size={13}>{c.label}</Label>
              </View>
            </View>
          ))}
        </Card>
        <Card style={{ flexGrow: 1, flexBasis: 340 }}>
          <Heading small>Your week in rhythm</Heading>
          <Label size={13} color={t.muted}>
            Week alignment: {s.alignment.week.score ?? "—"} / 100
          </Label>
          <View
            style={{
              flexDirection: "row",
              gap: 12,
              alignItems: "flex-end",
              height: 190,
            }}
          >
            {s.alignment.days.map((d) => (
              <View
                key={d.date}
                style={{ flex: 1, gap: 8, alignItems: "center" }}
              >
                <Label size={11} color={t.muted}>
                  {d.score ?? "—"}
                </Label>
                <View
                  style={{
                    height: d.score === null ? 5 : Math.max(8, d.score * 1.2),
                    width: "80%",
                    borderRadius: 6,
                    backgroundColor: d.score === null ? t.line : t.accent,
                    opacity: 0.7,
                  }}
                />
                <Label size={10} color={t.muted}>
                  {DateTime.fromISO(d.date).toFormat("ccc")}
                </Label>
              </View>
            ))}
          </View>
          <Label size={12} color={t.muted}>
            Calculated from your calendar and preferences. Empty days have no
            score.
          </Label>
        </Card>
      </View>
      <Card>
        <Heading small>Routines we’re noticing</Heading>
        <Label color={t.muted} size={13}>
          Calendar history suggests patterns; it doesn’t prove an activity was
          completed. Three or more observations are needed before a learned
          habit affects scheduling.
        </Label>
        {s.habits
          .filter((h) => h.count >= 3 || h.source === "explicit")
          .slice(0, 8)
          .map((h) => (
            <View key={h.id} style={ui.between}>
              <View>
                <Label weight="500">
                  {h.activity[0].toUpperCase() + h.activity.slice(1)}
                </Label>
                <Label size={12} color={t.muted}>
                  {
                    [
                      "Monday",
                      "Tuesday",
                      "Wednesday",
                      "Thursday",
                      "Friday",
                      "Saturday",
                      "Sunday",
                    ][h.weekday - 1]
                  }{" "}
                  · around {String(Math.floor(h.minute / 60)).padStart(2, "0")}:
                  {String(h.minute % 60).padStart(2, "0")} · {h.count}{" "}
                  observations
                </Label>
              </View>
              <Chip text={h.source === "explicit" ? "Declared" : "Inferred"} />
            </View>
          ))}
      </Card>
    </View>
  );
}
