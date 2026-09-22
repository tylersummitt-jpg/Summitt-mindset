export type ProgramsDbError = {
  code?: string;
  message: string;
};

export function isUniqueProgramsConflict(error: ProgramsDbError): boolean {
  if (error.code === "23505") return true;
  return error.message.toLowerCase().includes("duplicate key");
}

export function isMissingProgramsTable(error: ProgramsDbError): boolean {
  if (isUniqueProgramsConflict(error)) return false;
  const message = error.message.toLowerCase();
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    message.includes("learning_mini_program_progress") ||
    message.includes("learning_reflection_answers") ||
    message.includes("schema cache")
  );
}

export function logProgramsDbFailure(table: string, error: ProgramsDbError): void {
  if (isUniqueProgramsConflict(error)) return;
  console.error(table, error.code ?? "", error.message);
}
