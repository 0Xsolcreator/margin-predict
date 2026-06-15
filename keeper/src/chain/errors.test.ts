import { describe, it, expect } from 'vitest';
import { parseMoveAbort, SimulationError, ExecutionError } from './errors.js';

const moveAbortStatus = {
  error: {
    MoveAbort: {
      abortCode: '3',
      location: { module: 'position_executor', functionName: 'deploy_position' },
    },
  },
};

describe('parseMoveAbort', () => {
  it('extracts abort code, module, and function from a MoveAbort status', () => {
    expect(parseMoveAbort(moveAbortStatus)).toEqual({
      abortCode: '3',
      module: 'position_executor',
      functionName: 'deploy_position',
    });
  });

  it('returns null for a status with no MoveAbort', () => {
    expect(parseMoveAbort({ error: { InsufficientGas: {} } })).toBeNull();
    expect(parseMoveAbort({})).toBeNull();
  });

  it('returns null for null/undefined status', () => {
    expect(parseMoveAbort(null)).toBeNull();
    expect(parseMoveAbort(undefined)).toBeNull();
  });
});

describe('SimulationError', () => {
  it('carries the status, a JSON message, and the parsed abort', () => {
    const err = new SimulationError(moveAbortStatus);
    expect(err.name).toBe('SimulationError');
    expect(err.status).toBe(moveAbortStatus);
    expect(err.message).toBe(`Simulation failed: ${JSON.stringify(moveAbortStatus)}`);
    expect(err.moveAbort()).toEqual({
      abortCode: '3',
      module: 'position_executor',
      functionName: 'deploy_position',
    });
  });

  it('moveAbort() is null when the status has no MoveAbort', () => {
    const err = new SimulationError({ error: { OutOfGas: {} } });
    expect(err.moveAbort()).toBeNull();
  });
});

describe('ExecutionError', () => {
  it('carries the label, status, a JSON message, and the parsed abort', () => {
    const err = new ExecutionError('Open position', moveAbortStatus);
    expect(err.name).toBe('ExecutionError');
    expect(err.status).toBe(moveAbortStatus);
    expect(err.message).toBe(`Open position failed:\n${JSON.stringify(moveAbortStatus, null, 2)}`);
    expect(err.moveAbort()).toEqual({
      abortCode: '3',
      module: 'position_executor',
      functionName: 'deploy_position',
    });
  });
});
