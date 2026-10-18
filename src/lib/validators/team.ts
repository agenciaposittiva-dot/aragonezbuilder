import { z } from "zod";
import { moneyCents, optionalText, uuid } from "./common";

export const memberUpdateInput = z.object({
  membershipId: uuid,
  roleId: uuid.optional(),
  jobTitle: optionalText(80),
  specialties: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  /** Capacidade semanal em horas. */
  weeklyCapacityHours: z.coerce.number().min(0).max(80).optional(),
  /** Custo interno por hora em reais (exige permissão de custos). */
  hourlyCost: moneyCents.optional(),
});
export type MemberUpdateInput = z.input<typeof memberUpdateInput>;

export const memberStatusInput = z.object({
  membershipId: uuid,
  status: z.enum(["active", "suspended", "removed"]),
});

export const clientAccessInput = z.object({
  membershipId: uuid,
  clientIds: z.array(uuid).min(1, "Selecione pelo menos um cliente").max(50),
});

export const invitationInput = z.object({
  email: z.email("E-mail inválido").trim().toLowerCase(),
  roleId: uuid,
  clientIds: z.array(uuid).max(50).default([]),
});
export type InvitationInput = z.input<typeof invitationInput>;
