import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/server/db";
import { account, rateLimit, session, user, verification } from "@/server/db/schema";
import { env } from "@/server/env";
import { processEventsInBackground } from "@/server/events/inline";
import { enqueueEmail, renderEmail } from "@/server/mail";
import { redisConfigured, redisRateLimitStorage } from "@/server/redis";
import { APP_NAME } from "@/lib/constants";

export const auth = betterAuth({
  appName: APP_NAME,
  baseURL: process.env.BETTER_AUTH_URL ?? env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: env.trustedOrigins,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification, rateLimit },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    async sendResetPassword({ user: u, url }) {
      const { html, text } = renderEmail({
        title: "Redefinição de senha",
        paragraphs: [
          `Olá, ${u.name}.`,
          "Recebemos um pedido para redefinir a sua senha. O link vale por 1 hora.",
          "Se não foi você, ignore este e-mail: a sua senha atual continua válida.",
        ],
        action: { label: "Criar nova senha", url },
      });
      await enqueueEmail({ to: u.email, subject: `Redefinição de senha · ${APP_NAME}`, html, text });
      processEventsInBackground();
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    async sendVerificationEmail({ user: u, url }) {
      const { html, text } = renderEmail({
        title: "Confirme o seu e-mail",
        paragraphs: [`Olá, ${u.name}.`, "Confirme o seu endereço de e-mail para proteger a sua conta."],
        action: { label: "Confirmar e-mail", url },
      });
      await enqueueEmail({ to: u.email, subject: `Confirme o seu e-mail · ${APP_NAME}`, html, text });
      processEventsInBackground();
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    // Sem cache em cookie: a revogação de sessões vale na próxima requisição.
    cookieCache: { enabled: false },
  },
  rateLimit: {
    enabled: env.NODE_ENV === "production",
    storage: "database",
    // Com Upstash configurado, os contadores ficam no Redis em vez do banco.
    ...(redisConfigured() ? { customStorage: redisRateLimitStorage() } : {}),
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60, max: 5 },
      "/request-password-reset": { window: 60, max: 5 },
    },
  },
  advanced: {
    useSecureCookies: env.APP_URL.startsWith("https://"),
  },
  plugins: [nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;
