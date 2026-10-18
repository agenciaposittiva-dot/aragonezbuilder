"use server";

import { z } from "zod";
import { commentInput, commentTarget } from "@/lib/validators/comments";
import * as comments from "@/server/services/comments";
import { orgAction } from "./safe-action";

export const listCommentsAction = orgAction(commentTarget, comments.listComments, { refresh: false });

export const addCommentAction = orgAction(commentInput, comments.addComment);

export const deleteCommentAction = orgAction(z.object({ id: z.uuid() }), (s, { id }) => comments.deleteComment(s, id));

export const editCommentAction = orgAction(z.object({ id: z.uuid(), body: z.string().max(10000) }), (s, { id, body }) =>
  comments.editComment(s, id, body),
);
