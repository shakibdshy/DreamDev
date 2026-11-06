import { USER_ROLES } from "@DreamDev/auth";
import { z } from "zod";

export const roleSchema = z.enum(USER_ROLES);
export type UserRole = z.infer<typeof roleSchema>;

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  sort: z.enum(["name", "email", "createdAt"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const createUserBodySchema = z.object({
  name: z.string().trim().min(1),
  email: z.email("A valid email is required").toLowerCase(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: roleSchema.default("editor"),
});
export type CreateUserBody = z.infer<typeof createUserBodySchema>;

export const updateUserBodySchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    role: roleSchema.optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), { message: "Nothing to update" });

export const resetPasswordBodySchema = z.object({
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});
