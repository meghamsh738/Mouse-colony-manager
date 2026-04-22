import { pathToFileURL } from "node:url";
import { disconnectSeedDatabase, seedDatabase } from "./seed-database";

export { seedDatabase } from "./seed-database";

async function main() {
  await seedDatabase();
}

const isDirectExecution = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isDirectExecution) {
  main()
    .then(async () => {
      await disconnectSeedDatabase();
    })
    .catch(async (error) => {
      console.error(error);
      await disconnectSeedDatabase();
      process.exit(1);
    });
}
