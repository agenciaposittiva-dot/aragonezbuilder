"use server";

import { z } from "zod";
import { projectInput, projectUpdateInput, stageInput } from "@/lib/validators/projects";
import * as projects from "@/server/services/projects";
import { orgAction } from "./safe-action";

export const createProjectAction = orgAction(projectInput, projects.createProject);

export const updateProjectAction = orgAction(projectUpdateInput, projects.updateProject);

export const changeProjectStatusAction = orgAction(
  z.object({ projectId: z.uuid(), statusId: z.uuid() }),
  (s, { projectId, statusId }) => projects.changeProjectStatus(s, projectId, statusId),
);

export const archiveProjectAction = orgAction(
  z.object({ id: z.uuid(), archived: z.boolean() }),
  (s, { id, archived }) => projects.setProjectArchived(s, id, archived),
);

export const setProjectMembersAction = orgAction(projects.projectMembersInput, projects.setProjectMembers);

export const saveStageAction = orgAction(stageInput, projects.saveStage);

export const setStageStatusAction = orgAction(
  z.object({ projectId: z.uuid(), stageId: z.uuid(), status: z.enum(["pending", "active", "done"]) }),
  (s, { projectId, stageId, status }) => projects.setStageStatus(s, projectId, stageId, status),
);

export const reorderStagesAction = orgAction(
  z.object({ projectId: z.uuid(), orderedIds: z.array(z.uuid()).max(50) }),
  (s, { projectId, orderedIds }) => projects.reorderStages(s, projectId, orderedIds),
);

export const deleteStageAction = orgAction(
  z.object({ projectId: z.uuid(), stageId: z.uuid() }),
  (s, { projectId, stageId }) => projects.deleteStage(s, projectId, stageId),
);
