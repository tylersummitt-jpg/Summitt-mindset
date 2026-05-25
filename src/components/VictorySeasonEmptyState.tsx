type VictorySeasonEmptyStateProps = {
  message: string;
};

export function VictorySeasonEmptyState({ message }: VictorySeasonEmptyStateProps) {
  return (
    <p className="rounded-lg border border-stone-200 bg-stone-50/80 px-5 py-4 text-sm leading-relaxed text-gray-700">
      {message}
    </p>
  );
}
