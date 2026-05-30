import { vrEmptyState } from "@/components/victory-room-visual";

type VictorySeasonEmptyStateProps = {
  message: string;
};

export function VictorySeasonEmptyState({ message }: VictorySeasonEmptyStateProps) {
  return <p className={vrEmptyState}>{message}</p>;
}
