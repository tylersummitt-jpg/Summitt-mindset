// src/lib/achievements/definitions.ts

export type AchievementKey =
  | "days_7"
  | "days_14"
  | "days_30"
  | "days_60"
  | "days_90"
  | "days_365";

export type AchievementDefinition = {
  key: AchievementKey;
  title: string;
  when: (args: { totalDaysCompleted: number }) => boolean;
};

export const ACHIEVEMENTS: AchievementDefinition[] = [
  {
    key: "days_7",
    title: "Seven Days Steady",
    when: ({ totalDaysCompleted }) => totalDaysCompleted >= 7,
  },
  {
    key: "days_14",
    title: "Two Weeks Showing Up",
    when: ({ totalDaysCompleted }) => totalDaysCompleted >= 14,
  },
  {
    key: "days_30",
    title: "Thirty Days",
    when: ({ totalDaysCompleted }) => totalDaysCompleted >= 30,
  },
  {
    key: "days_60",
    title: "Sixty Days",
    when: ({ totalDaysCompleted }) => totalDaysCompleted >= 60,
  },
  {
    key: "days_90",
    title: "Ninety Days",
    when: ({ totalDaysCompleted }) => totalDaysCompleted >= 90,
  },
  {
    key: "days_365",
    title: "One Year",
    when: ({ totalDaysCompleted }) => totalDaysCompleted >= 365,
  },
];