const LESSON_GROUPS = [
  { through: 2, label: "1.1 Pat in Her Own Words" },
  { through: 5, label: "1.2 Simple Truths" },
  { through: 10, label: "1.3 It Starts with You" },
  { through: 13, label: "1.4 Respect & Accountability" },
  { through: 15, label: "1.5 Respect-Busting Behaviors" },
  { through: 18, label: "1.6 Wrap-Up" },
] as const;

export function lessonGroupForSequence(sequence: number): string {
  const group = LESSON_GROUPS.find((item) => sequence <= item.through);
  return group?.label ?? LESSON_GROUPS[LESSON_GROUPS.length - 1].label;
}
