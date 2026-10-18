"use server";

import { z } from "zod";
import { briefingTemplateInput } from "@/lib/validators/briefings";
import { convertRequestInput, REQUEST_STATUSES, requestInput, requestUpdateInput } from "@/lib/validators/requests";
import * as briefings from "@/server/services/briefings";
import * as requests from "@/server/services/requests";
import { orgAction } from "./safe-action";

export const createRequestAction = orgAction(requestInput, requests.createRequest);

export const updateRequestAction = orgAction(requestUpdateInput, requests.updateRequest);

export const submitRequestAction = orgAction(z.object({ id: z.uuid() }), (s, { id }) => requests.submitRequest(s, id));

export const changeRequestStatusAction = orgAction(
  z.object({ id: z.uuid(), status: z.enum(REQUEST_STATUSES), reason: z.string().max(1000).nullable().optional() }),
  (s, { id, status, reason }) => requests.changeRequestStatus(s, id, status, reason),
);

export const assignRequestAction = orgAction(
  z.object({ id: z.uuid(), membershipId: z.uuid().nullable() }),
  (s, { id, membershipId }) => requests.assignRequest(s, id, membershipId),
);

export const convertRequestAction = orgAction(convertRequestInput, requests.convertRequest);

export const saveTemplateAction = orgAction(briefingTemplateInput, briefings.saveTemplate);

export const deleteTemplateAction = orgAction(z.object({ id: z.uuid() }), (s, { id }) =>
  briefings.deleteTemplate(s, id),
);
