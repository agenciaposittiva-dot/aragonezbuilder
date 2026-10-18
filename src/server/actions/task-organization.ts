"use server";

import { z } from "zod";
import { applyTemplateInput, labelInput, savedViewInput, templateInput } from "@/lib/validators/tasks";
import * as labels from "@/server/services/task-labels";
import * as templates from "@/server/services/task-templates";
import { orgAction } from "./safe-action";

const idInput = z.object({ id: z.uuid() });

/* Etiquetas */
export const saveLabelAction = orgAction(labelInput, labels.saveLabel);
export const deleteLabelAction = orgAction(idInput, (s, i) => labels.deleteLabel(s, i.id));
export const setTaskLabelsAction = orgAction(
  z.object({ taskId: z.uuid(), labelIds: z.array(z.uuid()).max(20) }),
  (s, i) => labels.setTaskLabels(s, i.taskId, i.labelIds),
);

/* Filtros salvos (não re-renderizam a página: a lista é atualizada no cliente) */
export const saveViewAction = orgAction(savedViewInput, labels.saveView);
export const deleteSavedViewAction = orgAction(idInput, (s, i) => labels.deleteSavedView(s, i.id));

/* Modelos */
export const saveTemplateAction = orgAction(templateInput, templates.saveTemplate);
export const deleteTemplateAction = orgAction(idInput, (s, i) => templates.deleteTemplate(s, i.id));
export const applyTemplateAction = orgAction(applyTemplateInput, templates.applyTemplate);
export const templateFromTaskAction = orgAction(
  z.object({ taskId: z.uuid(), name: z.string().trim().max(120).optional() }),
  (s, i) => templates.templateFromTask(s, i.taskId, i.name),
);
