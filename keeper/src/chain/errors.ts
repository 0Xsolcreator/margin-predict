export interface MoveAbortInfo {
  abortCode: string;
  module: string;
  functionName: string;
}

export function parseMoveAbort(status: unknown): MoveAbortInfo | null {
  const abort = (status as any)?.error?.MoveAbort;
  if (!abort) return null;
  return {
    abortCode: String(abort.abortCode),
    module: abort.location?.module,
    functionName: abort.location?.functionName,
  };
}

export class SimulationError extends Error {
  constructor(public readonly status: unknown) {
    super(`Simulation failed: ${JSON.stringify(status)}`);
    this.name = 'SimulationError';
  }

  moveAbort(): MoveAbortInfo | null {
    return parseMoveAbort(this.status);
  }
}

export class ExecutionError extends Error {
  constructor(label: string, public readonly status: unknown) {
    super(`${label} failed:\n${JSON.stringify(status, null, 2)}`);
    this.name = 'ExecutionError';
  }

  moveAbort(): MoveAbortInfo | null {
    return parseMoveAbort(this.status);
  }
}
