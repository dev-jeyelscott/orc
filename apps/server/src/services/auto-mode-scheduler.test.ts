import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  AutoModeScheduler,
} from "./auto-mode-scheduler.js";

/**
 * Flushes pending promise continuations used by scheduler-cycle assertions.
 */
async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(
  () => {
    vi.useRealTimers();
  },
);

describe(
  "AutoModeScheduler",
  () => {
    it(
      "runs one immediate startup cycle and then polls every 30 seconds",
      async () => {
        vi.useFakeTimers();

        const cycle =
          vi.fn()
            .mockResolvedValue(
              undefined,
            );

        const scheduler =
          new AutoModeScheduler(
            cycle,
            30_000,
          );

        scheduler.start();

        await flushPromises();

        expect(
          cycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        await vi.advanceTimersByTimeAsync(
          29_999,
        );

        expect(
          cycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        await vi.advanceTimersByTimeAsync(
          1,
        );

        expect(
          cycle,
        ).toHaveBeenCalledTimes(
          2,
        );

        scheduler.stop();
      },
    );

    it(
      "never overlaps cycles and coalesces repeated immediate requests into one follow-up",
      async () => {
        let releaseFirst:
          (() => void) | null =
          null;

        let active =
          0;

        let maxActive =
          0;

        const firstCycle =
          new Promise<void>(
            (resolve) => {
              releaseFirst =
                resolve;
            },
          );

        const cycle =
          vi.fn()
            .mockImplementation(
              async () => {
                active +=
                  1;

                maxActive =
                  Math.max(
                    maxActive,
                    active,
                  );

                if (
                  cycle.mock.calls.length ===
                  1
                ) {
                  await firstCycle;
                }

                active -=
                  1;
              },
            );

        const scheduler =
          new AutoModeScheduler(
            cycle,
            30_000,
          );

        scheduler.start();

        await flushPromises();

        expect(
          cycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        scheduler.requestCycle();
        scheduler.requestCycle();
        scheduler.requestCycle();

        expect(
          cycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        releaseFirst?.();

        await flushPromises();

        expect(
          cycle,
        ).toHaveBeenCalledTimes(
          2,
        );

        expect(
          maxActive,
        ).toBe(
          1,
        );

        scheduler.stop();
      },
    );
  },
);
