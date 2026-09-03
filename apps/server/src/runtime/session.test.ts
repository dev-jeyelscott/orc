import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  HarnessAdapter,
  PtyFactory,
  PtyProcess,
  PtySpawnOptions,
  StartWorkerInput,
} from "./contracts.js";
import { InMemoryRuntimeSession } from "./session.js";

class FakePty implements PtyProcess {
  pid = 1234;

  readonly kills: Array<string | undefined> = [];
  readonly writes: string[] = [];

  private readonly dataListeners = new Set<
    (data: string) => void
  >();

  private readonly exitListeners = new Set<
    (event: { exitCode: number; signal?: number }) => void
  >();

  /** Registers a fake PTY output listener. */
  onData(listener: (data: string) => void) {
    this.dataListeners.add(listener);

    return {
      dispose: () => {
        this.dataListeners.delete(listener);
      },
    };
  }

  /** Registers a fake PTY exit listener. */
  onExit(
    listener: (
      event: {
        exitCode: number;
        signal?: number;
      },
    ) => void,
  ) {
    this.exitListeners.add(listener);

    return {
      dispose: () => {
        this.exitListeners.delete(listener);
      },
    };
  }

  /** Records PTY input written by the runtime. */
  write(data: string) {
    this.writes.push(data);
  }

  /** Records process termination signals requested by the runtime. */
  kill(signal?: string) {
    this.kills.push(signal);
  }

  /** Emits fake PTY output to registered listeners. */
  data(value: string) {
    for (const listener of this.dataListeners) {
      listener(value);
    }
  }

  /** Emits a fake PTY process exit. */
  exit(exitCode: number, signal?: number) {
    for (const listener of this.exitListeners) {
      listener({
        exitCode,
        signal,
      });
    }
  }
}

const input: StartWorkerInput = {
  projectPath: "",
  agent: {
    harness: "codex",
    model: "gpt-5",
    reasoning: "high",
    systemPrompt: "Work carefully.",
    canWrite: false,
    canRunCommands: false,
    canCommit: false,
  },
  instruction: "Inspect the repository.",
};

const adapter: HarnessAdapter = {
  harness: "codex",

  /** Creates a fake invocation while preserving the environment supplied by the runtime. */
  createInvocation: (
    value,
    _prompt,
    environment,
  ) => ({
    command: "fake",
    args: [],
    cwd: value.projectPath,
    env: environment,
  }),

  /** Keeps fake provider output empty because session behavior is tested separately. */
  translateOutput: () => [],

  /** Formats fake interactive input so sendInstruction behavior can be verified. */
  formatInstructionInput: (instruction) => `${instruction}\r`,
};

