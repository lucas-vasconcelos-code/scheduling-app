import React, { createContext, useContext } from "react";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import {
  Text,
  View,
  Pressable,
  TextInput,
  StyleSheet,
  type ViewStyle,
  type TextStyle,
  type TextInputProps,
} from "react-native";
export const light = {
  bg: "#F5F5F0",
  card: "#FFFFFF",
  ink: "#263D34",
  muted: "#63746B",
  line: "#E7EAE3",
  accent: "#3F715B",
  soft: "#E9F0E8",
  surface: "#F0F2EC",
  error: "#A74444",
};
export const dark = {
  bg: "#141F1A",
  card: "#1D2C24",
  ink: "#E8EEE7",
  muted: "#A1B1A6",
  line: "#314338",
  accent: "#92C6A6",
  soft: "#2B4434",
  surface: "#24352C",
  error: "#F0A0A0",
};
export type Palette = typeof light;
export const Theme = createContext<Palette>(light);
export function useTheme() {
  return useContext(Theme);
}
export function Label({
  children,
  size = 14,
  color,
  weight = "400",
  style,
}: {
  children: React.ReactNode;
  size?: number;
  color?: string;
  weight?: TextStyle["fontWeight"];
  style?: TextStyle;
}) {
  const t = useTheme();
  return (
    <Text
      style={[
        {
          fontSize: size,
          color: color ?? t.ink,
          fontWeight: weight,
          lineHeight: size * 1.45,
          fontFamily: "System",
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}
export function Heading({
  children,
  small = false,
}: {
  children: React.ReactNode;
  small?: boolean;
}) {
  return (
    <Label
      size={small ? 21 : 36}
      weight="600"
      style={{ letterSpacing: small ? -0.5 : -1.3 }}
    >
      {children}
    </Label>
  );
}
export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  const t = useTheme();
  return (
    <Animated.View
      entering={FadeIn.duration(180).reduceMotion(ReduceMotion.System)}
      style={[
        {
          backgroundColor: t.card,
          borderWidth: 1,
          borderColor: t.line,
          borderRadius: 20,
          padding: 22,
          gap: 14,
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}
export function Button({
  children,
  onPress,
  variant = "primary",
  disabled = false,
  accessibilityLabel,
  small = false,
}: {
  children: React.ReactNode;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  accessibilityLabel?: string;
  small?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed, hovered }: any) => ({
        minHeight: 46,
        paddingHorizontal: small ? 13 : 19,
        paddingVertical: small ? 8 : 11,
        borderRadius: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor:
          variant === "primary"
            ? t.accent
            : variant === "secondary"
              ? t.soft
              : variant === "danger"
                ? t.error
                : "transparent",
        opacity: disabled ? 0.45 : pressed ? 0.65 : hovered ? 0.85 : 1,
        borderWidth: variant === "ghost" ? 1 : 0,
        borderColor: t.line,
      })}
    >
      <Label
        size={small ? 12 : 14}
        weight="600"
        color={
          variant === "primary"
            ? t === dark
              ? "#16281D"
              : "#FFFFFF"
            : variant === "danger"
              ? "white"
              : t.ink
        }
      >
        {children}
      </Label>
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6, flexGrow: 1 }}>
      <Label size={12} color={t.muted} weight="600">
        {label}
      </Label>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={t.muted}
        style={[
          {
            minHeight: 46,
            borderWidth: 1,
            borderColor: t.line,
            borderRadius: 10,
            padding: 12,
            color: t.ink,
            backgroundColor: t.card,
            fontSize: 14,
          },
          props.style,
        ]}
      />
    </View>
  );
}
export function Chip({
  text,
  color,
  selected,
  onPress,
}: {
  text: string;
  color?: string;
  selected?: boolean;
  onPress?: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
        paddingHorizontal: 11,
        paddingVertical: 7,
        borderRadius: 9,
        backgroundColor: selected ? t.soft : t.surface,
        borderWidth: 1,
        borderColor: selected ? t.accent : "transparent",
        minHeight: onPress ? 44 : 30,
      }}
    >
      {color && (
        <View
          style={{
            width: 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: color,
          }}
        />
      )}
      <Label size={12} color={selected ? t.accent : t.muted} weight="500">
        {text}
      </Label>
    </Pressable>
  );
}
export const ui = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  between: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  column: { gap: 20 },
  tiny: { fontSize: 11, letterSpacing: 1.6, fontWeight: "600" },
});
