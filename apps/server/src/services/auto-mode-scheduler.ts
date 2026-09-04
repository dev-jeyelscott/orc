import {
  env,
} from "../config/env.js";
import {
  logger,
} from "../logger.js";
import {
  runNotionAutoModeCycle,
} from "./notion-auto-mode-cycle.js";

type AutoModeCycle =
  () => Promise<void>;

/**
 * Runs Auto Mode lifecycle synchronization and intake in one process while coalescing overlapping requests.
 */
export class AutoModeScheduler {
  private timer:
    NodeJS.Timeout | null =
    null;

  private running =
    false;

  private requested =
    false;

  /**
   * Creates one scheduler using the configured polling interval and supplied cycle implementation.
   */
  constructor(
    private readonly cycle:
      AutoModeCycle =
        runNotionAutoModeCycle,
    private readonly pollIntervalMs:
      number =
        env.NOTION_POLL_INTERVAL_SECONDS *
        1_000,
  ) {}

  /**
   * Starts the recovery poll and requests one immediate startup cycle.
   */
  start(): void {
    if (
      this.timer
    ) {
      return;
    }

    this.timer =
      setInterval(
        () => {
          this.requestCycle();
        },
        this.pollIntervalMs,
      );

    this.timer.unref();

    this.requestCycle();
  }

  /**
   * Stops future timer-driven cycles without cancelling a cycle already executing.
   */
  stop(): void {
    if (
      this.timer
    ) {
      clearInterval(
        this.timer,
      );

      this.timer =
        null;
    }

    this.requested =
      false;
  }

  /**
   * Requests an immediate cycle, coalescing repeated requests while another cycle is active.
   */
  requestCycle(): void {
    if (
      this.running
    ) {
      this.requested =
        true;
      return;
    }

    void this.drain();
  }

  /**
   * Executes cycles serially and performs at most one coalesced follow-up for concurrent requests.
   */
  private async drain(): Promise<void> {
    if (
      this.running
    ) {
      this.requested =
        true;
      return;
    }

    this.running =
      true;

    try {
      do {
        this.requested =
          false;

        try {
          await this.cycle();
        } catch (error) {
          logger.error(
            {
              error,
            },
            "Auto Mode cycle failed",
          );
        }
      } while (
        this.requested
      );
    } finally {
      this.running =
        false;
    }
  }
}

/**
 * Creates the production Auto Mode scheduler using persisted lifecycle reconciliation and configured polling.
 */
export function createAutoModeScheduler(): AutoModeScheduler {
  return new AutoModeScheduler();
}
