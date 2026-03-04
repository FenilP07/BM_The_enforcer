import { createApp } from "./app.js";
import { config } from "./config/config.js";
import { connectDB } from "./config/db.config.js";

async function main() {
  await connectDB();
  const app = createApp();
  app.listen(config.port, () =>
    console.log(`[API] Listening on :${config.port}`),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
