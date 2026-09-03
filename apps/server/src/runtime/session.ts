import crypto from "node:crypto";
import fs from "node:fs";

import type { HarnessAdapter, PtyFactory, RuntimeDiagnostic, RuntimeEvent, RuntimeSession, SessionMetadata, StartWorkerInput, UnsequencedRuntimeEvent } from "./contracts.js";
import { composeInitialInstruction } from "./prompt.js";

const FORCE_STOP_DELAY_MS = 5_000;

export class InMemoryRuntimeSession implements RuntimeSession {
  readonly metadata: SessionMetadata;
  private readonly events: RuntimeEvent[] = [];
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private sequence = 0;
  private forceStopTimer: NodeJS.Timeout | undefined;
  private process: ReturnType<PtyFactory["spawn"]> | undefined;
  private adapter: HarnessAdapter | undefined;
  private providerLineBuffer = "";

  private constructor() {
    this.metadata = { id: crypto.randomUUID(), pid: null, state: "starting", exitCode: null, signal: null, usage: null };
  }

  static start(input: StartWorkerInput, adapter: HarnessAdapter, ptyFactory: PtyFactory): InMemoryRuntimeSession {
    const session = new InMemoryRuntimeSession();
    session.adapter = adapter;
    if (!fs.existsSync(input.projectPath)) {
      session.fail({ code: "project_not_found", message: `Project path does not exist: ${input.projectPath}` });
      return session;
    }
    if (!fs.statSync(input.projectPath).isDirectory()) {
      session.fail({ code: "project_not_directory", message: `Project path is not a directory: ${input.projectPath}` });
      return session;
    }

    try {
      const invocation = adapter.createInvocation(input, composeInitialInstruction(input));
      session.process = ptyFactory.spawn(invocation.command, invocation.args, { cwd: invocation.cwd, name: "xterm-256color", cols: 120, rows: 30 });
      session.metadata.pid = session.process.pid;
      session.metadata.state = "running";
      session.process.onData((data) => {
        session.emit({ type: "output", data });
        session.translateProviderOutput(data);
      });
      session.process.onExit(({ exitCode, signal }) => session.exited(exitCode, signal));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = /ENOENT|not found/i.test(message) ? "cli_not_found" : /Unsupported/.test(message) ? "unsupported_configuration" : "launch_failed";
      session.fail({ code, message });
    }
    return session;
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    for (const event of this.events) listener(event);
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  stop(): void {
    if (!this.process || (this.metadata.state !== "running" && this.metadata.state !== "stopping")) return;
    if (this.metadata.state === "stopping") return;
    this.metadata.state = "stopping";
    try {
      this.process.kill("SIGTERM");
      this.forceStopTimer = setTimeout(() => {
        if (this.metadata.state === "stopping") this.process?.kill("SIGKILL");
      }, FORCE_STOP_DELAY_MS);
    } catch (error) {
      this.emit({ type: "diagnostic", diagnostic: { code: "launch_failed", message: `Could not stop worker: ${error instanceof Error ? error.message : String(error)}` } });
    }
  }

  private exited(exitCode: number, signal?: number): void {
    if (this.forceStopTimer) clearTimeout(this.forceStopTimer);
    if (this.providerLineBuffer) this.translateProviderOutput("\n");
    this.metadata.state = "exited";
    this.metadata.exitCode = exitCode;
    this.metadata.signal = signal ?? null;
    this.emit({ type: "exit", exitCode, signal });
    if (exitCode !== 0 && !signal) this.emit({ type: "diagnostic", diagnostic: { code: "unexpected_exit", message: `Worker exited with code ${exitCode}` } });
    if (!this.metadata.usage) this.emit({ type: "diagnostic", diagnostic: { code: "usage_unavailable", message: "The harness did not report usage telemetry" } });
  }

  private fail(diagnostic: RuntimeDiagnostic): void {
    this.metadata.state = "failed";
    this.emit({ type: "diagnostic", diagnostic });
  }

  private translateProviderOutput(data: string): void {
    this.providerLineBuffer += data;
    const lines = this.providerLineBuffer.split(/\r?\n/);
    this.providerLineBuffer = lines.pop() ?? "";
    for (const line of lines) {
      for (const event of this.adapter?.translateOutput(line) ?? []) this.emit(event);
    }
  }

  private emit(event: UnsequencedRuntimeEvent): void {
    const sequenced = { ...event, sequence: ++this.sequence } as RuntimeEvent;
    this.events.push(sequenced);
    if (sequenced.type === "usage") this.metadata.usage = sequenced.usage;
    for (const listener of this.listeners) listener(sequenced);
  }
}
