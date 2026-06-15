import 'dotenv/config';
import { PORT } from './config.js';
import { buildApp } from './app.js';

const app = buildApp();

app.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`margin-predict keeper listening on ${address}`);
});
