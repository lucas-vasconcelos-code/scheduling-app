import { it, expect, vi } from "vitest";
import { GeminiIntentProvider } from "../apps/server/src/intent.js";
import { emptyState } from "../apps/server/src/demo.js";
it("uses stateless structured Interactions requests and validates returned JSON", async () => {
  const provider = new GeminiIntentProvider("test-key", "test-model");
  const create = vi.fn().mockResolvedValue({
    output_text: JSON.stringify({
      type: "clarify",
      confidence: 0.5,
      question: "Which day?",
    }),
  });
  (provider as any).client = { interactions: { create } };
  const state = emptyState("u"),
    conversation = { id: "c", userId: "u", messages: [] };
  expect(
    await provider.interpret(
      "Schedule a workout",
      state,
      conversation,
      "2026-06-08T12:00:00Z",
    ),
  ).toMatchObject({ type: "clarify" });
  expect(create.mock.calls[0][0]).toMatchObject({
    model: "test-model",
    store: false,
    response_format: { type: "text", mime_type: "application/json" },
  });
  expect(create.mock.calls[0][0]).not.toHaveProperty("previous_interaction_id");
  create.mockResolvedValue({ output_text: '{"type":"delete_everything"}' });
  await expect(
    provider.interpret(
      "bad output",
      state,
      conversation,
      "2026-06-08T12:00:00Z",
    ),
  ).rejects.toThrow();
});
