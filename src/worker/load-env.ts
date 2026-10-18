// Carrega o .env antes de qualquer módulo que valide variáveis de ambiente.
import { config } from "dotenv";

config({ path: process.env.ENV_FILE ?? ".env", quiet: true });
