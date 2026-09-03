import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { HarnessAdapter, PtyFactory, PtyProcess, StartWorkerInput } from "./contracts.js";
import { InMemoryRuntimeSession } from "./session.js";

class FakePty implements PtyProcess {
  pid = 1234;
  readonly kills: Array<string | undefined> = [];
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>();

  onData(listener: (data: string) => void) { this.dataListeners.add(listener); return { dispose: () => this.dataListeners.delete(listener) }; }
  onExit(listener: (event: { exitCode: number; signal?: number }) => void) { this.exitListeners.add(listener); return { dispose: () => this.exitListeners.delete(listener) }; }
  kill(signal?: string) { this.kills.push(signal); }
  data(value: string) { for (const listener of this.dataListeners) listener(value); }
  exit(exitCode: number, signal?: number) { for (const listener of this.exitListeners) listener({ exitCode, signal }); }
}

const input: StartWorkerInput = {
  projectPath: "",
  agent: { harness: "codex", model: "gpt-5", reasoning: "high", systemPrompt: "Work carefully.", canWrite: false, canRunCommands: false, canCommit: false },
  instruction: "Inspect the repository.",
};

const adapter: HarnessAdapter = {
  harness: "codex",
  createInvocation: (value) => ({ command: "fake", args: [], cwd: value.projectPath }),
  translateOutput: () => [],
};

describe("InMemoryRuntimeSession", () => {
  let projectPath: string;

  afterEach(() => { if (projectPath) fs.rmSync(projectPath, { recursive: true, force: true }); vi.useRealTimers(); });

  function start(factory: PtyFactory) {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "orc-runtime-"));
    return InMemoryRuntimeSession.start({ ...input, projectPath }, adapter, factory);
  }

  it("preserves output ordering and replays history to late subscribers", () => {
    const process = new FakePty();
    const session = start({ spawn: () => process });
    process.data("one");
    process.data("two");
    process.exit(0);

    const events: string[] = [];
    session.subscribe((event) => events.push(`${event.sequence}:${event.type}`));
    expect(events).toEqual(["1:output", "2:output", "3:exit", "4:diagnostic"]);
    expect(session.metadata).toMatchObject({ pid: 1234, state: "exited", exitCode: 0 });
  });

  it("reports launch failures and missing projects without throwing", () => {
    projectPath = path.join(os.tmpdir(), "orc-runtime-missing-project");
    const missing = InMemoryRuntimeSession.start({ ...input, projectPath }, adapter, { spawn: vi.fn() });
    const missingEvents: string[] = [];
    missing.subscribe((event) => { if (event.type === "diagnostic") missingEvents.push(event.diagnostic.code); });
    expect(missingEvents).toEqual(["project_not_found"]);

    const failed = start({ spawn: () => { throw new Error("spawn ENOENT: codex"); } });
    const failedEvents: string[] = [];
    failed.subscribe((event) => { if (event.type === "diagnostic") failedEvents.push(event.diagnostic.code); });
    expect(failedEvents).toEqual(["cli_not_found"]);
  });

  it("uses graceful stop followed by a bounded forced termination fallback", () => {
    vi.useFakeTimers();
    const process = new FakePty();
    const session = start({ spawn: () => process });
    session.stop();
    expect(process.kills).toEqual(["SIGTERM"]);
    vi.advanceTimersByTime(5_000);
    expect(process.kills).toEqual(["SIGTERM", "SIGKILL"]);
    process.exit(143, 15);
    expect(session.metadata.state).toBe("exited");
  });

  it("removes unsubscribed listeners", () => {
    const process = new FakePty();
    const session = start({ spawn: () => process });
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    unsubscribe();
    process.data("ignored");
    expect(listener).not.toHaveBeenCalled();
  });
});
