import { disconnectSeedDatabase } from "./seed-database";
import { seedRoleQaDatabase } from "./seed-role-qa";

seedRoleQaDatabase()
  .then(disconnectSeedDatabase)
  .catch(async (error) => {
    console.error(error);
    await disconnectSeedDatabase();
    process.exit(1);
  });
