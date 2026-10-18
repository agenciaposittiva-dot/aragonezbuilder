import { z } from "zod";

export const commentTarget = z
  .object({
    projectId: z.uuid().optional(),
    taskId: z.uuid().optional(),
    requestId: z.uuid().optional(),
    fileId: z.uuid().optional(),
    fileVersionId: z.uuid().optional(),
  })
  .refine((t) => [t.projectId, t.taskId, t.requestId, t.fileId].filter(Boolean).length === 1, "Informe um único alvo");

export type CommentTarget = z.infer<typeof commentTarget>;

export const commentInput = z.object({
  target: commentTarget,
  body: z.string().trim().min(1, "Escreva um comentário").max(10000),
  /** Interno = só a equipe vê. Usuários de cliente sempre publicam comentários visíveis. */
  internal: z.boolean().default(true),
  /** Pessoas da equipe mencionadas com @ (vínculos). Hoje: comentários de tarefas. */
  mentions: z.array(z.uuid()).max(20).default([]),
});
