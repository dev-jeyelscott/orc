import * as pty from "node-pty";

import type { PtyFactory, PtyProcess } from "./contracts.js";

export const nodePtyFactory: PtyFactory = {
  spawn(command, args, options): PtyProcess {
    return pty.spawn(command, args, options);
  },
};
