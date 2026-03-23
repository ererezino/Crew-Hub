import { ALLOWED_IMAGE_EXTENSIONS } from "../../types/crew-games";

const DEFAULT_EVENT_IMAGE_EXTENSION = "png";

function normalizeImageExtension(fileName: string): string {
  const extension = fileName.split(".").pop()?.trim().toLowerCase();

  if (
    extension &&
    ALLOWED_IMAGE_EXTENSIONS.includes(
      extension as (typeof ALLOWED_IMAGE_EXTENSIONS)[number]
    )
  ) {
    return extension;
  }

  return DEFAULT_EVENT_IMAGE_EXTENSION;
}

export function buildEventImageUploadPath(
  orgId: string,
  fileName: string,
  uniqueId: string = crypto.randomUUID()
): string {
  const extension = normalizeImageExtension(fileName);

  return `${orgId}/event-images/event-image-${uniqueId}.${extension}`;
}
