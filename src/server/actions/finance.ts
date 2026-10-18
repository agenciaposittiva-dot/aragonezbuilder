"use server";

import { z } from "zod";
import {
  expenseInput,
  invoiceInput,
  invoiceTransitionInput,
  invoiceUpdateInput,
  markInvoicePaidInput,
} from "@/lib/validators/finance";
import * as finance from "@/server/services/finance";
import { orgAction } from "./safe-action";

export const createInvoiceAction = orgAction(invoiceInput, finance.createInvoice);
export const updateInvoiceAction = orgAction(invoiceUpdateInput, finance.updateInvoice);
export const transitionInvoiceAction = orgAction(invoiceTransitionInput, finance.transitionInvoice);
export const markInvoicePaidAction = orgAction(markInvoicePaidInput, finance.markInvoicePaid);
export const deleteInvoiceAction = orgAction(z.object({ id: z.uuid() }), (s, { id }) => finance.deleteInvoice(s, id));

export const saveExpenseAction = orgAction(expenseInput, finance.saveExpense);
export const setExpenseStatusAction = orgAction(
  z.object({ id: z.uuid(), status: z.enum(["pending", "paid", "cancelled"]) }),
  (s, { id, status }) => finance.setExpenseStatus(s, id, status),
);
export const deleteExpenseAction = orgAction(z.object({ id: z.uuid() }), (s, { id }) => finance.deleteExpense(s, id));
