import Fastify, { type FastifyInstance } from 'fastify';
import { SimulationError, ExecutionError } from './chain/errors.js';
import { registerOpenRoute } from './routes/open.js';
import { registerCloseRoute } from './routes/close.js';
import { registerSettleRoute } from './routes/settle.js';
import { registerLiquidateRoute } from './routes/liquidate.js';
import { registerPositionRoutes } from './routes/positions.js';
import { registerConfigRoutes } from './routes/config.js';

export function buildApp(opts: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? true });

  app.setErrorHandler<Error>((error, _request, reply) => {
    if (error instanceof SimulationError || error instanceof ExecutionError) {
      const abort = error.moveAbort();
      return reply.code(502).send({ error: error.message, moveAbort: abort });
    }
    app.log.error(error);
    return reply.code(500).send({ error: error.message });
  });

  registerOpenRoute(app);
  registerCloseRoute(app);
  registerSettleRoute(app);
  registerLiquidateRoute(app);
  registerPositionRoutes(app);
  registerConfigRoutes(app);

  return app;
}
