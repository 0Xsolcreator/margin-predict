import { describe, it, expect } from 'vitest';
import { buildApp } from './app.js';
import { SimulationError, ExecutionError } from './chain/errors.js';

const moveAbortStatus = {
  error: {
    MoveAbort: {
      abortCode: '7',
      location: { module: 'position_manager', functionName: 'health_factor' },
    },
  },
};

function buildTestApp() {
  const app = buildApp({ logger: false });
  app.get('/__boom/simulation', async () => {
    throw new SimulationError(moveAbortStatus);
  });
  app.get('/__boom/execution', async () => {
    throw new ExecutionError('Test op', moveAbortStatus);
  });
  app.get('/__boom/generic', async () => {
    throw new Error('something else broke');
  });
  return app;
}

describe('error handler', () => {
  it('maps SimulationError to 502 with the parsed move abort', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/__boom/simulation' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({
      error: `Simulation failed: ${JSON.stringify(moveAbortStatus)}`,
      moveAbort: { abortCode: '7', module: 'position_manager', functionName: 'health_factor' },
    });
  });

  it('maps ExecutionError to 502 with the parsed move abort', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/__boom/execution' });
    expect(res.statusCode).toBe(502);
    const body = res.json();
    expect(body.moveAbort).toEqual({
      abortCode: '7',
      module: 'position_manager',
      functionName: 'health_factor',
    });
    expect(body.error).toContain('Test op failed:');
  });

  it('maps generic errors to 500 with just the message', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/__boom/generic' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'something else broke' });
  });
});
