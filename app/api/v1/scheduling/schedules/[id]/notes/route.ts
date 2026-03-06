import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedSession } from "../../../../../../../lib/auth/session";
import { isSchedulingManager } from "../../../../../../../lib/scheduling";
import { createSupabaseServerClient } from "../../../../../../../lib/supabase/server";
import type { ApiResponse } from "../../../../../../../types/auth";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const noteRowSchema = z.object({
  id: z.string().uuid(),
  schedule_id: z.string().uuid(),
  note_date: z.string(),
  content: z.string(),
  created_by: z.string().uuid().nullable(),
  created_at: z.string()
});

const createNoteSchema = z.object({
  noteDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "noteDate must be YYYY-MM-DD."),
  content: z.string().trim().min(1, "Content must not be empty.").max(2000)
});

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

type DayNote = {
  id: string;
  scheduleId: string;
  noteDate: string;
  content: string;
  createdBy: string | null;
  createdAt: string;
};

type NotesListResponseData = {
  notes: DayNote[];
};

type NoteMutationResponseData = {
  note: DayNote;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMeta() {
  return { timestamp: new Date().toISOString() };
}

function jsonResponse<T>(status: number, payload: ApiResponse<T>) {
  return NextResponse.json(payload, { status });
}

function mapNoteRow(row: z.infer<typeof noteRowSchema>): DayNote {
  return {
    id: row.id,
    scheduleId: row.schedule_id,
    noteDate: row.note_date,
    content: row.content,
    createdBy: row.created_by,
    createdAt: row.created_at
  };
}

// ---------------------------------------------------------------------------
// GET - list notes for a schedule
// ---------------------------------------------------------------------------

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to view schedule notes."
      },
      meta: buildMeta()
    });
  }

  const params = await context.params;
  const scheduleId = params.id;

  if (!z.string().uuid().safeParse(scheduleId).success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Schedule id must be a valid UUID."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  // Verify schedule exists and belongs to the user's org
  const { data: rawSchedule, error: scheduleError } = await supabase
    .from("schedules")
    .select("id")
    .eq("id", scheduleId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (scheduleError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SCHEDULE_FETCH_FAILED",
        message: "Unable to load schedule."
      },
      meta: buildMeta()
    });
  }

  if (!rawSchedule) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "SCHEDULE_NOT_FOUND",
        message: "Schedule was not found."
      },
      meta: buildMeta()
    });
  }

  const { data: rawNotes, error: notesError } = await supabase
    .from("schedule_day_notes")
    .select("id, schedule_id, note_date, content, created_by, created_at")
    .eq("schedule_id", scheduleId)
    .order("note_date", { ascending: true });

  if (notesError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "NOTES_FETCH_FAILED",
        message: "Unable to load schedule notes."
      },
      meta: buildMeta()
    });
  }

  const parsedNotes = z.array(noteRowSchema).safeParse(rawNotes ?? []);

  if (!parsedNotes.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "NOTES_PARSE_FAILED",
        message: "Schedule notes data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const notes = parsedNotes.data.map(mapNoteRow);

  return jsonResponse<NotesListResponseData>(200, {
    data: { notes },
    error: null,
    meta: buildMeta()
  });
}

// ---------------------------------------------------------------------------
// POST - create or update (upsert) a note for a specific date
// ---------------------------------------------------------------------------

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getAuthenticatedSession();

  if (!session?.profile) {
    return jsonResponse<null>(401, {
      data: null,
      error: {
        code: "UNAUTHORIZED",
        message: "You must be logged in to manage schedule notes."
      },
      meta: buildMeta()
    });
  }

  if (!isSchedulingManager(session.profile.roles)) {
    return jsonResponse<null>(403, {
      data: null,
      error: {
        code: "FORBIDDEN",
        message: "Only managers and admins can manage schedule notes."
      },
      meta: buildMeta()
    });
  }

  const params = await context.params;
  const scheduleId = params.id;

  if (!z.string().uuid().safeParse(scheduleId).success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message: "Schedule id must be a valid UUID."
      },
      meta: buildMeta()
    });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonResponse<null>(400, {
      data: null,
      error: {
        code: "BAD_REQUEST",
        message: "Request body must be valid JSON."
      },
      meta: buildMeta()
    });
  }

  const parsedBody = createNoteSchema.safeParse(body);

  if (!parsedBody.success) {
    return jsonResponse<null>(422, {
      data: null,
      error: {
        code: "VALIDATION_ERROR",
        message:
          parsedBody.error.issues[0]?.message ?? "Invalid note payload."
      },
      meta: buildMeta()
    });
  }

  const supabase = await createSupabaseServerClient();

  // Verify schedule exists and belongs to the user's org
  const { data: rawSchedule, error: scheduleError } = await supabase
    .from("schedules")
    .select("id")
    .eq("id", scheduleId)
    .eq("org_id", session.profile.org_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (scheduleError) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "SCHEDULE_FETCH_FAILED",
        message: "Unable to load schedule."
      },
      meta: buildMeta()
    });
  }

  if (!rawSchedule) {
    return jsonResponse<null>(404, {
      data: null,
      error: {
        code: "SCHEDULE_NOT_FOUND",
        message: "Schedule was not found."
      },
      meta: buildMeta()
    });
  }

  // Upsert by schedule_id + note_date
  const { data: rawNote, error: upsertError } = await supabase
    .from("schedule_day_notes")
    .upsert(
      {
        schedule_id: scheduleId,
        note_date: parsedBody.data.noteDate,
        content: parsedBody.data.content,
        created_by: session.profile.id
      },
      { onConflict: "schedule_id,note_date" }
    )
    .select("id, schedule_id, note_date, content, created_by, created_at")
    .single();

  if (upsertError || !rawNote) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "NOTE_UPSERT_FAILED",
        message: "Unable to save schedule note."
      },
      meta: buildMeta()
    });
  }

  const parsedNote = noteRowSchema.safeParse(rawNote);

  if (!parsedNote.success) {
    return jsonResponse<null>(500, {
      data: null,
      error: {
        code: "NOTE_PARSE_FAILED",
        message: "Saved note data is not in the expected shape."
      },
      meta: buildMeta()
    });
  }

  const note = mapNoteRow(parsedNote.data);

  return jsonResponse<NoteMutationResponseData>(200, {
    data: { note },
    error: null,
    meta: buildMeta()
  });
}
