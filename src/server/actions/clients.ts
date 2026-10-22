"use server";

import { z } from "zod";
import {
  brandProfileInput,
  clientCategoryInput,
  clientCategoryMoveInput,
  clientCategoryOrderInput,
  clientInput,
  clientMembersInput,
  contactInput,
  serviceInput,
} from "@/lib/validators/clients";
import * as categories from "@/server/services/client-categories";
import * as clients from "@/server/services/clients";
import { orgAction } from "./safe-action";

export const createClientAction = orgAction(clientInput, (s, input) => clients.createClient(s, input));

export const updateClientAction = orgAction(z.object({ id: z.uuid(), data: clientInput }), (s, { id, data }) =>
  clients.updateClient(s, id, data),
);

export const archiveClientAction = orgAction(z.object({ id: z.uuid(), archived: z.boolean() }), (s, { id, archived }) =>
  clients.setClientArchived(s, id, archived),
);

export const saveContactAction = orgAction(contactInput, clients.saveContact);

export const deleteContactAction = orgAction(
  z.object({ clientId: z.uuid(), contactId: z.uuid() }),
  (s, { clientId, contactId }) => clients.deleteContact(s, clientId, contactId),
);

export const setClientMembersAction = orgAction(clientMembersInput, clients.setClientMembers);

export const saveServiceAction = orgAction(serviceInput, clients.saveService);

export const deleteServiceAction = orgAction(
  z.object({ clientId: z.uuid(), serviceId: z.uuid() }),
  (s, { clientId, serviceId }) => clients.deleteService(s, clientId, serviceId),
);

export const updateBrandProfileAction = orgAction(brandProfileInput, clients.updateBrandProfile);

/* Categorias de clientes */
export const saveClientCategoryAction = orgAction(clientCategoryInput, categories.saveClientCategory);
export const reorderClientCategoriesAction = orgAction(clientCategoryOrderInput, categories.reorderClientCategories);
export const deleteClientCategoryAction = orgAction(z.object({ id: z.uuid() }), (s, { id }) =>
  categories.deleteClientCategory(s, id),
);
export const setClientCategoryAction = orgAction(clientCategoryMoveInput, categories.setClientCategory);
