import { execSync } from "node:child_process";

/** Aplica as migrações no banco de testes antes da suíte. */
export default function setup() {
  execSync("npx tsx --tsconfig tsconfig.node.json scripts/migrate.ts --env .env.test", { stdio: "inherit" });
}
