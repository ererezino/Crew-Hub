const ERROR_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/schema cache/i, "The system is updating. Please try again in a moment."],
  [/column .+ does not exist/i, "A required field is missing. Please contact your administrator."],
  [/relation .+ does not exist/i, "A required table is missing. Please contact your administrator."],
  [/Could not find function/i, "This action is temporarily unavailable. Please contact your administrator."],
  [/violates row-level security/i, "You do not have permission to perform this action."],
  [/new row violates row-level security/i, "You do not have permission to create this record."],
  [/violates check constraint/i, "The value you entered is not valid. Please check and try again."],
  [/duplicate key value violates unique constraint/i, "This record already exists. Please check for duplicates."],
  [/violates foreign key constraint/i, "This record references data that does not exist or has been removed."],
  [/violates not-null constraint/i, "A required field is missing. Please fill in all required fields."],
  [/value too long for type/i, "The text you entered is too long. Please shorten it and try again."],
  [/invalid input syntax/i, "The value you entered is not in the correct format."],
  [/permission denied/i, "You do not have permission to perform this action."],
  [/canceling statement due to statement timeout/i, "The request took too long. Please try again."],
  [/deadlock detected/i, "A conflict occurred. Please try again."],
  [/connection refused/i, "Unable to reach the server. Please check your connection and try again."],
  [/PGRST/i, "Something went wrong with the request. Please try again."],
  [/JWT expired/i, "Your session has expired. Please log in again."],
  [/Could not find the .+ column/i, "A required field is missing. Please contact your administrator."],
];

export function humanizeError(raw: string | null | undefined): string {
  if (!raw) {
    return "Something went wrong. Please try again.";
  }

  for (const [pattern, message] of ERROR_PATTERNS) {
    if (pattern.test(raw)) {
      return message;
    }
  }

  if (raw.length > 200 || /[{[\]()}]|::|pg_|plpgsql|ERROR:/i.test(raw)) {
    return "Something went wrong. Please try again.";
  }

  return raw;
}
