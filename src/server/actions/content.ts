"use server";

import { z } from "zod";
import { campaignInput, contentItemInput, contentUpdateInput } from "@/lib/content";
import { createCampaign, createContent, deleteContent, updateContent } from "@/server/services/content";
import { orgAction } from "./safe-action";

export const createCampaignAction = orgAction(campaignInput, createCampaign);
export const createContentAction = orgAction(contentItemInput, createContent);
export const updateContentAction = orgAction(contentUpdateInput, updateContent);
export const deleteContentAction = orgAction(z.object({ id: z.uuid() }), (s, { id }) => deleteContent(s, id));
