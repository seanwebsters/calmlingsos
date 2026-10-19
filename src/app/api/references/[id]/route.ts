import { route } from "@/lib/http";
import { deleteReference, getReference, updateReference } from "@/lib/brain/references";

export const GET = route<{ id: string }>(null, async ({ viewer, params }) => getReference(viewer.orgId, params.id));
export const PATCH = route<{ id: string }>("reference:upload", async ({ req, viewer, params }) => updateReference(viewer, params.id, await req.json()));
export const DELETE = route<{ id: string }>("data:delete", async ({ viewer, params }) => deleteReference(viewer, params.id));
