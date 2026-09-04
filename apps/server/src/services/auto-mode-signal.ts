type AutoModeCycleRequester =
  () => void;

let cycleRequester:
  AutoModeCycleRequester | null =
  null;

/**
 * Registers the active process-local Auto Mode cycle requester and returns its cleanup callback.
 */
export function registerAutoModeCycleRequester(
  requester:
    AutoModeCycleRequester,
): () => void {
  cycleRequester =
    requester;

  return () => {
    if (
      cycleRequester ===
      requester
    ) {
      cycleRequester =
        null;
    }
  };
}

/**
 * Requests an immediate Auto Mode scheduler cycle when a scheduler is registered in this process.
 */
export function requestAutoModeCycle(): void {
  cycleRequester?.();
}
