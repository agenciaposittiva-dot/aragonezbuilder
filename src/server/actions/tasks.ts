"use server";

import { z } from "zod";
import { checklistItemInput, taskInput, taskMoveInput, taskUpdateInput, timeEntryInput } from "@/lib/validators/tasks";
import * as tasks from "@/server/services/tasks";
import * as time from "@/server/services/time-entries";
import { orgAction } from "./safe-action";

const idInput = z.object({ id: z.uuid() });

export const createTaskAction = orgAction(taskInput, tasks.createTask);

export const updateTaskAction = orgAction(taskUpdateInput, tasks.updateTask);

export const changeTaskStatusAction = orgAction(z.object({ taskId: z.uuid(), statusId: z.uuid() }), (s, i) =>
  tasks.changeTaskStatus(s, i.taskId, i.statusId),
);

export const toggleTaskDoneAction = orgAction(z.object({ taskId: z.uuid(), done: z.boolean() }), (s, i) =>
  tasks.toggleTaskDone(s, i.taskId, i.done),
);

/** Sem re-renderização: o Kanban já aplica a mudança de forma otimista. */
export const moveTaskAction = orgAction(taskMoveInput, tasks.moveTask, { refresh: false });

export const archiveTaskAction = orgAction(z.object({ id: z.uuid(), archived: z.boolean() }), (s, i) =>
  tasks.setTaskArchived(s, i.id, i.archived),
);

/** "Excluir" move para a Lixeira (30 dias). A página da tarefa deixa de existir: a interface navega. */
export const deleteTaskAction = orgAction(idInput, (s, i) => tasks.deleteTask(s, i.id), { refresh: false });

export const duplicateTaskAction = orgAction(
  z.object({ id: z.uuid(), withSubtasks: z.boolean().optional() }),
  (s, i) => tasks.duplicateTask(s, i.id, { withSubtasks: i.withSubtasks }),
);

export const setTaskCollaboratorsAction = orgAction(
  z.object({ taskId: z.uuid(), membershipIds: z.array(z.uuid()).max(30) }),
  (s, i) => tasks.setTaskCollaborators(s, i.taskId, i.membershipIds),
);

export const saveChecklistItemAction = orgAction(checklistItemInput, tasks.saveChecklistItem);

export const toggleChecklistItemAction = orgAction(
  z.object({ taskId: z.uuid(), itemId: z.uuid(), done: z.boolean() }),
  (s, i) => tasks.toggleChecklistItem(s, i.taskId, i.itemId, i.done),
);

export const deleteChecklistItemAction = orgAction(z.object({ taskId: z.uuid(), itemId: z.uuid() }), (s, i) =>
  tasks.deleteChecklistItem(s, i.taskId, i.itemId),
);

export const reorderChecklistAction = orgAction(
  z.object({ taskId: z.uuid(), orderedIds: z.array(z.uuid()).max(200) }),
  (s, i) => tasks.reorderChecklist(s, i.taskId, i.orderedIds),
);

export const addDependencyAction = orgAction(z.object({ taskId: z.uuid(), dependsOnTaskId: z.uuid() }), (s, i) =>
  tasks.addDependency(s, i.taskId, i.dependsOnTaskId),
);

export const removeDependencyAction = orgAction(z.object({ taskId: z.uuid(), dependsOnTaskId: z.uuid() }), (s, i) =>
  tasks.removeDependency(s, i.taskId, i.dependsOnTaskId),
);

export const startTimerAction = orgAction(z.object({ taskId: z.uuid() }), (s, i) => time.startTimer(s, i.taskId));

export const stopTimerAction = orgAction(z.object({}), (s) => time.stopTimer(s));

export const addTimeEntryAction = orgAction(timeEntryInput, time.addTimeEntry);

export const deleteTimeEntryAction = orgAction(idInput, (s, i) => time.deleteTimeEntry(s, i.id));
