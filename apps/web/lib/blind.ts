export type BlindChoice = "x" | "y" | "unsure";
export type BlindAnswer = "earlier" | "later" | "unsure";

export type BlindAssignment = {
  x_take_id: string;
  y_take_id: string;
};

export function createBlindAssignment(earlierTakeId: string, laterTakeId: string, randomValue = Math.random()): BlindAssignment {
  return randomValue < 0.5
    ? { x_take_id: earlierTakeId, y_take_id: laterTakeId }
    : { x_take_id: laterTakeId, y_take_id: earlierTakeId };
}

export function answerForChoice(
  choice: BlindChoice,
  assignment: BlindAssignment,
  laterTakeId: string,
): BlindAnswer {
  if (choice === "unsure") return "unsure";
  const selectedTakeId = choice === "x" ? assignment.x_take_id : assignment.y_take_id;
  return selectedTakeId === laterTakeId ? "later" : "earlier";
}