describe("InMemoryRuntimeSession", () => {
  let projectPath: string;

  afterEach(() => {
    if (projectPath) {
      fs.rmSync(projectPath, {
        recursive: true,
        force: true,
      });
    }

    delete process.env.ORC_RUNTIME_TEST_ENV;
    vi.useRealTimers();
  });

  /** Creates a temporary project directory and starts a runtime session against it. */
  function start(
    factory: PtyFactory,
    runtimeAdapter: HarnessAdapter = adapter,
  ) {
    projectPath = fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "orc-runtime-",
      ),
    );

    return InMemoryRuntimeSession.start(
      {
        ...input,
        projectPath,
      },
      runtimeAdapter,
      factory,
    );
  }

  it("preserves output ordering and replays history to late subscribers", () => {
    const fakeProcess = new FakePty();

    const session = start({
      spawn: () => fakeProcess,
    });

    fakeProcess.data("one");
    fakeProcess.data("two");
    fakeProcess.exit(0);

    const events: string[] = [];

    session.subscribe((event) => {
      events.push(`${event.sequence}:${event.type}`);
    });

    expect(events).toEqual([
      "1:output",
      "2:output",
      "3:exit",
      "4:diagnostic",
    ]);

    expect(session.metadata).toMatchObject({
      pid: 1234,
      state: "exited",
      exitCode: 0,
    });
  });

  it("propagates a copied server environment into PTY spawn options", () => {
    process.env.ORC_RUNTIME_TEST_ENV = "visible";

    const fakeProcess = new FakePty();
    let spawnOptions: PtySpawnOptions | undefined;

    const session = start({
      spawn: (
        _command,
        _args,
        options,
      ) => {
        spawnOptions = options;
        return fakeProcess;
      },
    });

    expect(
      spawnOptions?.env.ORC_RUNTIME_TEST_ENV,
    ).toBe("visible");

    expect(spawnOptions?.env).not.toBe(process.env);

    fakeProcess.exit(0);

    expect(session.metadata.state).toBe("exited");
  });

  it("sends normalized additional instructions when the adapter supports PTY input", () => {
    const fakeProcess = new FakePty();

    const session = start({
      spawn: () => fakeProcess,
    });

    const accepted = session.sendInstruction(
      "Continue with validation.",
    );

    expect(accepted).toBe(true);
    expect(fakeProcess.writes).toEqual([
      "Continue with validation.\r",
    ]);

    fakeProcess.exit(0);
  });

  it("does not claim additional-instruction support when the adapter has no input hook", () => {
    const fakeProcess = new FakePty();

    const nonInteractiveAdapter: HarnessAdapter = {
      ...adapter,
      formatInstructionInput: undefined,
    };

    const session = start(
      {
        spawn: () => fakeProcess,
      },
      nonInteractiveAdapter,
    );

    expect(
      session.sendInstruction("Continue."),
    ).toBe(false);

    expect(fakeProcess.writes).toEqual([]);

    fakeProcess.exit(0);
  });

  it("rejects blank additional instructions", () => {
    const fakeProcess = new FakePty();

    const session = start({
      spawn: () => fakeProcess,
    });

    expect(
      session.sendInstruction("   "),
    ).toBe(false);

    expect(fakeProcess.writes).toEqual([]);

    fakeProcess.exit(0);
  });

  it("reports launch failures and missing projects without throwing", () => {
    projectPath = path.join(
      os.tmpdir(),
      "orc-runtime-missing-project",
    );

    const missing = InMemoryRuntimeSession.start(
      {
        ...input,
        projectPath,
      },
      adapter,
      {
        spawn: vi.fn(),
      },
    );

    const missingEvents: string[] = [];

    missing.subscribe((event) => {
      if (event.type === "diagnostic") {
        missingEvents.push(event.diagnostic.code);
      }
    });

    expect(missingEvents).toEqual([
      "project_not_found",
    ]);

    const failed = start({
      spawn: () => {
        throw new Error("spawn ENOENT: codex");
      },
    });

    const failedEvents: string[] = [];

    failed.subscribe((event) => {
      if (event.type === "diagnostic") {
        failedEvents.push(event.diagnostic.code);
      }
    });

    expect(failedEvents).toEqual([
      "cli_not_found",
    ]);
  });

  it("uses graceful stop followed by a bounded forced termination fallback", () => {
    vi.useFakeTimers();

    const fakeProcess = new FakePty();

    const session = start({
      spawn: () => fakeProcess,
    });

    session.stop();

    expect(fakeProcess.kills).toEqual([
      "SIGTERM",
    ]);

    vi.advanceTimersByTime(5_000);

    expect(fakeProcess.kills).toEqual([
      "SIGTERM",
      "SIGKILL",
    ]);

    fakeProcess.exit(
      143,
      15,
    );

    expect(session.metadata.state).toBe("exited");
  });

  it("removes unsubscribed listeners", () => {
    const fakeProcess = new FakePty();

    const session = start({
      spawn: () => fakeProcess,
    });

    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);

    unsubscribe();

    fakeProcess.data("ignored");

    expect(listener).not.toHaveBeenCalled();

    fakeProcess.exit(0);
  });
});
