import React, { useState } from "react";
import { router } from "expo-router";
import { View, Switch } from "react-native";
import { DateTime } from "luxon";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type {
  CalendarEvent,
  Category,
  Settings,
  PreferenceRule,
  Deadline,
} from "@aligned/shared";
import { api, type AppState } from "./api";
import { enableAlerts, reconcileAlerts, cancelAllAlerts } from "./alerts";
import { login } from "./login";
import { Label, Heading, Card, Button, Chip, Field, ui, useTheme } from "./ui";
import type { Run } from "./App";
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const editorSchema = z.object({
  title: z.string().trim().min(1, "Give your event a title"),
  start: z.string().min(1),
  end: z.string().min(1),
});
export function EventEditor({
  s,
  event,
  run,
  onClose,
  onProposal,
}: {
  s: AppState;
  event?: CalendarEvent;
  run: Run;
  onClose: () => void;
  onProposal: () => void;
}) {
  const t = useTheme(),
    zone = s.settings.timeZone,
    start = event
      ? DateTime.fromISO(event.start).setZone(zone)
      : DateTime.now()
          .setZone(zone)
          .plus({ days: 1 })
          .set({ hour: 15, minute: 0, second: 0, millisecond: 0 }),
    end = event
      ? DateTime.fromISO(event.end).setZone(zone)
      : start.plus({ hours: 1 });
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(editorSchema),
    defaultValues: {
      title: event?.title ?? "",
      start: start.toFormat("yyyy-MM-dd'T'HH:mm"),
      end: end.toFormat("yyyy-MM-dd'T'HH:mm"),
    },
  });
  const [categoryId, setCategory] = useState(
      event?.categoryId ??
        s.categories.find((c) => c.active && c.role === "deep-work")?.id ??
        s.categories[0].id,
    ),
    [flexibility, setFlexibility] = useState(event?.flexibility ?? "flexible"),
    [priority, setPriority] = useState(event?.priority ?? "medium"),
    [interruptible, setInterruptible] = useState(event?.interruptible ?? false),
    [allDay, setAllDay] = useState(event?.allDay ?? false),
    [scope, setScope] = useState("instance");
  const submit = handleSubmit(
    (values) =>
      void run(async () => {
        const start = DateTime.fromISO(values.start, { zone }),
          end = DateTime.fromISO(values.end, { zone });
        if (
          !start.isValid ||
          !end.isValid ||
          end <= start ||
          start.toFormat("yyyy-MM-dd'T'HH:mm") !== values.start ||
          end.toFormat("yyyy-MM-dd'T'HH:mm") !== values.end
        )
          throw new Error(
            "Enter valid local dates, with the end after the start. Times skipped by daylight saving are unavailable.",
          );
        const body = {
          ...values,
          start: (allDay ? start.startOf("day") : start).toISO(),
          end: (allDay
            ? end.startOf("day") > start.startOf("day")
              ? end.startOf("day")
              : start.startOf("day").plus({ days: 1 })
            : end
          ).toISO(),
          timeZone: zone,
          categoryId,
          flexibility,
          priority,
          interruptible,
          allDay,
          scope,
          activity:
            event?.activity ??
            s.categories.find((c) => c.id === categoryId)?.role,
        };
        await api(
          event ? `/api/v1/events/${event.id}` : "/api/v1/events",
          event ? "PATCH" : "POST",
          body,
        );
        onProposal();
      }),
  );
  return (
    <View style={ui.column}>
      <View style={ui.between}>
        <Heading small>
          {event ? "Edit your event" : "Make a little space"}
        </Heading>
        <Button
          small
          variant="ghost"
          onPress={onClose}
          accessibilityLabel="Close editor"
        >
          ×
        </Button>
      </View>
      {(["title", "start", "end"] as const).map((name) => (
        <View key={name}>
          <Controller
            control={control}
            name={name}
            render={({ field: { onChange, value } }) => (
              <Field
                label={
                  name === "title"
                    ? "Event title"
                    : name === "start"
                      ? "Start · YYYY-MM-DDTHH:mm"
                      : "End · YYYY-MM-DDTHH:mm"
                }
                value={value}
                onChangeText={onChange}
              />
            )}
          />
          {errors[name] && (
            <Label color={t.error} size={12}>
              {errors[name]?.message}
            </Label>
          )}
        </View>
      ))}
      <Label size={12} color={t.muted}>
        Times are in {zone}. All-day end dates are exclusive.
      </Label>
      <Toggle label="All-day event" value={allDay} onChange={setAllDay} />
      <Label weight="600">Category</Label>
      <View style={ui.wrap}>
        {s.categories
          .filter((c) => c.active)
          .map((c) => (
            <Chip
              key={c.id}
              text={c.name}
              color={c.color}
              selected={categoryId === c.id}
              onPress={() => {
                setCategory(c.id);
                setFlexibility(c.flexibility);
                setPriority(c.priority);
                setInterruptible(c.interruptible);
              }}
            />
          ))}
      </View>
      <Label weight="600">Flexibility</Label>
      <View style={ui.wrap}>
        {(["fixed", "flexible", "protected"] as const).map((f) => (
          <Chip
            key={f}
            text={f}
            selected={flexibility === f}
            onPress={() => setFlexibility(f)}
          />
        ))}
      </View>
      <Label weight="600">Priority</Label>
      <View style={ui.wrap}>
        {(["low", "medium", "high", "critical"] as const).map((f) => (
          <Chip
            key={f}
            text={f}
            selected={priority === f}
            onPress={() => setPriority(f)}
          />
        ))}
      </View>
      <Toggle
        label="Can be interrupted"
        value={interruptible}
        onChange={setInterruptible}
      />
      {event?.seriesId && (
        <>
          <Label weight="600">Recurring event</Label>
          <View style={ui.wrap}>
            {["instance", "series"].map((v) => (
              <Chip
                key={v}
                text={v === "instance" ? "This occurrence" : "Entire series"}
                selected={scope === v}
                onPress={() => setScope(v)}
              />
            ))}
          </View>
        </>
      )}
      <View style={ui.wrap}>
        <Button onPress={() => void submit()}>
          {event ? "Preview changes" : "Create event"}
        </Button>
        {event && (
          <Button
            variant="danger"
            onPress={() =>
              void run(async () => {
                await api(`/api/v1/events/${event.id}`, "DELETE", { scope });
                onProposal();
              })
            }
          >
            Delete…
          </Button>
        )}
        <Button variant="ghost" onPress={onClose}>
          Cancel
        </Button>
      </View>
    </View>
  );
}
function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const t = useTheme();
  return (
    <View style={ui.between}>
      <View style={{ flex: 1 }}>
        <Label size={13}>{label}</Label>
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: t.accent, false: t.line }}
      />
    </View>
  );
}
function Rhythm({
  s,
  run,
  afterSave,
  label = "Save rhythm",
}: {
  s: AppState;
  run: Run;
  afterSave?: () => void;
  label?: string;
}) {
  const [v, setV] = useState<Settings>(s.settings);
  const t = useTheme(),
    field = (key: keyof Settings, value: string) =>
      setV((p) => ({ ...p, [key]: value }));
  return (
    <View style={ui.column}>
      <Heading small>Your daily rhythm</Heading>
      <Label color={t.muted} size={13}>
        These are starting points. Change them whenever your life changes.
      </Label>
      <Field
        label="Time zone"
        value={v.timeZone}
        onChangeText={(x) => field("timeZone", x)}
      />
      <View style={ui.row}>
        <Field
          label="Wake time · HH:mm"
          value={v.wake}
          onChangeText={(x) => field("wake", x)}
        />
        <Field
          label="Sleep time · HH:mm"
          value={v.sleep}
          onChangeText={(x) => field("sleep", x)}
        />
      </View>
      {(["highEnergy", "lowEnergy"] as const).map((key) => (
        <View style={ui.row} key={key}>
          <Field
            label={`${key === "highEnergy" ? "High" : "Low"} energy begins`}
            value={v[key][0]}
            onChangeText={(x) => setV((p) => ({ ...p, [key]: [x, p[key][1]] }))}
          />
          <Field
            label="Ends"
            value={v[key][1]}
            onChangeText={(x) => setV((p) => ({ ...p, [key]: [p[key][0], x] }))}
          />
        </View>
      ))}
      <View style={ui.wrap}>
        {(
          [
            ["focusMinutes", "Ideal focus · minutes"],
            ["maxFocusMinutes", "Maximum focus · minutes"],
            ["breakMinutes", "Break · minutes"],
            ["bufferMinutes", "Transition · minutes"],
            ["maxBackToBack", "Back-to-back limit"],
          ] as const
        ).map(([key, label]) => (
          <View key={key} style={{ flexGrow: 1, flexBasis: 180 }}>
            <Field
              label={label}
              keyboardType="numeric"
              value={String(v[key])}
              onChangeText={(x) => setV((p) => ({ ...p, [key]: Number(x) }))}
            />
          </View>
        ))}
      </View>
      <View style={ui.wrap}>
        {(["system", "light", "dark"] as const).map((theme) => (
          <Chip
            key={theme}
            text={theme + " theme"}
            selected={v.theme === theme}
            onPress={() => setV((p) => ({ ...p, theme }))}
          />
        ))}
      </View>
      <Button
        onPress={() =>
          void run(async () => {
            await api("/api/v1/settings", "PATCH", v);
            afterSave?.();
          })
        }
      >
        {label}
      </Button>
    </View>
  );
}
function Categories({ s, run }: { s: AppState; run: Run }) {
  const [editing, setEditing] = useState<string | null>(null),
    t = useTheme();
  return (
    <View style={ui.column}>
      <Heading small>A place for every part of life</Heading>
      <Label size={13} color={t.muted}>
        Rename categories, choose colors, and decide how flexible each kind of
        time should be. Event-level choices take precedence.
      </Label>
      {s.categories.map((c) => (
        <View key={c.id} style={{ gap: 12 }}>
          <View style={ui.between}>
            <Chip color={c.color} text={c.name} />
            <View style={ui.row}>
              <Label size={11} color={t.muted}>
                {c.active ? c.flexibility : "Inactive"}
              </Label>
              <Button
                small
                variant="ghost"
                onPress={() => setEditing(editing === c.id ? null : c.id)}
              >
                Edit
              </Button>
            </View>
          </View>
          {editing === c.id && (
            <CategoryForm
              category={c}
              run={run}
              close={() => setEditing(null)}
            />
          )}
        </View>
      ))}
      <Button
        variant="secondary"
        onPress={() =>
          void run(async () => {
            const id = uid();
            await api(`/api/v1/categories/${id}`, "PUT", {
              name: "New category",
              color: "#7D9EBC",
              role: "custom",
              flexibility: "flexible",
              interruptible: true,
              priority: "medium",
              active: true,
            });
            setEditing(id);
          })
        }
      >
        ＋ Add category
      </Button>
      <ImportReview s={s} run={run} />
    </View>
  );
}
function CategoryForm({
  category,
  run,
  close,
}: {
  category: Category;
  run: Run;
  close: () => void;
}) {
  const [c, setC] = useState(category);
  return (
    <Card>
      <Field
        label="Category name"
        value={c.name}
        onChangeText={(name) => setC((p) => ({ ...p, name }))}
      />
      <Field
        label="Color · hexadecimal"
        value={c.color}
        onChangeText={(color) => setC((p) => ({ ...p, color }))}
      />
      <View style={ui.wrap}>
        {["#5B7CFA", "#558A75", "#DE9369", "#AF82EA", "#CC87AC", "#BE9C60"].map(
          (color) => (
            <Chip
              key={color}
              text={color}
              color={color}
              selected={c.color === color}
              onPress={() => setC((p) => ({ ...p, color }))}
            />
          ),
        )}
      </View>
      <View style={ui.wrap}>
        {(["fixed", "flexible", "protected"] as const).map((flexibility) => (
          <Chip
            key={flexibility}
            text={flexibility}
            selected={c.flexibility === flexibility}
            onPress={() => setC((p) => ({ ...p, flexibility }))}
          />
        ))}
      </View>
      <View style={ui.wrap}>
        {(["low", "medium", "high", "critical"] as const).map((priority) => (
          <Chip
            key={priority}
            text={priority}
            selected={c.priority === priority}
            onPress={() => setC((p) => ({ ...p, priority }))}
          />
        ))}
      </View>
      <Toggle
        label="Interruptible by default"
        value={c.interruptible}
        onChange={(interruptible) => setC((p) => ({ ...p, interruptible }))}
      />
      <Toggle
        label="Active category"
        value={c.active}
        onChange={(active) => setC((p) => ({ ...p, active }))}
      />
      <Button
        small
        onPress={() =>
          void run(async () => {
            await api(`/api/v1/categories/${c.id}`, "PUT", c);
            close();
          })
        }
      >
        Save category
      </Button>
    </Card>
  );
}
function ImportReview({ s, run }: { s: AppState; run: Run }) {
  const t = useTheme(),
    [choices, setChoices] = useState<Record<string, string>>({}),
    pending = s.events.filter((e) => !e.importReviewed);
  return pending.length ? (
    <Card>
      <Heading small>Review imported events</Heading>
      <Label size={13} color={t.muted}>
        Until you accept a suggestion, the event stays fixed and
        non-interruptible.
      </Label>
      {pending.slice(0, 20).map((e) => {
        const c = s.categories.find(
          (c) => c.id === (choices[e.id] ?? e.suggestedCategoryId),
        );
        return (
          <View key={e.id} style={ui.between}>
            <View style={{ flex: 1 }}>
              <Label>{e.title}</Label>
              <Label size={11} color={t.muted}>
                {c?.name} · {c?.flexibility} ·{" "}
                {c?.interruptible ? "Interruptible" : "Quiet"}
              </Label>
              <View style={ui.wrap}>
                {s.categories
                  .filter((c) => c.active)
                  .map((category) => (
                    <Chip
                      key={category.id}
                      text={category.name}
                      selected={category.id === c?.id}
                      onPress={() =>
                        setChoices((previous) => ({
                          ...previous,
                          [e.id]: category.id,
                        }))
                      }
                    />
                  ))}
              </View>
            </View>
            <Button
              small
              variant="secondary"
              onPress={() =>
                void run(() =>
                  api("/api/v1/imports/review", "POST", {
                    eventIds: [e.id],
                    categoryId: choices[e.id],
                  }),
                )
              }
            >
              Accept
            </Button>
          </View>
        );
      })}
      {pending.length > 20 && (
        <Label size={12} color={t.muted}>
          {pending.length - 20} more to review after these.
        </Label>
      )}
    </Card>
  ) : null;
}
function Preferences({ s, run }: { s: AppState; run: Run }) {
  const t = useTheme(),
    [statement, setStatement] = useState(""),
    [editing, setEditing] = useState<string | null>(null);
  return (
    <View style={ui.column}>
      <Heading small>The way you like your days</Heading>
      <Label size={13} color={t.muted}>
        Tell Aligned what works for you. Explicit rules stay distinct from
        inferred patterns.
      </Label>
      <Field
        label="A scheduling preference"
        placeholder="I work best in the morning"
        value={statement}
        onChangeText={setStatement}
      />
      <Button
        onPress={() =>
          void run(async () => {
            await api("/api/v1/messages", "POST", { message: statement });
            setStatement("");
          })
        }
      >
        Save preference
      </Button>
      {s.preferences.map((p) => (
        <Card key={p.id}>
          <View style={ui.between}>
            <View style={{ flex: 1 }}>
              <Label>{p.statement}</Label>
              <Label size={11} color={t.muted}>
                {p.source} · {p.hard ? "Hard rule" : "Soft preference"}
              </Label>
            </View>
            <Switch
              accessibilityLabel={`Enable ${p.statement}`}
              value={p.enabled}
              onValueChange={(enabled) =>
                void run(() =>
                  api(`/api/v1/preferences/${p.id}`, "PUT", { enabled }),
                )
              }
            />
          </View>
          <View style={ui.wrap}>
            <Button
              small
              variant="ghost"
              onPress={() => setEditing(editing === p.id ? null : p.id)}
            >
              Edit
            </Button>
            <Button
              small
              variant="ghost"
              onPress={() =>
                void run(() => api(`/api/v1/preferences/${p.id}`, "DELETE"))
              }
            >
              Delete
            </Button>
          </View>
          {editing === p.id && (
            <PreferenceEditor p={p} run={run} close={() => setEditing(null)} />
          )}
        </Card>
      ))}
    </View>
  );
}
function PreferenceEditor({
  p,
  run,
  close,
}: {
  p: PreferenceRule;
  run: Run;
  close: () => void;
}) {
  const [v, setV] = useState(p);
  return (
    <View style={ui.column}>
      <Field
        label="Original statement"
        value={v.statement}
        onChangeText={(statement) => setV((p) => ({ ...p, statement }))}
      />
      <Field
        label="Activity · study, gym, or *"
        value={v.activity}
        onChangeText={(activity) => setV((p) => ({ ...p, activity }))}
      />
      <View style={ui.row}>
        <Field
          label="From · HH:mm"
          value={v.start}
          onChangeText={(start) => setV((p) => ({ ...p, start }))}
        />
        <Field
          label="Until · HH:mm"
          value={v.end}
          onChangeText={(end) => setV((p) => ({ ...p, end }))}
        />
      </View>
      <View style={ui.wrap}>
        {(
          ["avoid", "prefer", "non-interruptible", "avoid-before"] as const
        ).map((kind) => (
          <Chip
            key={kind}
            text={kind}
            selected={v.kind === kind}
            onPress={() => setV((p) => ({ ...p, kind }))}
          />
        ))}
      </View>
      {v.kind === "avoid-before" && (
        <Field
          label="Before activity"
          value={v.relatedActivity ?? "class"}
          onChangeText={(relatedActivity) =>
            setV((p) => ({ ...p, relatedActivity }))
          }
        />
      )}
      <View style={ui.wrap}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => (
          <Chip
            key={d}
            text={d}
            selected={v.weekdays.includes(i + 1)}
            onPress={() =>
              setV((p) => ({
                ...p,
                weekdays: p.weekdays.includes(i + 1)
                  ? p.weekdays.filter((d) => d !== i + 1)
                  : [...p.weekdays, i + 1],
              }))
            }
          />
        ))}
      </View>
      <Label size={11}>No selected weekdays means every day.</Label>
      {v.source === "explicit" && (
        <Toggle
          label="Mandatory rule"
          value={v.hard}
          onChange={(hard) => setV((p) => ({ ...p, hard }))}
        />
      )}
      <Button
        small
        onPress={() =>
          void run(async () => {
            await api(`/api/v1/preferences/${p.id}`, "PUT", v);
            close();
          })
        }
      >
        Save rule
      </Button>
    </View>
  );
}
function Habits({ s, run }: { s: AppState; run: Run }) {
  const t = useTheme(),
    [activity, setActivity] = useState("gym"),
    [time, setTime] = useState("16:00"),
    [weekday, setWeekday] = useState(1),
    [from, setFrom] = useState("gym"),
    [to, setTo] = useState("dinner"),
    [minutes, setMinutes] = useState("60");
  return (
    <View style={ui.column}>
      <Heading small>Build on your natural rhythm</Heading>
      <Label size={13} color={t.muted}>
        Declare a habit, or let calendar history gradually suggest one. Link
        activities that feel good together.
      </Label>
      <Field label="Activity" value={activity} onChangeText={setActivity} />
      <View style={ui.row}>
        <Field label="Usual time · HH:mm" value={time} onChangeText={setTime} />
        <Field
          label="Weekday · 1 Monday to 7 Sunday"
          value={String(weekday)}
          onChangeText={(v) => setWeekday(Number(v))}
          keyboardType="numeric"
        />
      </View>
      <Button
        variant="secondary"
        onPress={() =>
          void run(async () => {
            if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
              throw new Error("Use HH:mm for the habit time.");
            const [h, m] = time.split(":").map(Number);
            await api(`/api/v1/habits/${uid()}`, "PUT", {
              activity,
              weekday,
              minute: h * 60 + m,
              duration: 60,
              count: 0,
              strength: 1,
              lastSeen: new Date().toISOString(),
              source: "explicit",
            });
          })
        }
      >
        Declare habit
      </Button>
      {s.habits
        .filter((h) => h.source === "explicit")
        .map((h) => (
          <View key={h.id} style={ui.between}>
            <Label>
              {h.activity} · weekday {h.weekday}
            </Label>
            <Button
              small
              variant="ghost"
              onPress={() =>
                void run(() => api(`/api/v1/habits/${h.id}`, "DELETE"))
              }
            >
              Remove
            </Button>
          </View>
        ))}
      <Heading small>Better together</Heading>
      <View style={ui.row}>
        <Field
          label="After this activity"
          value={from}
          onChangeText={setFrom}
        />
        <Field label="Prefer this activity" value={to} onChangeText={setTo} />
      </View>
      <Field
        label="Within minutes"
        value={minutes}
        onChangeText={setMinutes}
        keyboardType="numeric"
      />
      <Button
        variant="secondary"
        onPress={() =>
          void run(() =>
            api(`/api/v1/relationships/${uid()}`, "PUT", {
              from,
              to,
              minutes: Number(minutes),
              relation: "within_minutes_after",
              mandatory: false,
            }),
          )
        }
      >
        Link activities
      </Button>
      {s.relationships.map((r) => (
        <View key={r.id} style={ui.between}>
          <View style={{ flex: 1 }}>
            <Label>
              {r.from} → {r.to}
            </Label>
            <Label size={12} color={t.muted}>
              {r.relation.replaceAll("_", " ")} · {r.minutes} minutes
            </Label>
          </View>
          <Button
            small
            variant="ghost"
            onPress={() =>
              void run(() => api(`/api/v1/relationships/${r.id}`, "DELETE"))
            }
          >
            Remove
          </Button>
        </View>
      ))}
    </View>
  );
}
function Deadlines({ s, run }: { s: AppState; run: Run }) {
  const [editing, setEditing] = useState<Deadline | undefined>(),
    [adding, setAdding] = useState(false);
  return (
    <View style={ui.column}>
      <Heading small>Deadlines & work remaining</Heading>
      {s.deadlines.map((d) => (
        <Card key={d.id}>
          <Label weight="600">{d.title}</Label>
          <Label size={12}>
            Due{" "}
            {DateTime.fromISO(d.due)
              .setZone(s.settings.timeZone)
              .toFormat("MMM d, h:mm a")}{" "}
            · {d.estimatedMinutes - d.completedMinutes} minutes remaining
          </Label>
          <View style={ui.wrap}>
            <Button
              small
              variant="ghost"
              onPress={() => {
                setEditing(d);
                setAdding(true);
              }}
            >
              Edit
            </Button>
            <Button
              small
              variant="secondary"
              onPress={() =>
                void run(async () => {
                  await api(`/api/v1/deadlines/${d.id}/plan`, "POST");
                  router.replace("/assistant");
                })
              }
            >
              Plan remaining work
            </Button>
            <Button
              small
              variant="ghost"
              onPress={() =>
                void run(() => api(`/api/v1/deadlines/${d.id}`, "DELETE"))
              }
            >
              Delete
            </Button>
          </View>
        </Card>
      ))}
      <Button
        variant="secondary"
        onPress={() => {
          setEditing(undefined);
          setAdding(true);
        }}
      >
        ＋ Deadline
      </Button>
      {adding && (
        <DeadlineForm
          key={editing?.id ?? "new"}
          s={s}
          deadline={editing}
          run={run}
          close={() => setAdding(false)}
        />
      )}
    </View>
  );
}
function DeadlineForm({
  s,
  deadline: d,
  run,
  close,
}: {
  s: AppState;
  deadline?: Deadline;
  run: Run;
  close: () => void;
}) {
  const [title, setTitle] = useState(d?.title ?? ""),
    [due, setDue] = useState(
      DateTime.fromISO(d?.due ?? DateTime.now().plus({ days: 7 }).toISO()!)
        .setZone(s.settings.timeZone)
        .toFormat("yyyy-MM-dd'T'HH:mm"),
    ),
    [estimated, setEstimated] = useState(String(d?.estimatedMinutes ?? 240)),
    [completed, setCompleted] = useState(String(d?.completedMinutes ?? 0));
  return (
    <Card>
      <Field label="Deadline title" value={title} onChangeText={setTitle} />
      <Field
        label="Due · local YYYY-MM-DDTHH:mm"
        value={due}
        onChangeText={setDue}
      />
      <Field
        label="Work required · minutes"
        value={estimated}
        onChangeText={setEstimated}
      />
      <Field
        label="Work completed · minutes"
        value={completed}
        onChangeText={setCompleted}
      />
      <Button
        onPress={() =>
          void run(async () => {
            await api(`/api/v1/deadlines/${d?.id ?? uid()}`, "PUT", {
              ...d,
              title,
              due: DateTime.fromISO(due, { zone: s.settings.timeZone }).toISO(),
              estimatedMinutes: Number(estimated),
              completedMinutes: Number(completed),
              priority: d?.priority ?? "high",
              categoryId:
                d?.categoryId ??
                s.categories.find((c) => c.role === "deadlines")?.id,
              minSessionMinutes: 30,
              maxSessionMinutes: s.settings.maxFocusMinutes,
              notes: d?.notes ?? "",
            });
            close();
          })
        }
      >
        Save deadline
      </Button>
    </Card>
  );
}
export function SettingsPanel({
  s,
  run,
  onLogout,
  connection,
}: {
  s: AppState;
  run: Run;
  onLogout: () => void;
  connection?: { online: boolean; live: boolean };
}) {
  const [tab, setTab] = useState("Rhythm"),
    [notification, setNotification] = useState(""),
    t = useTheme();
  return (
    <View style={{ gap: 24, maxWidth: 850, width: "100%" }}>
      <View style={ui.wrap}>
        {[
          "Rhythm",
          "Categories",
          "Preferences",
          "Habits",
          "Deadlines",
          "Account",
        ].map((v) => (
          <Chip
            key={v}
            text={v}
            selected={tab === v}
            onPress={() => setTab(v)}
          />
        ))}
      </View>
      <Card>
        {tab === "Rhythm" && <Rhythm s={s} run={run} />}
        {tab === "Categories" && <Categories s={s} run={run} />}
        {tab === "Preferences" && <Preferences s={s} run={run} />}
        {tab === "Habits" && <Habits s={s} run={run} />}
        {tab === "Deadlines" && <Deadlines s={s} run={run} />}
        {tab === "Account" && (
          <>
            <Heading small>Your workspace</Heading>
            <Label>
              {s.demo
                ? "Demo mode · calendar and language providers are simulated."
                : s.connected
                  ? `Connected to ${s.sync.email ?? "your primary Google Calendar"}.`
                  : "Google is disconnected. Your Aligned data is saved."}
            </Label>
            <Label size={13} color={t.muted}>
              Last sync:{" "}
              {s.sync.at
                ? DateTime.fromISO(s.sync.at).toLocaleString(
                    DateTime.DATETIME_MED,
                  )
                : "Not yet synchronized"}
            </Label>
            <Label size={13}>
              {connection?.online === false
                ? "Offline · saved data"
                : connection?.live
                  ? "Live updates connected"
                  : "Automatic refresh active · reconnecting live updates"}
            </Label>
            {s.sync.error && <Label color={t.error}>{s.sync.error}</Label>}
            {s.devices.map((d) => (
              <View key={d.id} style={{ gap: 4 }}>
                <Label size={12}>
                  {d.platform} · {d.appVersion ?? "browser"} · last active{" "}
                  {d.lastSeen
                    ? DateTime.fromISO(d.lastSeen).toRelative()
                    : "unknown"}
                </Label>
                <Label size={12}>
                  {d.capability ?? "Browser notifications while open"} ·{" "}
                  {d.registrations?.length ?? 0} reminders registered
                </Label>
                {d.pushStatus && <Label size={12}>{d.pushStatus}</Label>}
              </View>
            ))}
            <Label size={13} color={t.muted}>
              Google labels: {s.sync.labels}. Your categories always remain
              available inside Aligned.
            </Label>
            <View style={ui.wrap}>
              <Button
                variant="secondary"
                onPress={() => void run(() => api("/api/v1/sync", "POST"))}
              >
                Sync now
              </Button>
              <Button variant="ghost" onPress={() => void run(login)}>
                Connect / reconnect Google
              </Button>
              <Button
                variant="secondary"
                onPress={() =>
                  void run(async () => {
                    setNotification(await enableAlerts());
                    await api("/api/v1/settings", "PATCH", {
                      notificationsEnabled: true,
                    });
                    await reconcileAlerts(s.alerts);
                  })
                }
              >
                Enable meeting reminders
              </Button>
            </View>
            <Toggle
              label="Prominent alarms when interruptible"
              value={s.settings.prominentAlarmsEnabled}
              onChange={(prominentAlarmsEnabled) =>
                void run(() =>
                  api("/api/v1/settings", "PATCH", { prominentAlarmsEnabled }),
                )
              }
            />
            {s.settings.notificationsEnabled && (
              <Button
                variant="ghost"
                onPress={() =>
                  void run(async () => {
                    await api("/api/v1/settings", "PATCH", {
                      notificationsEnabled: false,
                    });
                    await cancelAllAlerts();
                    setNotification(
                      "App reminders disabled. Google Calendar reminders are unchanged.",
                    );
                  })
                }
              >
                Disable app reminders
              </Button>
            )}
            {Boolean(notification) && (
              <Label color={t.accent}>{notification}</Label>
            )}
            <Label size={12} color={t.muted}>
              Prominent alarms require a supported installed app and permission.
              Changes made elsewhere can only update device reminders after the
              device receives the new schedule.
            </Label>
            {s.demo && (
              <Button
                variant="ghost"
                onPress={() =>
                  void run(() => api("/api/v1/demo/reset", "POST"))
                }
              >
                Reset demo calendar
              </Button>
            )}
            {!s.demo && s.connected && (
              <Button
                variant="ghost"
                onPress={() =>
                  void run(async () => {
                    await api("/api/v1/google/disconnect", "POST");
                    await cancelAllAlerts();
                  })
                }
              >
                Disconnect Google
              </Button>
            )}
            <Button variant="ghost" onPress={onLogout}>
              Sign out this device
            </Button>
          </>
        )}
      </Card>
    </View>
  );
}
export function Onboarding({
  s,
  run,
  close,
}: {
  s: AppState;
  run: Run;
  close: () => void;
}) {
  const [step, setStep] = useState(0),
    t = useTheme(),
    finish = () =>
      void run(async () => {
        await api("/api/v1/settings", "PATCH", { onboarded: true });
        close();
      });
  return (
    <View style={ui.column}>
      <View style={ui.between}>
        <Label color={t.accent} weight="600">
          MAKE IT YOURS · {step + 1} OF 4
        </Label>
        <Button
          small
          variant="ghost"
          onPress={close}
          accessibilityLabel="Close onboarding"
        >
          ×
        </Button>
      </View>
      <View style={{ height: 4, backgroundColor: t.line, borderRadius: 4 }}>
        <View
          style={{
            height: 4,
            width: `${(step + 1) * 25}%`,
            backgroundColor: t.accent,
            borderRadius: 4,
          }}
        />
      </View>
      {step === 0 && <Categories s={s} run={run} />}
      {step === 1 && (
        <Rhythm
          s={s}
          run={run}
          afterSave={() => setStep(2)}
          label="Save & continue →"
        />
      )}
      {step === 2 && <Habits s={s} run={run} />}
      {step === 3 && <Preferences s={s} run={run} />}
      <View style={ui.wrap}>
        {step > 0 && (
          <Button variant="ghost" onPress={() => setStep((v) => v - 1)}>
            Back
          </Button>
        )}
        {step < 3 && step !== 1 && (
          <Button onPress={() => setStep((v) => v + 1)}>Continue →</Button>
        )}
        {step === 3 && <Button onPress={finish}>My day, my rhythm →</Button>}
        <Button variant="ghost" onPress={finish}>
          Use defaults & finish
        </Button>
      </View>
    </View>
  );
}
