import { once } from "node:events";

export function createApiServerStartup({ app, recover, logger = console }) {
  let ready = false;
  app.use((_req, res, next) => {
    if (ready) return next();
    res.status(503).json({ ok: false, error: "API_STARTING", message: "服务正在恢复，请稍后重试。" });
  });

  return async function start({ port, host }) {
    // Bind first: a duplicate worker must not mutate the shared database.
    const server = app.listen(port, host);
    try {
      await once(server, "listening");
      if (recover) {
        const result = await recover();
        logger.log("Teaching workflow restart recovery completed", {
          pid: process.pid, at: new Date().toISOString(), count: result?.count ?? null
        });
      }
      ready = true;
      logger.log(`Junhang API listening at http://${host}:${server.address().port}`);
      return server;
    } catch (error) {
      if (server.listening) await new Promise((resolve) => server.close(resolve));
      throw error;
    }
  };
}
