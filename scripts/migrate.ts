/** Apply database migrations (also applied automatically on server start). */
import { getDb, resetDb } from "../src/db";

async function main() {
  await getDb();
  await resetDb();
  console.log("Migrations applied.");
}
void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
