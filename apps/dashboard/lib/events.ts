import {
  EVENT_LIST_DEFAULT_PAGE_SIZE,
  eventListResponseSchema,
  type EventListResponse,
} from "@orc/shared";

const SERVER_URL =
  (
    process.env.NEXT_PUBLIC_SERVER_URL ??
    "http://localhost:4000"
  ).replace(
    /\/$/,
    "",
  );

/**
 * Loads and validates one bounded newest-first system domain-event page.
 */
export async function getEvents(
  page = 1,
  pageSize =
    EVENT_LIST_DEFAULT_PAGE_SIZE,
  signal?: AbortSignal,
): Promise<EventListResponse> {
  const url =
    new URL(
      `${SERVER_URL}/api/events`,
    );

  url.searchParams.set(
    "page",
    String(
      page,
    ),
  );

  url.searchParams.set(
    "pageSize",
    String(
      pageSize,
    ),
  );

  const response =
    await fetch(
      url,
      {
        cache:
          "no-store",
        signal,
      },
    );

  if (
    !response.ok
  ) {
    const body =
      (await response
        .json()
        .catch(
          () =>
            null,
        )) as {
        error?: string;
      } | null;

    throw new Error(
      body?.error ??
        `Failed to load events: ${response.status}`,
    );
  }

  return eventListResponseSchema.parse(
    await response.json(),
  );
}
