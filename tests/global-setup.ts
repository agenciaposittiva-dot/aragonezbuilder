import { execSync } from "node:child_process";

/** Aplica as migrações no banco de testes antes da suíte. */
export default function setup() {
  const envFile = process.env.TEST_ENV_FILE ?? ".env.test";
  execSync(`npx tsx --tsconfig tsconfig.node.json scripts/migrate.ts --env ${envFile}`, { stdio: "inherit" });
}
