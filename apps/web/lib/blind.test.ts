import assert from "node:assert/strict";
import test from "node:test";
import { answerForChoice, createBlindAssignment } from "@/lib/blind";

test("assigns earlier and later takes to X/Y in both orders", () => {
  assert.deepEqual(createBlindAssignment("before", "after", 0.2), {
    x_take_id: "before",
    y_take_id: "after",
  });
  assert.deepEqual(createBlindAssignment("before", "after", 0.8), {
    x_take_id: "after",
    y_take_id: "before",
  });
});

test("maps a blind choice back to earlier or later without exposing assignment", () => {
  const assignment = createBlindAssignment("before", "after", 0.8);
  assert.equal(answerForChoice("x", assignment, "after"), "later");
  assert.equal(answerForChoice("y", assignment, "after"), "earlier");
  assert.equal(answerForChoice("unsure", assignment, "after"), "unsure");
});
