import { AiProviderError } from "./types";

/*
 * Conta do provedor sem créditos ou sem cota: nada passa até alguém pagar ou
 * trocar de modelo. A mensagem diz isso em português, sem o JSON da API, e não
 * troca de provedor em silêncio — quem escolhe outro modelo é a pessoa.
 */

const NO_CREDITS = /credit balance is too low|insufficient_quota|billing_hard_limit|exceeded your current quota/i;

export function isNoCredits(detail: string): boolean {
  return NO_CREDITS.test(detail);
}

export function noCreditsError(provider: string, billing: string): AiProviderError {
  return new AiProviderError(
    `A conta da ${provider} está sem créditos. Adicione créditos em ${billing} ou escolha outro modelo de IA em "Escolher modelo".`,
    "config",
  );
}
